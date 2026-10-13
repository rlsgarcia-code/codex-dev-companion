import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import { AZURE_API_KEY_SECRET, normalizeAzureEndpoint } from "./azure";
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
        title: "Azure OpenAI setup (1/4) — OpenAI API Base",
        prompt: "Paste OPENAI_API_BASE. Use the resource URL ending at /openai, without /deployments/<id>.",
        value: configuration.get<string>("azureEndpoint", ""),
        placeHolder: "https://your-resource.openai.azure.com/openai",
        ignoreFocusOut: true,
        validateInput: (value) => {
          try {
            normalizeAzureEndpoint(value);
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

      const endpoint = normalizeAzureEndpoint(endpointInput);
      const deployment = await vscode.window.showInputBox({
        title: "Azure OpenAI setup (2/4) — Deployment ID",
        prompt: "Paste the exact deployment ID used by your Azure OpenAI resource.",
        value: configuration.get<string>("azureDeployment", ""),
        placeHolder: "my-codex-deployment",
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : "Azure OpenAI deployment ID is required."
      });
      if (deployment === undefined) {
        void vscode.window.showInformationMessage("Azure OpenAI setup cancelled at step 2/4. No changes were saved.");
        return;
      }

      const apiVersion = await vscode.window.showInputBox({
        title: "Azure OpenAI setup (3/4) — API version",
        prompt: "Enter an Azure API version that supports the Responses API.",
        value: configuration.get<string>("azureApiVersion", "2025-04-01-preview"),
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : "Azure OpenAI API version is required."
      });
      if (apiVersion === undefined) {
        void vscode.window.showInformationMessage("Azure OpenAI setup cancelled at step 3/4. No changes were saved.");
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        title: "Azure OpenAI setup (4/4) — API key",
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
        void vscode.window.showInformationMessage("Azure OpenAI setup cancelled at step 4/4. No changes were saved.");
        return;
      }
      const resolvedApiKey = apiKey.trim() || existingApiKey;
      if (!resolvedApiKey) {
        void vscode.window.showErrorMessage("Azure OpenAI API key is required.");
        return;
      }

      await Promise.all([
        configuration.update("azureEndpoint", endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("azureDeployment", deployment.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("azureApiVersion", apiVersion.trim(), vscode.ConfigurationTarget.Global),
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
