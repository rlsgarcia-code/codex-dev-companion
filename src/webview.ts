import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import {
  AZURE_API_KEY_SECRET,
  isRecognizedAzureOpenAIHost,
  normalizeAzureEndpoint,
  resolveWorkspaceModelCatalogPath,
  validateAzureConnection
} from "./azure";
import { ContextCollector } from "./context";
import { ProjectMemory } from "./memory";
import type { AgentUiEvent, ChatMessage, RunMode } from "./types";

const HISTORY_KEY = "codexDevCompanion.history";
const MAX_HISTORY = 60;

type IncomingMessage =
  | { type: "ready" }
  | { type: "send"; text: string; mode: RunMode }
  | { type: "cancel" }
  | { type: "newThread" }
  | { type: "remember"; text: string }
  | { type: "openMemory" }
  | { type: "configureAzure" }
  | { type: "saveAzure"; endpoint: string; deployment: string; apiVersion: string; apiKey: string }
  | { type: "selectModelCatalog" }
  | { type: "clearModelCatalog" };

type AzureSettingsSnapshot = {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  hasApiKey: boolean;
  corporateGateway: boolean;
  caCertificatePath: string;
  modelCatalogPath: string;
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
      void vscode.window.showInformationMessage("Select code before adding it to Codex context.");
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
          azure: await this.azureSettingsSnapshot()
        });
        break;
      case "send":
        await this.send(message.text, message.mode);
        break;
      case "cancel":
        this.agent.cancel();
        break;
      case "newThread":
        await this.newThread();
        break;
      case "remember":
        await this.remember(message.text);
        break;
      case "openMemory":
        await this.memory.open();
        break;
      case "configureAzure":
        await vscode.commands.executeCommand("codexDevCompanion.configureAzure");
        this.post({ type: "azureSettings", azure: await this.azureSettingsSnapshot() });
        break;
      case "saveAzure":
        await this.saveAzureSettings(message);
        break;
      case "selectModelCatalog":
        await this.selectModelCatalog();
        break;
      case "clearModelCatalog":
        await this.clearModelCatalog();
        break;
    }
  }

  private async azureSettingsSnapshot(): Promise<AzureSettingsSnapshot> {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    return {
      endpoint: configuration.get<string>("azureEndpoint", ""),
      deployment: configuration.get<string>("azureDeployment", ""),
      apiVersion: configuration.get<string>("azureApiVersion", "2025-04-01-preview"),
      hasApiKey: Boolean(await this.extensionContext.secrets.get(AZURE_API_KEY_SECRET)),
      corporateGateway: configuration.get<boolean>("allowCorporateGateway", false),
      caCertificatePath: configuration.get<string>("corporateCaCertificatePath", ""),
      modelCatalogPath: configuration.get<string>("modelCatalogPath", "")
    };
  }

  private async saveAzureSettings(message: Extract<IncomingMessage, { type: "saveAzure" }>): Promise<void> {
    try {
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      const existingApiKey = await this.extensionContext.secrets.get(AZURE_API_KEY_SECRET);
      const candidateEndpoint = normalizeAzureEndpoint(message.endpoint, true);
      const usesCorporateGateway = !isRecognizedAzureOpenAIHost(candidateEndpoint);
      const currentEndpoint = configuration.get<string>("azureEndpoint", "");
      let sameApprovedGateway = false;
      if (usesCorporateGateway && configuration.get<boolean>("allowCorporateGateway", false)) {
        try {
          sameApprovedGateway = normalizeAzureEndpoint(currentEndpoint, true) === candidateEndpoint;
        } catch {
          sameApprovedGateway = false;
        }
      }
      if (usesCorporateGateway && !sameApprovedGateway) {
        const approval = await vscode.window.showWarningMessage(
          "This is not a direct Azure OpenAI hostname. Approve it only if this HTTPS endpoint is your corporate gateway. The API key will be sent in the api-key header.",
          { modal: true },
          "Use corporate gateway"
        );
        if (approval !== "Use corporate gateway") {
          throw new Error("Corporate gateway was not authorized. No changes were saved.");
        }
      }

      const apiKey = message.apiKey.trim() || existingApiKey || "";
      const connection = validateAzureConnection({
        endpoint: candidateEndpoint,
        deployment: message.deployment,
        apiVersion: message.apiVersion,
        apiKey,
        allowCorporateGateway: usesCorporateGateway
      });
      await Promise.all([
        configuration.update("azureEndpoint", connection.endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("azureDeployment", connection.deployment, vscode.ConfigurationTarget.Global),
        configuration.update("azureApiVersion", connection.apiVersion, vscode.ConfigurationTarget.Global),
        configuration.update("allowCorporateGateway", usesCorporateGateway, vscode.ConfigurationTarget.Global),
        ...(message.apiKey.trim()
          ? [this.extensionContext.secrets.store(AZURE_API_KEY_SECRET, message.apiKey.trim())]
          : [])
      ]);
      await this.agent.reloadAzureConfiguration();
      this.post({
        type: "azureSaved",
        azure: await this.azureSettingsSnapshot(),
        message: `Azure updated · ${connection.deployment}`
      });
    } catch (error) {
      this.post({
        type: "azureSaveError",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async selectModelCatalog(): Promise<void> {
    try {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        throw new Error("Open the workspace that contains the model catalog JSON.");
      }
      const selected = await vscode.window.showOpenDialog({
        title: "Select a Codex model catalog inside this workspace",
        defaultUri: workspace.uri,
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "JSON model catalog": ["json"] },
        openLabel: "Use this catalog"
      });
      if (!selected?.[0]) return;

      const candidate = resolveWorkspaceModelCatalogPath(workspace.uri.fsPath, selected[0].fsPath);
      const [realWorkspace, realCatalog] = await Promise.all([
        realpath(workspace.uri.fsPath),
        realpath(candidate)
      ]);
      const relative = path.relative(realWorkspace, realCatalog);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Model catalog must resolve to a JSON file inside the opened workspace.");
      }
      const contents = await vscode.workspace.fs.readFile(vscode.Uri.file(realCatalog));
      if (contents.byteLength > 5_000_000) {
        throw new Error("Model catalog is unexpectedly large (maximum 5 MB).");
      }
      JSON.parse(Buffer.from(contents).toString("utf8"));
      const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
      await configuration.update("modelCatalogPath", relative, vscode.ConfigurationTarget.Workspace);
      await this.agent.reloadAzureConfiguration();
      this.post({ type: "azureSettings", azure: await this.azureSettingsSnapshot() });
      this.post({ type: "toast", message: `Model catalog selected · ${relative}` });
    } catch (error) {
      this.post({ type: "azureSaveError", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async clearModelCatalog(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
    await configuration.update("modelCatalogPath", undefined, vscode.ConfigurationTarget.Workspace);
    await this.agent.reloadAzureConfiguration();
    this.post({ type: "azureSettings", azure: await this.azureSettingsSnapshot() });
    this.post({ type: "toast", message: "Model catalog removed" });
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
        <div class="eyebrow">CODEX / DEVELOPMENT</div>
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

    <section class="settings-panel hidden" id="azure-settings" aria-label="Azure OpenAI settings">
      <div class="settings-heading">
        <div>
          <div class="section-label">AZURE OPENAI</div>
          <h2>Connection</h2>
        </div>
        <button class="icon-button settings-close" id="azure-close" title="Close settings" aria-label="Close settings">×</button>
      </div>
      <label class="field">
        <span>OpenAI API Base</span>
        <input id="azure-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway.example/openai" />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>Deployment ID</span>
          <input id="azure-deployment" type="text" autocomplete="off" spellcheck="false" placeholder="my-deployment" />
        </label>
        <label class="field">
          <span>API Version</span>
          <input id="azure-api-version" type="text" autocomplete="off" spellcheck="false" placeholder="2025-04-01-preview" />
        </label>
      </div>
      <label class="field">
        <span>API Key <small id="azure-key-state"></small></span>
        <input id="azure-api-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the stored key" />
      </label>
      <div class="local-setting">
        <div>
          <span>Model metadata <small>optional</small></span>
          <code id="model-catalog-path">No local catalog</code>
        </div>
        <div class="inline-actions">
          <button id="select-model-catalog">Select JSON</button>
          <button class="hidden" id="clear-model-catalog">Clear</button>
        </div>
      </div>
      <p class="settings-note" id="azure-details"></p>
      <p class="settings-error hidden" id="azure-settings-error"></p>
      <div class="settings-actions">
        <button class="secondary-action" id="azure-advanced">Setup wizard / PEM</button>
        <button class="primary-action" id="azure-save">Save connection</button>
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
        <span class="utility-links"><button class="memory-link" id="azure">Azure</button><button class="memory-link" id="memory">Memory</button></span>
      </div>
      <div class="composer">
        <textarea id="prompt" rows="3" placeholder="Ask about the code, request a change, or explore an idea…"></textarea>
        <div class="composer-actions">
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
.field input { width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid var(--line); border-radius: 4px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: 11px/1.3 var(--vscode-editor-font-family); }
.field input:focus { border-color: color-mix(in srgb, var(--accent) 62%, transparent); }
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
const timeline = document.getElementById('timeline');
const welcome = document.getElementById('welcome');
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const cancel = document.getElementById('cancel');
const status = document.getElementById('status');
const signal = document.getElementById('signal');
const plan = document.getElementById('plan');
const planItems = document.getElementById('plan-items');
const azureSettings = document.getElementById('azure-settings');
const azureEndpoint = document.getElementById('azure-endpoint');
const azureDeployment = document.getElementById('azure-deployment');
const azureApiVersion = document.getElementById('azure-api-version');
const azureApiKey = document.getElementById('azure-api-key');
const azureSettingsError = document.getElementById('azure-settings-error');
let busy = false;

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
  welcome?.remove();
  const element = document.createElement('article');
  element.className = 'message ' + message.role;
  element.innerHTML = '<div class="message-role">' + (message.role === 'user' ? 'YOU' : 'CODEX') + '</div>' +
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
  if (!value && status.textContent !== 'Ready') status.textContent = 'Ready';
}

function submit() {
  const text = prompt.value.trim();
  if (!text || busy) return;
  vscode.postMessage({ type: 'send', text, mode: document.getElementById('mode').value });
  prompt.value = '';
}

function fillAzureSettings(azure) {
  azureEndpoint.value = azure.endpoint || '';
  azureDeployment.value = azure.deployment || '';
  azureApiVersion.value = azure.apiVersion || '2025-04-01-preview';
  azureApiKey.value = '';
  document.getElementById('azure-key-state').textContent = azure.hasApiKey ? '· stored securely' : '· required';
  document.getElementById('model-catalog-path').textContent = azure.modelCatalogPath || 'No local catalog';
  document.getElementById('clear-model-catalog').classList.toggle('hidden', !azure.modelCatalogPath);
  const details = [];
  if (azure.corporateGateway) details.push('Corporate gateway');
  if (azure.caCertificatePath) details.push('CA: ' + azure.caCertificatePath);
  details.push(azure.modelCatalogPath ? 'custom model metadata enabled' : 'fallback metadata may be used for custom aliases');
  document.getElementById('azure-details').textContent = details.join(' · ');
  azureSettingsError.classList.add('hidden');
}

function openAzureSettings() {
  azureSettings.classList.remove('hidden');
  azureDeployment.focus();
}

function saveAzureSettings() {
  azureSettingsError.classList.add('hidden');
  vscode.postMessage({
    type: 'saveAzure',
    endpoint: azureEndpoint.value,
    deployment: azureDeployment.value,
    apiVersion: azureApiVersion.value,
    apiKey: azureApiKey.value
  });
}

send.addEventListener('click', submit);
cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
document.getElementById('new-thread').addEventListener('click', () => vscode.postMessage({ type: 'newThread' }));
document.getElementById('memory').addEventListener('click', () => vscode.postMessage({ type: 'openMemory' }));
document.getElementById('azure').addEventListener('click', () => azureSettings.classList.contains('hidden') ? openAzureSettings() : azureSettings.classList.add('hidden'));
document.getElementById('azure-close').addEventListener('click', () => azureSettings.classList.add('hidden'));
document.getElementById('azure-save').addEventListener('click', saveAzureSettings);
document.getElementById('azure-advanced').addEventListener('click', () => vscode.postMessage({ type: 'configureAzure' }));
document.getElementById('select-model-catalog').addEventListener('click', () => vscode.postMessage({ type: 'selectModelCatalog' }));
document.getElementById('clear-model-catalog').addEventListener('click', () => vscode.postMessage({ type: 'clearModelCatalog' }));
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  prompt.value = button.dataset.prompt; prompt.focus();
}));

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'hydrate':
      document.getElementById('workspace').textContent = data.workspace;
      document.getElementById('active-file').textContent = data.activeFile || 'No active file';
      fillAzureSettings(data.azure || {});
      (data.history || []).forEach(appendMessage);
      break;
    case 'azureSettings': fillAzureSettings(data.azure); break;
    case 'azureSaved':
      fillAzureSettings(data.azure);
      azureSettings.classList.add('hidden');
      status.textContent = data.message;
      break;
    case 'azureSaveError':
      azureSettingsError.textContent = data.message;
      azureSettingsError.classList.remove('hidden');
      openAzureSettings();
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
    case 'reset': location.reload(); break;
    case 'contextPinned':
      document.getElementById('active-file').textContent = 'Pinned: ' + data.filename; break;
    case 'toast': status.textContent = data.message; break;
  }
});

vscode.postMessage({ type: 'ready' });
`;
