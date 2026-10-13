import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  Codex as CodexType,
  CodexOptions,
  Thread,
  ThreadEvent,
  ThreadItem,
  ThreadOptions
} from "@openai/codex-sdk";
import {
  LITELLM_API_KEY_SECRET,
  buildLiteLlmCodexConfig,
  buildIsolatedEnvironment,
  resolveWorkspaceCertificatePath,
  resolveWorkspaceModelCatalogPath,
  validateLiteLlmConnection
} from "./litellm";
import { ContextCollector, renderContext } from "./context";
import { ProjectMemory } from "./memory";
import type { AgentUiEvent, RunMode } from "./types";

const THREAD_KEY_PREFIX = "codexDevCompanion.thread";

type CodexConstructor = typeof import("@openai/codex-sdk").Codex;

export class DevelopmentAgent implements vscode.Disposable {
  private codex: CodexType | undefined;
  private thread: Thread | undefined;
  private abortController: AbortController | undefined;
  private isRunning = false;

  public constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly contextCollector: ContextCollector,
    private readonly memory: ProjectMemory
  ) {}

  public get running(): boolean {
    return this.isRunning;
  }

  public async run(
    request: string,
    mode: RunMode,
    onEvent: (event: AgentUiEvent) => void
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error("The agent is already working. Cancel the current run first.");
    }
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error("Open a workspace folder so the agent has a safe working directory.");
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    onEvent({ type: "status", label: "Collecting workspace context" });

    try {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const maxCharacters = configuration.get<number>("maxContextCharacters", 24_000);
      const autoContext = configuration.get<boolean>("autoContext", true);
      const memoryText = await this.memory.read();
      const snapshot = autoContext ? await this.contextCollector.collect(maxCharacters) : undefined;
      const prompt = this.buildPrompt(
        request,
        mode,
        memoryText,
        snapshot ? renderContext(snapshot, maxCharacters) : "Automatic editor context is disabled."
      );

      onEvent({ type: "status", label: "Starting Codex harness" });
      const thread = await this.getThread();
      const streamed = await thread.runStreamed(prompt, { signal: this.abortController.signal });
      for await (const event of streamed.events) {
        await this.handleEvent(event, onEvent);
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        onEvent({ type: "status", label: "Run cancelled" });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        onEvent({ type: "error", message: this.explainError(message) });
      }
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
      onEvent({ type: "done" });
    }
  }

  public cancel(): void {
    this.abortController?.abort();
  }

  public async newThread(): Promise<void> {
    this.cancel();
    this.thread = undefined;
    this.contextCollector.clearPinned();
    await this.extensionContext.workspaceState.update(this.threadStorageKey(), undefined);
  }

  public async reloadProviderConfiguration(): Promise<void> {
    await this.newThread();
    this.codex = undefined;
  }

  public dispose(): void {
    this.cancel();
  }

  private async getThread(): Promise<Thread> {
    if (this.thread) {
      return this.thread;
    }
    if (!this.codex) {
      const module = await import("@openai/codex-sdk");
      const Codex: CodexConstructor = module.Codex;
      const options = await this.codexOptions();
      this.codex = new Codex(options);
    }

    const storedThreadId = this.extensionContext.workspaceState.get<string>(this.threadStorageKey());
    const options = this.threadOptions();
    this.thread = storedThreadId
      ? this.codex.resumeThread(storedThreadId, options)
      : this.codex.startThread(options);
    return this.thread;
  }

  private threadOptions(): ThreadOptions {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const model = configuration.get<string>("liteLlmModel", "").trim();
    return {
      model,
      threadSource: "vscode-codex-dev-companion",
      workingDirectory: root,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      modelReasoningEffort: configuration.get("reasoningEffort", "high")
    };
  }

  private async codexOptions(): Promise<CodexOptions> {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    const apiKey = await this.extensionContext.secrets.get(LITELLM_API_KEY_SECRET);
    const connection = validateLiteLlmConnection({
      endpoint: configuration.get<string>("liteLlmEndpoint", ""),
      model: configuration.get<string>("liteLlmModel", ""),
      apiKey: apiKey ?? ""
    });
    const codexHome = vscode.Uri.joinPath(
      this.extensionContext.globalStorageUri,
      "local-codex-home"
    );
    await vscode.workspace.fs.createDirectory(codexHome);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let caCertificatePath: string | undefined;
    let modelCatalogPath: string | undefined;
    const configuredCertificate = configuration.get<string>("gatewayCaCertificatePath", "").trim();
    if (configuredCertificate) {
      if (!workspaceRoot) {
        throw new Error("Open the workspace containing the gateway CA certificate.");
      }
      const candidate = resolveWorkspaceCertificatePath(workspaceRoot, configuredCertificate);
      const [realWorkspace, realCertificate] = await Promise.all([
        realpath(workspaceRoot),
        realpath(candidate)
      ]);
      const relative = path.relative(realWorkspace, realCertificate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Gateway CA certificate must resolve to a file inside the opened workspace.");
      }
      const certificateStat = await vscode.workspace.fs.stat(vscode.Uri.file(realCertificate));
      if ((certificateStat.type & vscode.FileType.File) === 0) {
        throw new Error("Gateway CA certificate must be a .pem file.");
      }
      caCertificatePath = realCertificate;
    }

    const configuredCatalog = configuration.get<string>("modelCatalogPath", "").trim();
    if (configuredCatalog) {
      if (!workspaceRoot) {
        throw new Error("Open the workspace containing the model catalog.");
      }
      const candidate = resolveWorkspaceModelCatalogPath(workspaceRoot, configuredCatalog);
      const [realWorkspace, realCatalog] = await Promise.all([
        realpath(workspaceRoot),
        realpath(candidate)
      ]);
      const relative = path.relative(realWorkspace, realCatalog);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Model catalog must resolve to a file inside the opened workspace.");
      }
      const catalogStat = await vscode.workspace.fs.stat(vscode.Uri.file(realCatalog));
      if ((catalogStat.type & vscode.FileType.File) === 0) {
        throw new Error("Model catalog must be a JSON file.");
      }
      modelCatalogPath = realCatalog;
    }

    return {
      config: buildLiteLlmCodexConfig(connection, modelCatalogPath),
      env: buildIsolatedEnvironment(connection.apiKey, codexHome.fsPath, process.env, caCertificatePath)
    };
  }

  private buildPrompt(request: string, mode: RunMode, memory: string, context: string): string {
    const operatingMode = mode === "plan"
      ? "PLAN MODE: inspect and reason, but do not edit files or run mutating commands. Return a concrete implementation plan."
      : "EXECUTE MODE: solve the request end-to-end. Make scoped edits and run proportionate checks when useful.";

    return `<agent_contract>
You are a senior development-support agent running through the OpenAI Codex harness inside Visual Studio Code.
- Work from evidence. Inspect relevant repository files before making claims or edits; use rg/ripgrep first for search.
- Manage context actively: read only the files needed for the current task, summarize what matters, and avoid dumping large files.
- For non-trivial work, create and maintain a concise plan using the harness todo list before implementation.
- Respect the workspace sandbox. Never access secrets or paths outside the opened workspace unless the user explicitly authorizes it.
- Preserve unrelated user changes. Prefer minimal, reviewable patches and verify important behavior.
- Reply in the user's language.
- Project memory lives at .codex-agent/memory.md. Read it as advisory context. Update it only for durable, confirmed decisions or conventions; never store secrets, guesses, transient status, or raw conversation logs.
${operatingMode}
</agent_contract>

<project_memory>
${memory}
</project_memory>

<editor_context>
${context}
</editor_context>

<user_request>
${request}
</user_request>`;
  }

  private async handleEvent(
    event: ThreadEvent,
    onEvent: (event: AgentUiEvent) => void
  ): Promise<void> {
    switch (event.type) {
      case "thread.started":
        await this.extensionContext.workspaceState.update(this.threadStorageKey(), event.thread_id);
        onEvent({ type: "thread", threadId: event.thread_id });
        break;
      case "turn.started":
        onEvent({ type: "status", label: "Agent is working" });
        break;
      case "item.started":
      case "item.updated":
      case "item.completed":
        this.handleItem(event.item, event.type === "item.completed", onEvent);
        break;
      case "turn.completed":
        onEvent({
          type: "usage",
          input: event.usage.input_tokens,
          output: event.usage.output_tokens
        });
        onEvent({ type: "status", label: "Ready" });
        break;
      case "turn.failed":
        onEvent({ type: "error", message: event.error.message });
        break;
      case "error":
        onEvent({ type: "error", message: event.message });
        break;
    }
  }

  private handleItem(
    item: ThreadItem,
    completed: boolean,
    onEvent: (event: AgentUiEvent) => void
  ): void {
    switch (item.type) {
      case "todo_list":
        onEvent({ type: "plan", items: item.items });
        break;
      case "agent_message":
        if (completed) {
          onEvent({ type: "assistant", text: item.text });
        }
        break;
      case "reasoning":
        onEvent({ type: "status", label: item.text || "Reasoning" });
        break;
      case "command_execution":
        onEvent({
          type: "activity",
          kind: "command",
          title: item.command,
          detail: completed ? item.aggregated_output.slice(-1800) : undefined
        });
        break;
      case "file_change":
        onEvent({
          type: "activity",
          kind: "files",
          title: item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n")
        });
        break;
      case "mcp_tool_call":
        onEvent({ type: "activity", kind: "tool", title: `${item.server} / ${item.tool}` });
        break;
      case "web_search":
        onEvent({ type: "activity", kind: "search", title: item.query });
        break;
      case "error":
        onEvent({ type: "error", message: item.message });
        break;
    }
  }

  private threadStorageKey(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace";
    return `${THREAD_KEY_PREFIX}:${workspace}`;
  }

  private explainError(message: string): string {
    if (/login|auth|unauthorized|401/i.test(message)) {
      return `${message}\n\nCheck the LiteLLM base URL, model alias, virtual key, and optional CA in “Codex Companion: Configure LiteLLM”.`;
    }
    if (/ENOENT|not found|spawn/i.test(message)) {
      return `${message}\n\nThe bundled Codex runtime was not found. Reinstall the extension or its dependencies.`;
    }
    return message;
  }
}
