import * as path from "node:path";
import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import {
  AZURE_API_KEY_SECRET,
  isRecognizedAzureOpenAIHost,
  normalizeAzureEndpoint,
  resolveWorkspaceCertificatePath
} from "./azure";
import { ContextCollector } from "./context";
import { ProjectMemory } from "./memory";
import { AgentViewProvider } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const collector = new ContextCollector();
  const memory = new ProjectMemory();
  const agent = new DevelopmentAgent(context, collector, memory);
  const provider = new AgentViewProvider(context, agent, collector, memory);

  context.subscriptions.push(
    agent,
    provider,
    vscode.window.registerWebviewViewProvider("codexDevCompanion.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("codexDevCompanion.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.codexDevCompanion");
      provider.reveal();
    }),
    vscode.commands.registerCommand("codexDevCompanion.newThread", () => provider.newThread()),
    vscode.commands.registerCommand("codexDevCompanion.addSelection", () => provider.addSelection()),
    vscode.commands.registerCommand("codexDevCompanion.remember", async () => {
      const note = await vscode.window.showInputBox({
        title: "Remember for this project",
        prompt: "Save a durable decision, convention, or fact. Do not store secrets.",
        placeHolder: "Example: Use Vitest for new unit tests"
      });
      if (!note) return;
      const uri = await memory.append(note);
      void vscode.window.showInformationMessage(`Codex memory updated: ${vscode.workspace.asRelativePath(uri)}`);
    }),
    vscode.commands.registerCommand("codexDevCompanion.configureAzure", async () => {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const existingApiKey = await context.secrets.get(AZURE_API_KEY_SECRET);
      const endpointInput = await vscode.window.showInputBox({
        title: "Azure OpenAI setup — Step 1: OpenAI API Base",
        prompt: "Paste OPENAI_API_BASE. Use the resource URL ending at /openai, without /deployments/<id>.",
        value: configuration.get<string>("azureEndpoint", ""),
        placeHolder: "https://your-resource.openai.azure.com/openai",
        ignoreFocusOut: true,
        validateInput: (value) => {
          try {
            normalizeAzureEndpoint(value, true);
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }
      });
      if (endpointInput === undefined) {
        void vscode.window.showInformationMessage("Azure OpenAI setup cancelled at step 1/4. No changes were saved.");
        return;
      }

      const usesCorporateGateway = !isRecognizedAzureOpenAIHost(endpointInput);
      if (usesCorporateGateway) {
        const approval = await vscode.window.showWarningMessage(
          "This is not a direct Azure OpenAI hostname. Approve it only if this HTTPS endpoint is your corporate gateway to Azure OpenAI. The API key will be sent in the api-key header.",
          { modal: true },
          "Use corporate gateway"
        );
        if (approval !== "Use corporate gateway") {
          void vscode.window.showInformationMessage("Azure OpenAI setup cancelled before authorizing the corporate gateway. No changes were saved.");
          return;
        }
      }

      const endpoint = normalizeAzureEndpoint(endpointInput, usesCorporateGateway);
      const totalSteps = usesCorporateGateway ? 5 : 4;
      const deployment = await vscode.window.showInputBox({
        title: `Azure OpenAI setup (2/${totalSteps}) — Deployment ID`,
        prompt: "Paste the exact deployment ID used by your Azure OpenAI resource.",
        value: configuration.get<string>("azureDeployment", ""),
        placeHolder: "my-codex-deployment",
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : "Azure OpenAI deployment ID is required."
      });
      if (deployment === undefined) {
        void vscode.window.showInformationMessage(`Azure OpenAI setup cancelled at step 2/${totalSteps}. No changes were saved.`);
        return;
      }

      const apiVersion = await vscode.window.showInputBox({
        title: `Azure OpenAI setup (3/${totalSteps}) — API version`,
        prompt: "Enter an Azure API version that supports the Responses API.",
        value: configuration.get<string>("azureApiVersion", "2025-04-01-preview"),
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : "Azure OpenAI API version is required."
      });
      if (apiVersion === undefined) {
        void vscode.window.showInformationMessage(`Azure OpenAI setup cancelled at step 3/${totalSteps}. No changes were saved.`);
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        title: `Azure OpenAI setup (4/${totalSteps}) — API key`,
        prompt: existingApiKey
          ? "Enter a replacement key, or leave blank to keep the key already stored in VS Code Secret Storage."
          : "Stored in VS Code Secret Storage, never in settings or the repository.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() || existingApiKey
          ? undefined
          : "Azure OpenAI API key is required."
      });
      if (apiKey === undefined) {
        void vscode.window.showInformationMessage(`Azure OpenAI setup cancelled at step 4/${totalSteps}. No changes were saved.`);
        return;
      }
      const resolvedApiKey = apiKey.trim() || existingApiKey;
      if (!resolvedApiKey) {
        void vscode.window.showErrorMessage("Azure OpenAI API key is required.");
        return;
      }

      let caCertificateRelativePath: string | undefined;
      if (usesCorporateGateway) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
          void vscode.window.showErrorMessage("Open the workspace that contains the corporate CA .pem file, then configure Azure again.");
          return;
        }
        const trustChoice = await vscode.window.showQuickPick(
          [
            {
              label: "Select a PEM from this workspace",
              description: "Recommended when your httpx client uses a custom verify=.pem file",
              value: "pem"
            },
            {
              label: "Use the operating system trust store",
              description: "Choose only if the corporate CA is already installed on this machine",
              value: "system"
            }
          ],
          {
            title: "Azure OpenAI setup (5/5) — Corporate CA certificate",
            placeHolder: "Choose how Codex should verify the gateway TLS certificate",
            ignoreFocusOut: true
          }
        );
        if (!trustChoice) {
          void vscode.window.showInformationMessage("Azure OpenAI setup cancelled at step 5/5. No changes were saved.");
          return;
        }
        if (trustChoice.value === "pem") {
          const selected = await vscode.window.showOpenDialog({
            title: "Select the corporate CA PEM inside this workspace",
            defaultUri: workspace.uri,
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "PEM certificate bundle": ["pem"] },
            openLabel: "Use this PEM"
          });
          if (!selected?.[0]) {
            void vscode.window.showInformationMessage("Azure OpenAI setup cancelled while selecting the corporate CA certificate. No changes were saved.");
            return;
          }
          try {
            const certificate = resolveWorkspaceCertificatePath(workspace.uri.fsPath, selected[0].fsPath);
            caCertificateRelativePath = path.relative(workspace.uri.fsPath, certificate);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(message);
            return;
          }
        }
      }

      await Promise.all([
        configuration.update("azureEndpoint", endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("azureDeployment", deployment.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("azureApiVersion", apiVersion.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("allowCorporateGateway", usesCorporateGateway, vscode.ConfigurationTarget.Global),
        ...(vscode.workspace.workspaceFolders?.[0]
          ? [configuration.update(
            "corporateCaCertificatePath",
            caCertificateRelativePath,
            vscode.ConfigurationTarget.Workspace
          )]
          : []),
        context.secrets.store(AZURE_API_KEY_SECRET, resolvedApiKey)
      ]);
      await agent.reloadAzureConfiguration();
      void vscode.window.showInformationMessage(
        `Azure OpenAI configured for deployment “${deployment.trim()}”. Codex will use the isolated local runtime.`
      );
    }),
    vscode.commands.registerCommand("codexDevCompanion.clearAzureKey", async () => {
      await context.secrets.delete(AZURE_API_KEY_SECRET);
      await agent.reloadAzureConfiguration();
      void vscode.window.showInformationMessage("Azure OpenAI API key removed from Secret Storage.");
    })
  );
}

export function deactivate(): void {}
