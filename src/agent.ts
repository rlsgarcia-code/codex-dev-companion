import { readFile, realpath } from "node:fs/promises";
import * as path from "node:path";
import { rootCertificates } from "node:tls";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BaseMessage, HumanMessage, RemoveMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { MemorySaver, REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { ChatOpenAICompletions } from "@langchain/openai";
import {
  createDeepAgent,
  createFilesystemMiddleware,
  createSummarizationMiddleware,
  FilesystemBackend,
  StateBackend
} from "deepagents";
import { createAgent, createMiddleware } from "langchain";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import * as vscode from "vscode";
import { ContextCollector, renderContext } from "./context";
import {
  chatCompletionsBaseUrl,
  LITELLM_API_KEY_SECRET,
  resolveWorkspaceCertificatePath,
  validateLiteLlmConnection
} from "./litellm";
import { ProjectMemory } from "./memory";
import { agentRuntimeLabel, parseAgentRuntime } from "./runtime";
import { LocalToolHost } from "./tools";
import type { AgentRuntime, AgentUiEvent, RunMode } from "./types";

const CONVERSATION_KEY_PREFIX = "codexDevCompanion.localConversation";

type PersistedMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type ConversationState = {
  id: string;
  messages: PersistedMessage[];
};

export class DevelopmentAgent implements vscode.Disposable {
  private abortController: AbortController | undefined;
  private checkpointer = new MemorySaver();
  private readonly hydratedThreads = new Set<string>();
  private isRunning = false;
  private activeRuntime: AgentRuntime | undefined;

  public constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly contextCollector: ContextCollector,
    private readonly memory: ProjectMemory
  ) {
    disableExternalLangChainTracing();
  }

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
    const controller = new AbortController();
    this.abortController = controller;
    let dispatcher: UndiciAgent | undefined;
    let activeThreadId: string | undefined;
    onEvent({ type: "status", label: "Collecting workspace context" });

    try {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const runtime = parseAgentRuntime(configuration.get("agentRuntime"));
      if (this.activeRuntime && this.activeRuntime !== runtime) {
        this.checkpointer = new MemorySaver();
        this.hydratedThreads.clear();
      }
      this.activeRuntime = runtime;
      const apiKey = await this.extensionContext.secrets.get(LITELLM_API_KEY_SECRET);
      const connection = validateLiteLlmConnection({
        endpoint: configuration.get<string>("liteLlmEndpoint", ""),
        model: configuration.get<string>("liteLlmModel", ""),
        apiKey: apiKey ?? ""
      });
      const maxContextCharacters = configuration.get<number>("maxContextCharacters", 24_000);
      const maxConversationCharacters = configuration.get<number>("maxConversationCharacters", 48_000);
      const autoContext = configuration.get<boolean>("autoContext", true);
      const [memoryText, snapshot, certificateAuthorities] = await Promise.all([
        this.memory.read(),
        autoContext ? this.contextCollector.collect(maxContextCharacters) : Promise.resolve(undefined),
        this.certificateAuthorities(workspace.uri.fsPath)
      ]);
      const context = snapshot
        ? renderContext(snapshot, maxContextCharacters)
        : "Automatic editor context is disabled.";

      const conversation = this.conversation();
      activeThreadId = conversation.id;
      onEvent({ type: "thread", threadId: conversation.id });

      if (certificateAuthorities) {
        dispatcher = new UndiciAgent({ connect: { ca: certificateAuthorities } });
      }
      const model = new ChatOpenAICompletions({
        model: connection.model,
        apiKey: connection.apiKey,
        temperature: 0,
        streaming: true,
        streamUsage: true,
        maxRetries: 2,
        configuration: {
          baseURL: chatCompletionsBaseUrl(connection),
          ...(dispatcher ? {
            fetch: undiciFetch as unknown as typeof globalThis.fetch,
            fetchOptions: { dispatcher } as never
          } : {})
        }
      });
      const toolHost = new LocalToolHost(workspace.uri.fsPath, this.memory, onEvent);
      const usage = new TokenUsageHandler();

      const firstInvocation = !this.hydratedThreads.has(conversation.id);
      const messages = firstInvocation
        ? [
            ...this.compactPersistedConversation(conversation.messages, maxConversationCharacters),
            new HumanMessage(this.userMessage(request, context))
          ]
        : [new HumanMessage(this.userMessage(request, context))];

      onEvent({ type: "status", label: `${agentRuntimeLabel(runtime)} is thinking` });
      const invocationConfig = {
        configurable: { thread_id: conversation.id },
        recursionLimit: runtime === "deep" ? 50 : 30,
        signal: controller.signal,
        callbacks: [usage]
      };
      let resultMessages: BaseMessage[];
      if (runtime === "deep") {
        const workspaceBackend = new FilesystemBackend({
          rootDir: workspace.uri.fsPath,
          virtualMode: true,
          maxFileSizeMb: 1.5
        });
        const permissions = mode === "plan"
          ? [{ operations: ["write"] as const, paths: ["/**"], mode: "deny" as const }]
          : [];
        const filesystemMiddleware = createFilesystemMiddleware({
          backend: workspaceBackend,
          permissions,
          tools: mode === "plan"
            ? ["read_file", "ls", "glob", "grep"]
            : ["read_file", "ls", "glob", "grep", "write_file", "edit_file"],
          toolTokenLimitBeforeEvict: null,
          humanMessageTokenLimitBeforeEvict: null
        });
        const summarizationMiddleware = createSummarizationMiddleware({
          model,
          backend: new StateBackend(),
          trigger: { type: "messages", value: 28 },
          keep: { type: "messages", value: 14 }
        });
        const agent = createDeepAgent({
          model,
          tools: toolHost.deepTools(mode, controller.signal),
          systemPrompt: this.systemPrompt(mode, memoryText, runtime),
          middleware: [filesystemMiddleware, summarizationMiddleware],
          backend: workspaceBackend,
          permissions,
          checkpointer: this.checkpointer
        });
        const result = await agent.invoke({ messages }, invocationConfig);
        resultMessages = result.messages as BaseMessage[];
      } else {
        const agent = createAgent({
          model,
          tools: toolHost.tools(mode, controller.signal),
          systemPrompt: this.systemPrompt(mode, memoryText, runtime),
          middleware: [conversationWindowMiddleware(maxConversationCharacters)],
          checkpointer: this.checkpointer
        });
        const result = await agent.invoke({ messages }, invocationConfig);
        resultMessages = result.messages as BaseMessage[];
      }
      this.hydratedThreads.add(conversation.id);

      const answer = finalAssistantText(resultMessages);
      if (!answer) {
        throw new Error(`${agentRuntimeLabel(runtime)} completed without a final assistant message.`);
      }
      conversation.messages.push(
        { role: "user", content: request },
        { role: "assistant", content: answer }
      );
      conversation.messages = this.compactPersistedConversation(
        conversation.messages,
        maxConversationCharacters
      );
      await this.saveConversation(conversation);
      onEvent({ type: "assistant", text: answer });
      onEvent({ type: "usage", input: usage.input, output: usage.output });
      onEvent({ type: "status", label: "Ready" });
    } catch (error) {
      if (activeThreadId) this.hydratedThreads.delete(activeThreadId);
      this.checkpointer = new MemorySaver();
      if (controller.signal.aborted) {
        onEvent({ type: "status", label: "Run cancelled" });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        onEvent({ type: "error", message: this.explainError(message) });
      }
    } finally {
      await dispatcher?.close();
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
    this.contextCollector.clearPinned();
    this.checkpointer = new MemorySaver();
    this.hydratedThreads.clear();
    this.activeRuntime = undefined;
    await this.extensionContext.workspaceState.update(this.conversationStorageKey(), undefined);
  }

  public async reloadProviderConfiguration(): Promise<void> {
    await this.newThread();
  }

  public reloadRuntimeConfiguration(): void {
    this.cancel();
    this.checkpointer = new MemorySaver();
    this.hydratedThreads.clear();
    this.activeRuntime = undefined;
  }

  public dispose(): void {
    this.cancel();
  }

  private conversation(): ConversationState {
    const stored = this.extensionContext.workspaceState.get<ConversationState>(this.conversationStorageKey());
    if (stored?.id && Array.isArray(stored.messages)) return stored;
    return { id: crypto.randomUUID(), messages: [] };
  }

  private async saveConversation(conversation: ConversationState): Promise<void> {
    await this.extensionContext.workspaceState.update(this.conversationStorageKey(), conversation);
  }

  private compactPersistedConversation(
    messages: PersistedMessage[],
    maximumCharacters: number
  ): PersistedMessage[] {
    const retained: PersistedMessage[] = [];
    let characters = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      if (retained.length >= 30 || characters + message.content.length > maximumCharacters) break;
      retained.unshift(message);
      characters += message.content.length;
    }
    while (retained[0]?.role === "assistant") retained.shift();
    return retained;
  }

  private async certificateAuthorities(workspaceRoot: string): Promise<Array<string | Buffer> | undefined> {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    const configuredPath = configuration.get<string>("gatewayCaCertificatePath", "").trim();
    if (!configuredPath) return undefined;
    const candidate = resolveWorkspaceCertificatePath(workspaceRoot, configuredPath);
    const [realWorkspace, realCertificate] = await Promise.all([
      realpath(workspaceRoot),
      realpath(candidate)
    ]);
    const relative = path.relative(realWorkspace, realCertificate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Gateway CA certificate must resolve to a file inside the opened workspace.");
    }
    return [...rootCertificates, await readFile(realCertificate)];
  }

  private systemPrompt(mode: RunMode, memory: string, runtime: AgentRuntime): string {
    const operatingMode = mode === "plan"
      ? "PLAN MODE: inspect and reason, but do not edit files or run commands. Return a concrete implementation plan."
      : "EXECUTE MODE: solve the request end-to-end. Make scoped edits and run proportionate checks when useful.";
    const toolGuidance = runtime === "deep"
      ? `- Use ls, glob, grep, and read_file to inspect the workspace before making claims or edits.
- Use write_file and edit_file only for scoped workspace changes.
- Delegate bounded research or analysis to a local subagent when it materially reduces context pressure.`
      : `- Work from evidence. Inspect relevant workspace files before making claims or edits; use search_text before broad reading.
- Manage context actively. Read only relevant files and use bounded line ranges.
- Use edit_file for small exact replacements and create_file only for new files.`;
    return `You are a senior development-support agent embedded locally in Visual Studio Code.

Operating rules:
${toolGuidance}
- For non-trivial work, call update_plan before implementation and keep it current.
- All file operations must remain inside the opened workspace.
- Commands run without a shell, require user approval, and must not initiate network access.
- Preserve unrelated user changes. Prefer minimal, reviewable edits and verify important behavior.
- Reply in the user's language.
- Project memory is advisory. Save only durable, confirmed decisions with remember_project_fact; never save secrets, guesses, transient status, or raw conversation logs.
- If a tool returns an error, diagnose it and retry only with a materially corrected call.
- Never claim a tool action succeeded unless its result confirms success.

${operatingMode}

Project memory:
${memory}`;
  }

  private userMessage(request: string, context: string): string {
    return `<editor_context>
${context}
</editor_context>

<user_request>
${request}
</user_request>`;
  }

  private conversationStorageKey(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace";
    return `${CONVERSATION_KEY_PREFIX}:${workspace}`;
  }

  private explainError(message: string): string {
    if (/auth|unauthorized|forbidden|\b401\b|\b403\b/i.test(message)) {
      return `${message}\n\nCheck the LiteLLM base URL, Chat Completions model alias, virtual key, and optional CA in “Local Companion: Configure LiteLLM”.`;
    }
    if (/certificate|self[- ]signed|unable to verify|CERT_/i.test(message)) {
      return `${message}\n\nSelect the corporate CA PEM using “Local Companion: Configure LiteLLM”.`;
    }
    if (/404|not found|method not allowed|405/i.test(message)) {
      return `${message}\n\nThe configured gateway must expose POST /chat/completions. You may enter either its base URL or the complete Chat Completions URL.`;
    }
    return message;
  }
}

class TokenUsageHandler extends BaseCallbackHandler {
  public name = "local_token_usage";
  public input = 0;
  public output = 0;

  public handleLLMEnd(result: LLMResult): void {
    for (const generation of result.generations.flat()) {
      const message = (generation as { message?: unknown }).message as {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      } | undefined;
      if (message?.usage_metadata) {
        this.input += message.usage_metadata.input_tokens ?? 0;
        this.output += message.usage_metadata.output_tokens ?? 0;
      }
    }
  }
}

function conversationWindowMiddleware(maximumCharacters: number) {
  return createMiddleware({
    name: "LocalConversationWindow",
    beforeModel: (state) => {
      const messages = state.messages as BaseMessage[];
      const total = messages.reduce((sum, message) => sum + message.text.length, 0);
      if (messages.length <= 30 && total <= maximumCharacters) return undefined;

      let characters = 0;
      let start = Math.max(0, messages.length - 30);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message) continue;
        characters += message.text.length;
        if (message.type === "human") start = index;
        if ((characters >= maximumCharacters || messages.length - index >= 30) && message.type === "human") break;
      }
      return {
        messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...messages.slice(start)]
      };
    }
  });
}

function finalAssistantText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "ai" && message.text.trim()) return message.text.trim();
  }
  return "";
}

function disableExternalLangChainTracing(): void {
  process.env.LANGSMITH_TRACING = "false";
  process.env.LANGSMITH_TRACING_V2 = "false";
  process.env.LANGCHAIN_TRACING_V2 = "false";
  process.env.LANGSMITH_OTEL_ENABLED = "false";
  process.env.OTEL_ENABLED = "false";
  delete process.env.LANGCHAIN_TRACING;
}
