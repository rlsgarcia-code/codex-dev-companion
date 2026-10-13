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
      const endpointInput = await vscode.window.showInputBox({
        title: "Azure OpenAI endpoint",
        prompt: "Only this HTTPS endpoint will receive model requests.",
        value: configuration.get<string>("azureEndpoint", ""),
        placeHolder: "https://your-resource.openai.azure.com/openai",
        ignoreFocusOut: true
      });
      if (endpointInput === undefined) return;

      let endpoint: string;
      try {
        endpoint = normalizeAzureEndpoint(endpointInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(message);
        return;
      }

      const deployment = await vscode.window.showInputBox({
        title: "Azure OpenAI deployment",
        prompt: "Enter the Azure deployment name used by the Responses API.",
        value: configuration.get<string>("azureDeployment", ""),
        ignoreFocusOut: true
      });
      if (deployment === undefined || !deployment.trim()) return;

      const apiVersion = await vscode.window.showInputBox({
        title: "Azure OpenAI API version",
        value: configuration.get<string>("azureApiVersion", "2025-04-01-preview"),
        ignoreFocusOut: true
      });
      if (apiVersion === undefined || !apiVersion.trim()) return;

      const apiKey = await vscode.window.showInputBox({
        title: "Azure OpenAI API key",
        prompt: "Stored in VS Code Secret Storage, never in settings or the repository.",
        password: true,
        ignoreFocusOut: true
      });
      if (apiKey === undefined || !apiKey.trim()) return;

      await Promise.all([
        configuration.update("azureEndpoint", endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("azureDeployment", deployment.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("azureApiVersion", apiVersion.trim(), vscode.ConfigurationTarget.Global),
        context.secrets.store(AZURE_API_KEY_SECRET, apiKey.trim())
      ]);
      await agent.reloadAzureConfiguration();
      void vscode.window.showInformationMessage("Azure OpenAI configured. Codex will use the isolated local runtime.");
    }),
    vscode.commands.registerCommand("codexDevCompanion.clearAzureKey", async () => {
      await context.secrets.delete(AZURE_API_KEY_SECRET);
      await agent.reloadAzureConfiguration();
      void vscode.window.showInformationMessage("Azure OpenAI API key removed from Secret Storage.");
    })
  );
}

export function deactivate(): void {}
