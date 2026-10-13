import * as path from "node:path";
import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import {
  LITELLM_API_KEY_SECRET,
  normalizeLiteLlmEndpoint,
  resolveWorkspaceCertificatePath
} from "./litellm";
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
    vscode.commands.registerCommand("codexDevCompanion.configureLiteLlm", async () => {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const existingApiKey = await context.secrets.get(LITELLM_API_KEY_SECRET);
      const endpointInput = await vscode.window.showInputBox({
        title: "LiteLLM setup (1/4) — Gateway base URL",
        prompt: "Enter the HTTPS client-facing URL ending in /v1. Do not include /responses.",
        value: configuration.get<string>("liteLlmEndpoint", ""),
        placeHolder: "https://gateway.example.com/v1",
        ignoreFocusOut: true,
        validateInput: (value) => {
          try {
            normalizeLiteLlmEndpoint(value);
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }
      });
      if (endpointInput === undefined) {
        void vscode.window.showInformationMessage("LiteLLM setup cancelled at step 1/4. No changes were saved.");
        return;
      }
      const endpoint = normalizeLiteLlmEndpoint(endpointInput);
      const model = await vscode.window.showInputBox({
        title: "LiteLLM setup (2/4) — Model alias",
        prompt: "Enter the exact client-facing alias configured by the LiteLLM administrator.",
        value: configuration.get<string>("liteLlmModel", ""),
        placeHolder: "company-coding-model",
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : "LiteLLM model alias is required."
      });
      if (model === undefined) {
        void vscode.window.showInformationMessage("LiteLLM setup cancelled at step 2/4. No changes were saved.");
        return;
      }
      const apiKey = await vscode.window.showInputBox({
        title: "LiteLLM setup (3/4) — Virtual key",
        prompt: existingApiKey
          ? "Enter a replacement virtual key, or leave blank to keep the stored key."
          : "Use a scoped LiteLLM virtual key. It is stored only in VS Code Secret Storage.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() || existingApiKey
          ? undefined
          : "LiteLLM virtual key is required."
      });
      if (apiKey === undefined) {
        void vscode.window.showInformationMessage("LiteLLM setup cancelled at step 3/4. No changes were saved.");
        return;
      }
      const resolvedApiKey = apiKey.trim() || existingApiKey;
      if (!resolvedApiKey) {
        void vscode.window.showErrorMessage("LiteLLM virtual key is required.");
        return;
      }

      let caCertificateRelativePath: string | undefined;
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        void vscode.window.showErrorMessage("Open the workspace that will contain the optional gateway CA PEM file.");
        return;
      }
      const trustChoice = await vscode.window.showQuickPick(
        [
          {
            label: "Use the operating system trust store",
            description: "Recommended when the LiteLLM gateway certificate is already trusted",
            value: "system"
          },
          {
            label: "Select a PEM from this workspace",
            description: "Use a local corporate CA bundle for the gateway certificate",
            value: "pem"
          }
        ],
        {
          title: "LiteLLM setup (4/4) — Gateway CA certificate",
          placeHolder: "Choose how Codex should verify the LiteLLM gateway certificate",
          ignoreFocusOut: true
        }
      );
      if (!trustChoice) {
        void vscode.window.showInformationMessage("LiteLLM setup cancelled at step 4/4. No changes were saved.");
        return;
      }
      if (trustChoice.value === "pem") {
        const selected = await vscode.window.showOpenDialog({
          title: "Select the gateway CA PEM inside this workspace",
          defaultUri: workspace.uri,
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "PEM certificate bundle": ["pem"] },
          openLabel: "Use this PEM"
        });
        if (!selected?.[0]) {
          void vscode.window.showInformationMessage("LiteLLM setup cancelled while selecting the CA certificate. No changes were saved.");
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

      await Promise.all([
        configuration.update("liteLlmEndpoint", endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModel", model.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("gatewayCaCertificatePath", caCertificateRelativePath, vscode.ConfigurationTarget.Workspace),
        context.secrets.store(LITELLM_API_KEY_SECRET, resolvedApiKey)
      ]);
      await agent.reloadProviderConfiguration();
      void vscode.window.showInformationMessage(
        `LiteLLM configured for model alias “${model.trim()}”. Codex will use the isolated local runtime.`
      );
    }),
    vscode.commands.registerCommand("codexDevCompanion.clearLiteLlmKey", async () => {
      await context.secrets.delete(LITELLM_API_KEY_SECRET);
      await agent.reloadProviderConfiguration();
      void vscode.window.showInformationMessage("LiteLLM virtual key removed from Secret Storage.");
    })
  );
}

export function deactivate(): void {}
