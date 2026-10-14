import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import {
  LITELLM_API_KEY_SECRET,
  LITELLM_MODEL_CAPABILITIES,
  liteLlmModelProfile,
  normalizeLiteLlmEndpoint,
  normalizeLiteLlmModelsEndpoint,
  parseLiteLlmAuthHeader,
  parseLiteLlmModelPreset,
  parseLiteLlmModelProfiles,
  parseLiteLlmReasoningEffort,
  parseOptionalTemperature,
  parseOptionalTopP,
  resolveLiteLlmModelPreset,
  updateLiteLlmModelProfile,
  validateLiteLlmConnection,
  validateLiteLlmModelProfile
} from "./litellm";
import type {
  LiteLlmAuthHeader,
  LiteLlmModelCapabilities,
  LiteLlmModelPreset,
  LiteLlmModelProfiles,
  LiteLlmReasoningEffort
} from "./litellm";
import { ContextCollector } from "./context";
import { ProjectMemory } from "./memory";
import { agentRuntimeLabel, parseAgentRuntime } from "./runtime";
import type { AgentRuntime, AgentUiEvent, ChatMessage, RunMode } from "./types";

const HISTORY_KEY = "codexDevCompanion.history";
const MAX_HISTORY = 60;

type IncomingMessage =
  | { type: "ready" }
  | { type: "send"; text: string; mode: RunMode }
  | { type: "cancel" }
  | { type: "newThread" }
  | { type: "remember"; text: string }
  | { type: "openMemory" }
  | { type: "configureLiteLlm" }
  | { type: "listModels"; endpoint: string; apiKey: string }
  | { type: "selectRuntime"; runtime: AgentRuntime }
  | {
      type: "saveLiteLlm";
      endpoint: string;
      model: string;
      apiKey: string;
      authHeader: LiteLlmAuthHeader;
      modelsEndpoint: string;
      preset: string;
      reasoningEffort: string;
      temperature: string;
      topP: string;
    };

type LiteLlmSettingsSnapshot = {
  endpoint: string;
  modelsEndpoint: string;
  model: string;
  hasApiKey: boolean;
  caCertificatePath: string;
  runtime: AgentRuntime;
  authHeader: LiteLlmAuthHeader;
  modelProfiles: LiteLlmModelProfiles;
  preset: LiteLlmModelPreset;
  resolvedPreset: Exclude<LiteLlmModelPreset, "auto">;
  capabilities: LiteLlmModelCapabilities;
  reasoningEffort?: LiteLlmReasoningEffort;
  temperature?: number;
  topP?: number;
};

export class AgentViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly agent: DevelopmentAgent,
    private readonly collector: ContextCollector,
    private readonly memory: ProjectMemory
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: IncomingMessage) => void this.handleMessage(message))
    );
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  public async addSelection(): Promise<void> {
    const filename = this.collector.pinSelection();
    if (!filename) {
      void vscode.window.showInformationMessage("Select code before adding it to the local agent context.");
      return;
    }
    this.post({ type: "contextPinned", filename });
    this.reveal();
  }

  public async newThread(): Promise<void> {
    await this.agent.newThread();
    await this.saveHistory([]);
    this.post({ type: "reset" });
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post({
          type: "hydrate",
          history: this.history(),
          workspace: vscode.workspace.name ?? "No workspace",
          activeFile: this.activeFileLabel(),
          liteLlm: await this.liteLlmSettingsSnapshot()
        });
        break;
      case "send":
        await this.send(message.text, message.mode);
        break;
      case "cancel":
        this.agent.cancel();
        break;
      case "newThread":
        try {
          await this.newThread();
        } catch (error) {
          this.post({
            type: "newThreadError",
            message: error instanceof Error ? error.message : String(error)
          });
        }
        break;
      case "remember":
        await this.remember(message.text);
        break;
      case "openMemory":
        await this.memory.open();
        break;
      case "configureLiteLlm":
        await vscode.commands.executeCommand("codexDevCompanion.configureLiteLlm");
        this.post({ type: "liteLlmSettings", liteLlm: await this.liteLlmSettingsSnapshot() });
        break;
      case "listModels":
        await this.listModels(message.endpoint, message.apiKey);
        break;
      case "selectRuntime":
        await this.selectRuntime(message.runtime);
        break;
      case "saveLiteLlm":
        await this.saveLiteLlmSettings(message);
        break;
    }
  }

  private async liteLlmSettingsSnapshot(): Promise<LiteLlmSettingsSnapshot> {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    const model = configuration.get<string>("liteLlmModel", "");
    const modelProfiles = parseLiteLlmModelProfiles(configuration.get("liteLlmModelProfiles"));
    const profile = liteLlmModelProfile(modelProfiles, model);
    const resolvedPreset = resolveLiteLlmModelPreset(model, profile.preset);
    return {
      endpoint: configuration.get<string>("liteLlmEndpoint", ""),
      modelsEndpoint: configuration.get<string>("liteLlmModelsEndpoint", ""),
      model,
      hasApiKey: Boolean(await this.extensionContext.secrets.get(LITELLM_API_KEY_SECRET)),
      caCertificatePath: configuration.get<string>("gatewayCaCertificatePath", ""),
      runtime: parseAgentRuntime(configuration.get("agentRuntime")),
      authHeader: parseLiteLlmAuthHeader(configuration.get("liteLlmAuthHeader")),
      modelProfiles,
      preset: parseLiteLlmModelPreset(profile.preset),
      resolvedPreset,
      capabilities: LITELLM_MODEL_CAPABILITIES[resolvedPreset],
      reasoningEffort: profile.reasoningEffort,
      temperature: profile.temperature,
      topP: profile.topP
    };
  }

  private async listModels(endpointInput: string, transientApiKey: string): Promise<void> {
    try {
      const endpoint = normalizeLiteLlmModelsEndpoint(endpointInput);
      const models = await this.agent.listModels(endpoint, transientApiKey);
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      await configuration.update("liteLlmModelsEndpoint", endpoint, vscode.ConfigurationTarget.Global);
      this.post({ type: "modelsLoaded", models, endpoint, message: `${models.length} models loaded` });
    } catch (error) {
      this.post({
        type: "modelsLoadError",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async selectRuntime(value: unknown): Promise<void> {
    try {
      const runtime = parseAgentRuntime(value);
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      await configuration.update("agentRuntime", runtime, vscode.ConfigurationTarget.Workspace);
      this.agent.reloadRuntimeConfiguration();
      this.post({
        type: "runtimeChanged",
        runtime,
        message: `${agentRuntimeLabel(runtime)} selected for this workspace`
      });
    } catch (error) {
      this.post({
        type: "runtimeChangeError",
        liteLlm: await this.liteLlmSettingsSnapshot(),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async saveLiteLlmSettings(message: Extract<IncomingMessage, { type: "saveLiteLlm" }>): Promise<void> {
    try {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const existingApiKey = await this.extensionContext.secrets.get(LITELLM_API_KEY_SECRET);
      const apiKey = message.apiKey.trim() || existingApiKey || "";
      const connection = validateLiteLlmConnection({
        endpoint: normalizeLiteLlmEndpoint(message.endpoint),
        model: message.model,
        apiKey,
        authHeader: parseLiteLlmAuthHeader(message.authHeader)
      });
      const modelsEndpoint = message.modelsEndpoint.trim()
        ? normalizeLiteLlmModelsEndpoint(message.modelsEndpoint)
        : "";
      const preset = parseLiteLlmModelPreset(message.preset);
      const reasoningEffort = message.reasoningEffort === "omit"
        ? undefined
        : parseLiteLlmReasoningEffort(message.reasoningEffort);
      if (message.reasoningEffort !== "omit" && !reasoningEffort) {
        throw new Error("Choose a supported reasoning effort or omit the parameter.");
      }
      const temperature = parseOptionalTemperature(message.temperature);
      const topP = parseOptionalTopP(message.topP);
      const modelProfiles = updateLiteLlmModelProfile(
        configuration.get("liteLlmModelProfiles"),
        connection.model,
        { preset, reasoningEffort, temperature, topP }
      );
      validateLiteLlmModelProfile(connection.model, liteLlmModelProfile(modelProfiles, connection.model));
      await Promise.all([
        configuration.update("liteLlmEndpoint", connection.endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModel", connection.model, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelsEndpoint", modelsEndpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmAuthHeader", connection.authHeader, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelProfiles", modelProfiles, vscode.ConfigurationTarget.Global),
        ...(message.apiKey.trim()
          ? [this.extensionContext.secrets.store(LITELLM_API_KEY_SECRET, message.apiKey.trim())]
          : [])
      ]);
      await this.agent.reloadProviderConfiguration();
      this.post({
        type: "liteLlmSaved",
        liteLlm: await this.liteLlmSettingsSnapshot(),
        message: `LiteLLM updated · ${connection.model}`
      });
    } catch (error) {
      this.post({
        type: "liteLlmSaveError",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async send(text: string, mode: RunMode): Promise<void> {
    const clean = text.trim();
    if (!clean) {
      return;
    }
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: clean,
      createdAt: Date.now()
    };
    await this.appendHistory(userMessage);
    this.post({ type: "user", message: userMessage });
    this.post({ type: "busy", value: true });

    await this.agent.run(clean, mode, (event) => void this.forwardAgentEvent(event));
  }

  private async forwardAgentEvent(event: AgentUiEvent): Promise<void> {
    if (event.type === "assistant") {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: event.text,
        createdAt: Date.now()
      };
      await this.appendHistory(assistantMessage);
      this.post({ type: "assistant", message: assistantMessage });
      return;
    }
    if (event.type === "done") {
      this.post({ type: "busy", value: false });
    }
    this.post(event);
  }

  private async remember(note: string): Promise<void> {
    try {
      const uri = await this.memory.append(note);
      this.post({ type: "toast", message: `Saved to ${vscode.workspace.asRelativePath(uri)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: "error", message });
    }
  }

  private history(): ChatMessage[] {
    return this.extensionContext.workspaceState.get<ChatMessage[]>(HISTORY_KEY, []);
  }

  private async appendHistory(message: ChatMessage): Promise<void> {
    await this.saveHistory([...this.history(), message].slice(-MAX_HISTORY));
  }

  private async saveHistory(messages: ChatMessage[]): Promise<void> {
    await this.extensionContext.workspaceState.update(HISTORY_KEY, messages);
  }

  private activeFileLabel(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor ? vscode.workspace.asRelativePath(editor.document.uri) : undefined;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <style nonce="${nonce}">${styles}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">LOCAL / DEVELOPMENT</div>
        <h1>Companion</h1>
      </div>
      <button class="icon-button" id="new-thread" title="New thread" aria-label="New thread">↺</button>
    </header>

    <section class="presence" aria-live="polite">
      <span class="signal" id="signal"></span>
      <span id="status">Ready</span>
      <span class="workspace" id="workspace"></span>
    </section>

    <section class="plan hidden" id="plan">
      <div class="section-label">CURRENT PLAN</div>
      <ol id="plan-items"></ol>
    </section>

    <section class="settings-panel hidden" id="litellm-settings" aria-label="LiteLLM settings">
      <div class="settings-heading">
        <div>
          <div class="section-label">LITELLM GATEWAY</div>
          <h2>Connection</h2>
        </div>
        <button class="icon-button settings-close" id="litellm-close" title="Close settings" aria-label="Close settings">×</button>
      </div>
      <label class="field">
        <span>Gateway Base URL</span>
        <input id="litellm-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway.example.com/v1 or …/chat/completions" />
      </label>
      <div class="field">
        <span>Models URL <small>optional</small></span>
        <div class="input-action">
          <input id="litellm-models-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway.example.com/models" />
          <button class="secondary-action" id="litellm-load-models">Load</button>
        </div>
      </div>
      <label class="field">
        <span>Model Alias</span>
        <input id="litellm-model" type="text" list="litellm-model-aliases" autocomplete="off" spellcheck="false" placeholder="company-coding-model" />
        <datalist id="litellm-model-aliases"></datalist>
      </label>
      <label class="field">
        <span>Compatibility profile</span>
        <select id="litellm-model-preset">
          <option value="auto">Auto-detect from alias</option>
          <option value="gpt-6-chat-tools">GPT-6 Sol / Luna · Chat tools</option>
          <option value="gpt-6-responses-tools">GPT-6 Astra / 6.1 Sol</option>
          <option value="gpt-5.6">GPT-5.6 family</option>
          <option value="gpt-5-reasoning">GPT-5.2–5.5 reasoning</option>
          <option value="gpt-standard">GPT-4 / 4o standard</option>
          <option value="claude-modern">Claude 4.7+ / Claude 5</option>
          <option value="claude-4.6">Claude 4.6 adaptive thinking</option>
          <option value="claude-legacy">Claude 4.5 or earlier</option>
          <option value="custom">Custom / gateway-defined</option>
        </select>
      </label>
      <label class="field">
        <span>Reasoning effort</span>
        <select id="litellm-reasoning-effort">
          <option value="omit">Omit from request</option>
          <option value="none">none · function tools compatibility</option>
          <option value="minimal">minimal</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="xhigh">xhigh</option>
          <option value="max">max</option>
        </select>
      </label>
      <div class="field-grid">
        <label class="field">
          <span>Temperature <small>optional</small></span>
          <input id="litellm-temperature" type="number" step="any" inputmode="decimal" placeholder="Omit" />
        </label>
        <label class="field">
          <span>Top P <small>optional</small></span>
          <input id="litellm-top-p" type="number" min="0" max="1" step="any" inputmode="decimal" placeholder="Omit" />
        </label>
      </div>
      <p class="settings-note" id="litellm-capabilities"></p>
      <label class="field">
        <span>Key Header</span>
        <select id="litellm-auth-header">
          <option value="authorization">Authorization: Bearer</option>
          <option value="api-key">api-key</option>
          <option value="ocp-apim-subscription-key">Ocp-Apim-Subscription-Key</option>
        </select>
      </label>
      <label class="field">
        <span>Gateway Key <small id="litellm-key-state"></small></span>
        <input id="litellm-api-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the stored key" />
      </label>
      <p class="settings-note" id="litellm-details"></p>
      <p class="settings-error hidden" id="litellm-settings-error"></p>
      <div class="settings-actions">
        <button class="secondary-action" id="litellm-advanced">Setup wizard / PEM</button>
        <button class="primary-action" id="litellm-save">Save connection</button>
      </div>
    </section>

    <section class="timeline" id="timeline" aria-live="polite">
      <div class="welcome" id="welcome">
        <div class="monogram">C</div>
        <h2>Work with the codebase,<br/>not around it.</h2>
        <p>I can inspect files, reason across the project, make scoped changes, run checks, and remember durable decisions.</p>
        <div class="starters">
          <button data-prompt="Mapeie a arquitetura deste projeto e identifique os principais fluxos.">Map architecture</button>
          <button data-prompt="Analise os diagnósticos atuais e proponha a correção mais segura.">Fix diagnostics</button>
          <button data-prompt="Revise as mudanças atuais, encontre riscos e sugira melhorias.">Review changes</button>
        </div>
      </div>
    </section>

    <footer class="composer-wrap">
      <div class="context-row">
        <span class="context-chip" id="active-file">No active file</span>
        <span class="utility-links"><button class="memory-link" id="litellm">LiteLLM</button><button class="memory-link" id="memory">Memory</button></span>
      </div>
      <div class="composer">
        <textarea id="prompt" rows="3" placeholder="Ask about the code, request a change, or explore an idea…"></textarea>
        <div class="composer-actions">
          <select id="runtime" aria-label="Agent runtime" title="Choose the agent runtime">
            <option value="standard">LangChain Agent</option>
            <option value="deep">Deep Agent</option>
          </select>
          <select id="mode" aria-label="Agent mode">
            <option value="execute">Execute</option>
            <option value="plan">Plan only</option>
          </select>
          <button class="cancel hidden" id="cancel">Cancel</button>
          <button class="send" id="send" aria-label="Send">↑</button>
        </div>
      </div>
      <div class="hint">Enter to send · Shift+Enter for newline</div>
    </footer>
  </main>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
  }
}

const styles = String.raw`
:root { color-scheme: light dark; --accent: #d6ff45; --muted: var(--vscode-descriptionForeground); --line: color-mix(in srgb, var(--vscode-foreground) 14%, transparent); }
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.5 var(--vscode-font-family); }
button, textarea, select { font: inherit; }
button { color: inherit; }
.shell { min-height: 100vh; display: grid; grid-template-rows: auto auto auto auto 1fr auto; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 18px 13px; border-bottom: 1px solid var(--line); }
.eyebrow, .section-label { color: var(--muted); font: 600 9px/1.2 var(--vscode-editor-font-family); letter-spacing: .16em; }
h1 { margin: 2px 0 0; font-size: 24px; line-height: 1; letter-spacing: -.045em; }
.icon-button { border: 0; background: transparent; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 18px; opacity: .7; transition: opacity .15s, background .15s; }
.icon-button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
.icon-button:disabled { cursor: default; opacity: .3; }
.presence { display: flex; align-items: center; gap: 8px; padding: 9px 18px; color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); }
.signal { width: 7px; height: 7px; border-radius: 50%; background: #6ddc72; box-shadow: 0 0 0 3px color-mix(in srgb, #6ddc72 16%, transparent); }
.signal.busy { background: var(--accent); animation: pulse 1.2s infinite; }
.workspace { margin-left: auto; max-width: 45%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.plan { padding: 13px 18px 10px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--accent)); animation: reveal .2s ease-out; }
.plan ol { list-style: none; margin: 9px 0 0; padding: 0; display: grid; gap: 7px; }
.plan li { position: relative; padding-left: 18px; color: var(--muted); font-size: 11px; }
.plan li::before { content: ''; position: absolute; left: 0; top: .45em; width: 7px; height: 7px; border: 1px solid currentColor; border-radius: 50%; }
.plan li.done { color: var(--vscode-foreground); text-decoration: line-through; opacity: .66; }
.plan li.done::before { background: var(--accent); border-color: var(--accent); }
.settings-panel { padding: 14px 18px 16px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .2s ease-out; }
.settings-heading { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.settings-heading h2 { margin: 3px 0 0; font-size: 16px; line-height: 1.1; letter-spacing: -.025em; }
.settings-close { margin-top: -5px; }
.field { display: grid; gap: 4px; margin-top: 9px; color: var(--muted); font-size: 10px; }
.field span, .local-setting > div > span { font-weight: 600; letter-spacing: .02em; }
.field small, .local-setting small { font-weight: 400; opacity: .75; }
.field input, .field select { width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid var(--line); border-radius: 4px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: 11px/1.3 var(--vscode-editor-font-family); }
.field input:focus, .field select:focus { border-color: color-mix(in srgb, var(--accent) 62%, transparent); }
.input-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.local-setting { display: flex; align-items: end; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.local-setting > div:first-child { min-width: 0; display: grid; gap: 3px; }
.local-setting code { overflow: hidden; color: var(--vscode-foreground); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.inline-actions, .settings-actions { display: flex; align-items: center; gap: 6px; }
.inline-actions button, .secondary-action, .primary-action { border: 0; border-radius: 4px; padding: 5px 7px; cursor: pointer; font-size: 10px; }
.inline-actions button, .secondary-action { color: var(--muted); background: var(--vscode-button-secondaryBackground); }
.primary-action { margin-left: auto; color: #111; background: var(--accent); font-weight: 650; }
.settings-note { min-height: 1.4em; margin: 8px 0 0; color: var(--muted); font-size: 10px; }
.settings-error { margin: 8px 0 0; color: var(--vscode-errorForeground); font-size: 10px; white-space: pre-wrap; }
.settings-actions { margin-top: 12px; }
.timeline { min-height: 0; overflow-y: auto; padding: 0 18px 32px; }
.welcome { padding: 48px 0 24px; animation: reveal .35s ease-out; }
.monogram { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 24px; border-radius: 10px; background: var(--accent); color: #111; font-weight: 800; font-size: 18px; transform: rotate(-3deg); }
.welcome h2 { margin: 0; font-size: 22px; line-height: 1.12; letter-spacing: -.035em; }
.welcome p { max-width: 310px; margin: 13px 0 23px; color: var(--muted); }
.starters { display: grid; border-top: 1px solid var(--line); }
.starters button { text-align: left; padding: 11px 2px; border: 0; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; transition: padding-left .15s, color .15s; }
.starters button:hover { padding-left: 6px; color: var(--accent); }
.message { padding: 18px 0; border-bottom: 1px solid var(--line); animation: reveal .2s ease-out; }
.message-role { margin-bottom: 7px; color: var(--muted); font: 600 9px/1 var(--vscode-editor-font-family); letter-spacing: .14em; }
.message.user .message-body { font-size: 14px; }
.message.assistant .message-body { line-height: 1.62; }
.message-body pre { overflow-x: auto; padding: 11px; background: var(--vscode-textCodeBlock-background); border-left: 2px solid var(--accent); font: 11px/1.55 var(--vscode-editor-font-family); }
.message-body code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textPreformat-foreground); }
.activity { padding: 8px 0; color: var(--muted); font: 10px/1.45 var(--vscode-editor-font-family); border-bottom: 1px dotted var(--line); }
.activity strong { color: var(--vscode-foreground); font-weight: 500; }
.activity details pre { white-space: pre-wrap; max-height: 160px; overflow: auto; }
.error { margin: 12px 0; padding: 10px 0 10px 12px; border-left: 2px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); white-space: pre-wrap; }
.composer-wrap { position: sticky; bottom: 0; padding: 9px 12px 12px; background: linear-gradient(transparent, var(--vscode-sideBar-background) 14%); }
.context-row { display: flex; align-items: center; justify-content: space-between; min-height: 25px; padding: 0 5px; }
.context-chip { max-width: 70%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font: 10px var(--vscode-editor-font-family); }
.memory-link { border: 0; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.memory-link:hover { color: var(--accent); }
.utility-links { display: flex; align-items: center; gap: 2px; }
.composer { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent); border-radius: 9px; background: var(--vscode-input-background); box-shadow: 0 10px 30px color-mix(in srgb, #000 18%, transparent); transition: border-color .15s, transform .15s; }
.composer:focus-within { border-color: color-mix(in srgb, var(--accent) 62%, transparent); transform: translateY(-1px); }
textarea { display: block; width: 100%; resize: none; padding: 11px 12px 2px; color: var(--vscode-input-foreground); background: transparent; border: 0; outline: 0; }
.composer-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 5px 7px 7px; }
select, .cancel { border: 0; border-radius: 5px; color: var(--muted); background: transparent; padding: 4px 6px; font-size: 10px; }
.cancel { cursor: pointer; }
.send { display: grid; place-items: center; width: 27px; height: 27px; border: 0; border-radius: 7px; background: var(--accent); color: #111; cursor: pointer; font-size: 17px; font-weight: 700; transition: transform .12s, opacity .12s; }
.send:hover { transform: translateY(-1px); }
.send:disabled { opacity: .35; cursor: default; transform: none; }
.hint { padding: 5px 5px 0; color: var(--muted); text-align: center; font-size: 9px; }
.hidden { display: none !important; }
@keyframes pulse { 0%,100% { opacity: .55; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); } 50% { opacity: 1; box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 5%, transparent); } }
@keyframes reveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
`;

const script = String.raw`
const vscode = acquireVsCodeApi();
const modelCapabilityCatalog = ${JSON.stringify(LITELLM_MODEL_CAPABILITIES)};
const timeline = document.getElementById('timeline');
const welcomeMarkup = timeline.innerHTML;
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const cancel = document.getElementById('cancel');
const status = document.getElementById('status');
const signal = document.getElementById('signal');
const plan = document.getElementById('plan');
const planItems = document.getElementById('plan-items');
const liteLlmSettings = document.getElementById('litellm-settings');
const liteLlmEndpoint = document.getElementById('litellm-endpoint');
const liteLlmModelsEndpoint = document.getElementById('litellm-models-endpoint');
const liteLlmModel = document.getElementById('litellm-model');
const liteLlmModelAliases = document.getElementById('litellm-model-aliases');
const liteLlmReasoningEffort = document.getElementById('litellm-reasoning-effort');
const liteLlmModelPreset = document.getElementById('litellm-model-preset');
const liteLlmTemperature = document.getElementById('litellm-temperature');
const liteLlmTopP = document.getElementById('litellm-top-p');
const liteLlmCapabilities = document.getElementById('litellm-capabilities');
const liteLlmAuthHeader = document.getElementById('litellm-auth-header');
const liteLlmApiKey = document.getElementById('litellm-api-key');
const liteLlmSettingsError = document.getElementById('litellm-settings-error');
const newThreadButton = document.getElementById('new-thread');
const agentRuntime = document.getElementById('runtime');
let busy = false;
let liteLlmModelProfiles = {};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function renderText(value) {
  const safe = escapeHtml(value);
  const parts = safe.split(/\`\`\`/);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const body = part.replace(/^[^\n]*\n?/, '');
      return '<pre><code>' + body + '</code></pre>';
    }
    return part
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }).join('');
}

function appendMessage(message) {
  document.getElementById('welcome')?.remove();
  const element = document.createElement('article');
  element.className = 'message ' + message.role;
  element.innerHTML = '<div class="message-role">' + (message.role === 'user' ? 'YOU' : 'AGENT') + '</div>' +
    '<div class="message-body">' + renderText(message.text) + '</div>';
  timeline.appendChild(element);
  timeline.scrollTop = timeline.scrollHeight;
}

function appendActivity(kind, title, detail) {
  const element = document.createElement('div');
  element.className = 'activity';
  const details = detail ? '<details><summary>output</summary><pre>' + escapeHtml(detail) + '</pre></details>' : '';
  element.innerHTML = '<strong>' + escapeHtml(kind.toUpperCase()) + '</strong> · ' + escapeHtml(title) + details;
  timeline.appendChild(element);
  timeline.scrollTop = timeline.scrollHeight;
}

function setBusy(value) {
  busy = value;
  send.disabled = value;
  cancel.classList.toggle('hidden', !value);
  signal.classList.toggle('busy', value);
  agentRuntime.disabled = value;
  if (!value && status.textContent !== 'Ready') status.textContent = 'Ready';
}

function submit() {
  const text = prompt.value.trim();
  if (!text || busy) return;
  vscode.postMessage({ type: 'send', text, mode: document.getElementById('mode').value });
  prompt.value = '';
}

function fillLiteLlmSettings(liteLlm) {
  liteLlmModelProfiles = liteLlm.modelProfiles || {};
  liteLlmEndpoint.value = liteLlm.endpoint || '';
  liteLlmModelsEndpoint.value = liteLlm.modelsEndpoint || '';
  liteLlmModel.value = liteLlm.model || '';
  liteLlmModelAliases.innerHTML = Object.keys(liteLlmModelProfiles)
    .sort()
    .map(model => '<option value="' + escapeHtml(model) + '"></option>')
    .join('');
  fillModelProfile(
    liteLlm.model || '',
    liteLlm,
    !liteLlmModelProfiles[String(liteLlm.model || '').trim()]
  );
  liteLlmAuthHeader.value = liteLlm.authHeader || 'authorization';
  liteLlmApiKey.value = '';
  agentRuntime.value = liteLlm.runtime === 'deep' ? 'deep' : 'standard';
  document.getElementById('litellm-key-state').textContent = liteLlm.hasApiKey ? '· stored securely' : '· required';
  const details = [];
  if (liteLlm.caCertificatePath) details.push('CA: ' + liteLlm.caCertificatePath);
  details.push('Auth: ' + (liteLlm.authHeader || 'authorization'));
  details.push('POST /chat/completions');
  document.getElementById('litellm-details').textContent = details.join(' · ');
  liteLlmSettingsError.classList.add('hidden');
}

function fillModelProfile(model, fallback, recommendDefaults = false) {
  const profile = liteLlmModelProfiles[String(model).trim()] || fallback || {};
  liteLlmModelPreset.value = profile.preset || 'auto';
  liteLlmReasoningEffort.value = profile.reasoningEffort || 'omit';
  liteLlmTemperature.value = profile.temperature === undefined ? '' : String(profile.temperature);
  liteLlmTopP.value = profile.topP === undefined ? '' : String(profile.topP);
  applyModelCapabilities(recommendDefaults);
}

function detectModelPreset(model) {
  const normalized = String(model).trim().toLowerCase();
  if (/gpt-6(?:\.1)?[-_/ ]*(?:astra|sol)/.test(normalized) && /gpt-6\.1|astra/.test(normalized)) return 'gpt-6-responses-tools';
  if (/gpt-6[-_/ ]*(?:sol|luna)/.test(normalized)) return 'gpt-6-chat-tools';
  if (/gpt-5\.6/.test(normalized)) return 'gpt-5.6';
  if (/gpt-5(?:\.[2-5])?/.test(normalized)) return 'gpt-5-reasoning';
  if (/gpt-4|gpt-4o/.test(normalized)) return 'gpt-standard';
  if (normalized.includes('claude')) {
    if (/claude.*(?:5(?:[._-]|$)|4[._-](?:7|8|9))/.test(normalized)) return 'claude-modern';
    if (/claude.*4[._-]6/.test(normalized)) return 'claude-4.6';
    return 'claude-legacy';
  }
  return 'custom';
}

function applyModelCapabilities(recommendDefaults) {
  const resolved = liteLlmModelPreset.value === 'auto'
    ? detectModelPreset(liteLlmModel.value)
    : liteLlmModelPreset.value;
  const capabilities = modelCapabilityCatalog[resolved] || modelCapabilityCatalog.custom;
  const currentEffort = liteLlmReasoningEffort.value;
  [...liteLlmReasoningEffort.options].forEach(option => {
    option.disabled = option.value !== 'omit' && !capabilities.reasoningEfforts.includes(option.value);
  });
  if (recommendDefaults && capabilities.toolCalling === 'reasoning-none-only') {
    liteLlmReasoningEffort.value = 'none';
  } else if (currentEffort !== 'omit' && !capabilities.reasoningEfforts.includes(currentEffort)) {
    liteLlmReasoningEffort.value = 'omit';
  }
  const effort = liteLlmReasoningEffort.value;
  const samplingAllowed = capabilities.sampling === 'supported' || capabilities.sampling === 'custom' ||
    (capabilities.sampling === 'reasoning-none-only' && effort === 'none') ||
    (capabilities.sampling === 'reasoning-omitted-only' && effort === 'omit');
  liteLlmTemperature.disabled = !samplingAllowed;
  liteLlmTopP.disabled = !samplingAllowed;
  if (!samplingAllowed) {
    liteLlmTemperature.value = '';
    liteLlmTopP.value = '';
  }
  liteLlmCapabilities.textContent = capabilities.label + ' · ' + capabilities.guidance;
}

function openLiteLlmSettings() {
  liteLlmSettings.classList.remove('hidden');
  liteLlmModel.focus();
}

function saveLiteLlmSettings() {
  liteLlmSettingsError.classList.add('hidden');
  vscode.postMessage({
    type: 'saveLiteLlm',
    endpoint: liteLlmEndpoint.value,
    modelsEndpoint: liteLlmModelsEndpoint.value,
    model: liteLlmModel.value,
    apiKey: liteLlmApiKey.value,
    authHeader: liteLlmAuthHeader.value,
    preset: liteLlmModelPreset.value,
    reasoningEffort: liteLlmReasoningEffort.value,
    temperature: liteLlmTemperature.value,
    topP: liteLlmTopP.value
  });
}

function wireStarterButtons() {
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    prompt.value = button.dataset.prompt;
    prompt.focus();
  }));
}

function resetConversation() {
  timeline.innerHTML = welcomeMarkup;
  plan.classList.add('hidden');
  planItems.innerHTML = '';
  prompt.value = '';
  newThreadButton.disabled = false;
  setBusy(false);
  status.textContent = 'Ready';
  wireStarterButtons();
}

send.addEventListener('click', submit);
cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
newThreadButton.addEventListener('click', () => {
  if (newThreadButton.disabled) return;
  newThreadButton.disabled = true;
  status.textContent = 'Starting a new thread';
  vscode.postMessage({ type: 'newThread' });
});
document.getElementById('memory').addEventListener('click', () => vscode.postMessage({ type: 'openMemory' }));
document.getElementById('litellm').addEventListener('click', () => liteLlmSettings.classList.contains('hidden') ? openLiteLlmSettings() : liteLlmSettings.classList.add('hidden'));
document.getElementById('litellm-close').addEventListener('click', () => liteLlmSettings.classList.add('hidden'));
document.getElementById('litellm-save').addEventListener('click', saveLiteLlmSettings);
document.getElementById('litellm-advanced').addEventListener('click', () => vscode.postMessage({ type: 'configureLiteLlm' }));
document.getElementById('litellm-load-models').addEventListener('click', () => {
  liteLlmSettingsError.classList.add('hidden');
  vscode.postMessage({
    type: 'listModels',
    endpoint: liteLlmModelsEndpoint.value,
    apiKey: liteLlmApiKey.value
  });
});
liteLlmModel.addEventListener('change', () => {
  const hasSavedProfile = Boolean(liteLlmModelProfiles[String(liteLlmModel.value).trim()]);
  fillModelProfile(liteLlmModel.value, {}, !hasSavedProfile);
});
liteLlmModelPreset.addEventListener('change', () => applyModelCapabilities(true));
liteLlmReasoningEffort.addEventListener('change', () => applyModelCapabilities(false));
liteLlmTemperature.addEventListener('input', () => {
  if (liteLlmTemperature.value !== '') liteLlmTopP.value = '';
});
liteLlmTopP.addEventListener('input', () => {
  if (liteLlmTopP.value !== '') liteLlmTemperature.value = '';
});
agentRuntime.addEventListener('change', () => {
  vscode.postMessage({ type: 'selectRuntime', runtime: agentRuntime.value });
});
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
});
wireStarterButtons();

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'hydrate':
      document.getElementById('workspace').textContent = data.workspace;
      document.getElementById('active-file').textContent = data.activeFile || 'No active file';
      fillLiteLlmSettings(data.liteLlm || {});
      (data.history || []).forEach(appendMessage);
      break;
    case 'liteLlmSettings': fillLiteLlmSettings(data.liteLlm); break;
    case 'modelsLoaded':
      liteLlmModelsEndpoint.value = data.endpoint;
      liteLlmModelAliases.innerHTML = [...new Set([...(data.models || []), ...Object.keys(liteLlmModelProfiles)])]
        .sort()
        .map(model => '<option value="' + escapeHtml(model) + '"></option>')
        .join('');
      status.textContent = data.message;
      liteLlmModel.focus();
      break;
    case 'modelsLoadError':
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'liteLlmSaved':
      fillLiteLlmSettings(data.liteLlm);
      liteLlmSettings.classList.add('hidden');
      status.textContent = data.message;
      break;
    case 'runtimeChanged':
      agentRuntime.value = data.runtime;
      status.textContent = data.message;
      break;
    case 'runtimeChangeError':
      fillLiteLlmSettings(data.liteLlm || {});
      status.textContent = 'Could not change agent runtime';
      const runtimeError = document.createElement('div');
      runtimeError.className = 'error';
      runtimeError.textContent = data.message;
      timeline.appendChild(runtimeError);
      break;
    case 'liteLlmSaveError':
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'user': case 'assistant': appendMessage(data.message); break;
    case 'busy': setBusy(data.value); break;
    case 'status': status.textContent = data.label; break;
    case 'plan':
      plan.classList.remove('hidden');
      planItems.innerHTML = data.items.map(item => '<li class="' + (item.completed ? 'done' : '') + '">' + escapeHtml(item.text) + '</li>').join('');
      break;
    case 'activity': appendActivity(data.kind, data.title, data.detail); break;
    case 'usage': status.textContent = 'Ready · ' + data.input + ' in / ' + data.output + ' out'; break;
    case 'error':
      const error = document.createElement('div'); error.className = 'error'; error.textContent = data.message; timeline.appendChild(error); break;
    case 'reset': resetConversation(); break;
    case 'newThreadError':
      newThreadButton.disabled = false;
      status.textContent = 'New thread failed';
      const threadError = document.createElement('div');
      threadError.className = 'error';
      threadError.textContent = data.message;
      timeline.appendChild(threadError);
      break;
    case 'contextPinned':
      document.getElementById('active-file').textContent = 'Pinned: ' + data.filename; break;
    case 'toast': status.textContent = data.message; break;
  }
});

vscode.postMessage({ type: 'ready' });
`;
