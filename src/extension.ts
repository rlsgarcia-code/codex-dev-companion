import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import { ChangeReviewManager } from "./change-review";
import { LITELLM_API_KEY_SECRET } from "./litellm";
import { ContextCollector } from "./context";
import { ProjectMemory } from "./memory";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import { AgentViewProvider } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const collector = new ContextCollector();
  const memory = new ProjectMemory();
  const changeReview = new ChangeReviewManager();
  const agent = new DevelopmentAgent(context, collector, memory, changeReview);
  const provider = new AgentViewProvider(context, agent, collector, memory, changeReview);

  context.subscriptions.push(
    agent,
    provider,
    changeReview,
    vscode.workspace.registerTextDocumentContentProvider(ChangeReviewManager.scheme, changeReview),
    vscode.window.registerWebviewViewProvider("codexDevCompanion.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("codexDevCompanion.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.codexDevCompanion");
      provider.reveal();
    }),
    vscode.commands.registerCommand("codexDevCompanion.newThread", async () => {
      try {
        await provider.newThread();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("codexDevCompanion.addSelection", () => provider.addSelection()),
    vscode.commands.registerCommand("codexDevCompanion.addFileContext", () => provider.addFileContext()),
    vscode.commands.registerCommand("codexDevCompanion.remember", async () => {
      const note = await vscode.window.showInputBox({
        title: "Remember for this project",
        prompt: "Save a durable decision, convention, or fact. Do not store secrets.",
        placeHolder: "Example: Use Vitest for new unit tests"
      });
      if (!note) return;
      const storedSecret = await context.secrets.get(LITELLM_API_KEY_SECRET);
      if (redactSensitiveText(note, storedSecret ? [storedSecret] : []) !== note) {
        void vscode.window.showErrorMessage("Project memory cannot contain gateway keys or other detected credentials.");
        return;
      }
      const uri = await memory.append(note);
      void vscode.window.showInformationMessage(`Project memory updated: ${vscode.workspace.asRelativePath(uri)}`);
    }),
    vscode.commands.registerCommand("codexDevCompanion.configureLiteLlm", async () => {
      await provider.openConnectionSettings();
    }),
    vscode.commands.registerCommand("codexDevCompanion.clearLiteLlmKey", async () => {
      await context.secrets.delete(LITELLM_API_KEY_SECRET);
      await agent.reloadProviderConfiguration();
      void vscode.window.showInformationMessage("Gateway key removed from Secret Storage.");
    })
  );
}

export function deactivate(): void {}
