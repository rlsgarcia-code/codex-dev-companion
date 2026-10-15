import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "langchain";
import * as vscode from "vscode";
import { z } from "zod";
import { requiresLocalApproval, type LocalMutationKind } from "./autonomy";
import {
  LocalBrowserSession,
  type BrowserInteraction
} from "./browser";
import { normalizeLocalBrowserUrl } from "./browser-policy";
import type { ChangeTracker } from "./change-tracker";
import { evaluateCommandPolicy } from "./command-policy";
import { isWorkspaceGlob, validateWorkspaceGlob } from "./glob-policy";
import { requestLocalApproval } from "./local-approval";
import { ProjectMemory } from "./memory";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import { isSensitiveWorkspacePath } from "./sensitive-files";
import type { AgentUiEvent, RunMode } from "./types";

const FILE_EXCLUSIONS = "**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**";
const MAX_TOOL_OUTPUT = 30_000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_COMMAND_OUTPUT = 30_000;

export type BrowserVisualAnalyzer = (input: {
  bytes: Buffer;
  mimeType: "image/jpeg";
  question: string;
  signal: AbortSignal;
}) => Promise<string>;

export class LocalToolHost {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly memory: ProjectMemory,
    private readonly onEvent: (event: AgentUiEvent) => void,
    private readonly changeTracker: ChangeTracker,
    private readonly sensitiveValues: readonly string[] = [],
    private readonly browser?: LocalBrowserSession,
    private readonly analyzeBrowserScreenshot?: BrowserVisualAnalyzer
  ) {}

  public tools(mode: RunMode, signal: AbortSignal) {
    const readTools = [
      tool(
        (input) => this.safe(() => this.listFiles(input)),
        {
          name: "list_files",
          description: "List workspace files matching a glob. Use this before guessing paths.",
          schema: z.object({
            glob: z.string().max(512).refine(isWorkspaceGlob, "Use a simple bounded glob without brace expansion.").optional()
              .describe("Workspace glob such as src/**/*.ts. Defaults to **/*. Brace expansion is unsupported."),
            limit: z.number().int().min(1).max(500).optional()
          })
        }
      ),
      tool(
        (input) => this.safe(() => this.readFile(input)),
        {
          name: "read_file",
          description: "Read a UTF-8 text file inside the opened workspace with optional line bounds.",
          schema: z.object({
            path: z.string().describe("Workspace-relative file path."),
            start_line: z.number().int().min(1).optional(),
            end_line: z.number().int().min(1).optional()
          })
        }
      ),
      tool(
        (input) => this.safe(() => this.searchText(input, signal)),
        {
          name: "search_text",
          description: "Search workspace text with ripgrep and return file, line, column, and matching text.",
          schema: z.object({
            query: z.string(),
            glob: z.string().max(512).refine(isWorkspaceGlob, "Use a simple bounded glob without brace expansion.").optional()
              .describe("Optional include glob such as *.ts or src/**. Brace expansion is unsupported.")
          })
        }
      ),
      tool(
        (input) => this.safe(() => this.updatePlan(input)),
        {
          name: "update_plan",
          description: "Publish or update a concise implementation plan in the UI.",
          schema: z.object({
            items: z.array(z.object({ text: z.string(), completed: z.boolean() })).min(1).max(8)
          })
        }
      ),
      ...this.browserTools(signal, mode !== "plan")
    ];

    if (mode === "plan") return readTools;
    return [
      ...readTools,
      tool(
        (input) => this.safe(() => this.editFile(input, mode)),
        {
          name: "edit_file",
          description: mode === "review"
            ? "Replace one exact, unique text block in an existing workspace file after explicit user approval."
            : "Replace one exact, unique text block in an existing workspace file.",
          schema: z.object({ path: z.string(), old_text: z.string(), new_text: z.string() })
        }
      ),
      tool(
        (input) => this.safe(() => this.createFile(input, mode)),
        {
          name: "create_file",
          description: mode === "review"
            ? "Create a new UTF-8 text file inside the workspace after explicit user approval. Fails if it already exists."
            : "Create a new UTF-8 text file inside the workspace. Fails if it already exists.",
          schema: z.object({ path: z.string(), content: z.string() })
        }
      ),
      tool(
        (input) => this.safe(() => this.runCommand(input, signal, mode)),
        {
          name: "run_command",
          description: "Run one executable directly, without a shell, in the workspace after user approval.",
          schema: z.object({
            command: z.string().describe("Executable name only, for example npm, git, rg, pytest, or cargo."),
            args: z.array(z.string()).max(40),
            cwd: z.string().optional().describe("Optional workspace-relative working directory."),
            timeout_ms: z.number().int().min(1_000).max(120_000).optional()
          })
        }
      ),
      tool(
        (input) => this.safe(() => this.remember(input, mode)),
        {
          name: "remember_project_fact",
          description: "Append a durable, confirmed project decision or convention to project memory. Never store secrets or chat logs.",
          schema: z.object({ note: z.string().min(1).max(4_000) })
        }
      )
    ];
  }

  public deepTools(mode: RunMode, signal: AbortSignal) {
    const planningTool = tool(
      (input) => this.safe(() => this.updatePlan(input)),
      {
        name: "update_plan",
        description: "Publish or update a concise implementation plan in the UI.",
        schema: z.object({
          items: z.array(z.object({ text: z.string(), completed: z.boolean() })).min(1).max(8)
        })
      }
    );
    const browserTools = this.browserTools(signal, mode !== "plan");
    if (mode === "plan") return [planningTool, ...browserTools];
    return [
      planningTool,
      ...browserTools,
      tool(
        (input) => this.safe(() => this.runCommand(input, signal, mode)),
        {
          name: "run_command",
          description: "Run one executable directly, without a shell, in the workspace after user approval.",
          schema: z.object({
            command: z.string().describe("Executable name only, for example npm, git, rg, pytest, or cargo."),
            args: z.array(z.string()).max(40),
            cwd: z.string().optional().describe("Optional workspace-relative working directory."),
            timeout_ms: z.number().int().min(1_000).max(120_000).optional()
          })
        }
      ),
      tool(
        (input) => this.safe(() => this.remember(input, mode)),
        {
          name: "remember_project_fact",
          description: "Append a durable, confirmed project decision or convention to project memory. Never store secrets or chat logs.",
          schema: z.object({ note: z.string().min(1).max(4_000) })
        }
      )
    ];
  }

  private async safe(action: () => string | Promise<string>): Promise<string> {
    try {
      return await action();
    } catch (error) {
      return JSON.stringify({ error: safeErrorMessage(error, this.sensitiveValues) });
    }
  }

  private browserTools(signal: AbortSignal, interactive: boolean) {
    if (!this.browser) return [];
    const tools: StructuredToolInterface[] = [
      tool(
        (input) => this.safe(() => this.openBrowser(input, signal)),
        {
          name: "browser_open",
          description: "Open and inspect a running http(s) localhost application in an isolated local browser. Non-loopback requests are blocked. This also asks VS Code to show the same URL for the user.",
          schema: z.object({
            url: z.string().max(2_048).describe("Local app URL such as http://localhost:3000.")
          })
        }
      ),
      tool(
        () => this.safe(() => this.browserInspect(signal)),
        {
          name: "browser_inspect",
          description: "Inspect the current local page: visible text, interactive element references, console warnings/errors, page errors, and blocked remote requests.",
          schema: z.object({})
        }
      ),
      tool(
        (input) => this.safe(() => this.browserVisualCheck(input, signal)),
        {
          name: "browser_visual_check",
          description: "Capture the current local app viewport and ask the configured multimodal LiteLLM model to identify visual defects. Use after important UI changes; if the model lacks image support, continue with browser_inspect.",
          schema: z.object({
            question: z.string().min(1).max(1_000).optional()
              .describe("Specific visual acceptance criteria or suspected layout issue.")
          })
        }
      ),
      tool(
        () => this.safe(() => this.closeBrowser()),
        {
          name: "browser_close",
          description: "Close the isolated local browser session and delete its temporary screenshot.",
          schema: z.object({})
        }
      )
    ];
    if (interactive) {
      tools.splice(2, 0, tool(
        (input) => this.safe(() => this.interactWithBrowser(input, signal)),
        {
          name: "browser_interact",
          description: "Interact with the current local app using element references from the latest browser inspection, then return an updated inspection. Password fields are never filled.",
          schema: z.object({
            action: z.enum(["click", "fill", "press", "select", "reload", "go_back", "resize"]),
            ref: z.string().regex(/^e\d+$/).optional().describe("Element reference from browser_open or browser_inspect."),
            text: z.string().max(4_000).optional().describe("Text for fill."),
            key: z.string().max(80).optional().describe("Playwright key such as Enter, Escape, or Control+Enter."),
            value: z.string().max(1_000).optional().describe("Option value for select."),
            width: z.number().int().min(320).max(1_920).optional(),
            height: z.number().int().min(320).max(1_200).optional()
          })
        }
      ));
    }
    return tools;
  }

  private async openBrowser(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const browser = this.requireBrowser();
    const url = normalizeLocalBrowserUrl(requiredString(input.url, "url"));
    if (!browser.hasApprovalFor(url)) {
      const origin = new URL(url).origin;
      const approved = await requestLocalApproval(this.onEvent, {
        prompt: "Allow the local agent to inspect and control this localhost application?",
        action: "Allow local browser session",
        target: origin,
        explanation: "The isolated session can reach loopback addresses only. Page text, console output, interactions, and screenshots may be sent to the configured LiteLLM model for this session. Downloads, password fields, service workers, and non-local HTTP/WebSocket requests are blocked.",
        risk: "sensitive",
        sensitiveValues: this.sensitiveValues
      });
      if (!approved) {
        return JSON.stringify({ denied: true, origin, message: "The user declined local browser access." });
      }
      browser.grantApproval(url);
    }
    return this.browserResult(await browser.open(url, signal));
  }

  private async browserInspect(signal: AbortSignal): Promise<string> {
    return this.browserResult(await this.requireBrowser().snapshot(signal));
  }

  private async interactWithBrowser(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const action = requiredString(input.action, "action") as BrowserInteraction["action"];
    let interaction: BrowserInteraction;
    switch (action) {
      case "click":
        interaction = { action, ref: requiredString(input.ref, "ref") };
        break;
      case "fill":
        interaction = {
          action,
          ref: requiredString(input.ref, "ref"),
          text: requiredString(input.text, "text", true)
        };
        break;
      case "press":
        interaction = {
          action,
          ...(optionalString(input.ref) ? { ref: optionalString(input.ref) } : {}),
          key: requiredString(input.key, "key")
        };
        break;
      case "select":
        interaction = {
          action,
          ref: requiredString(input.ref, "ref"),
          value: requiredString(input.value, "value", true)
        };
        break;
      case "resize":
        interaction = {
          action,
          width: clampRequiredInteger(input.width, 320, 1_920, "width"),
          height: clampRequiredInteger(input.height, 320, 1_200, "height")
        };
        break;
      case "reload":
      case "go_back":
        interaction = { action };
        break;
      default:
        throw new Error("Unsupported browser interaction.");
    }
    return this.browserResult(await this.requireBrowser().interact(interaction, signal));
  }

  private async browserVisualCheck(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const browser = this.requireBrowser();
    const capture = await browser.screenshot(signal);
    const question = optionalString(input.question)
      ?? "Review this local application viewport for layout breakage, clipping, overlap, unreadable text, inconsistent spacing, missing content, and obvious responsive or accessibility problems. Report only evidence visible in the image and distinguish defects from uncertainty.";
    if (!this.analyzeBrowserScreenshot) {
      return JSON.stringify({
        captured: true,
        analyzed: false,
        message: "The viewport was captured locally, but visual model analysis is unavailable. Use browser_inspect for structural evidence."
      });
    }
    try {
      const analysis = await this.analyzeBrowserScreenshot({ ...capture, question, signal });
      return truncate(JSON.stringify({ captured: true, analyzed: true, analysis }), MAX_TOOL_OUTPUT);
    } catch (error) {
      return truncate(JSON.stringify({
        captured: true,
        analyzed: false,
        message: "The screenshot remains local, but the selected model did not complete visual analysis.",
        error: safeErrorMessage(error, this.sensitiveValues)
      }), MAX_TOOL_OUTPUT);
    }
  }

  private async closeBrowser(): Promise<string> {
    await this.requireBrowser().close();
    return JSON.stringify({ closed: true, temporaryCaptureDeleted: true });
  }

  private browserResult(snapshot: Awaited<ReturnType<LocalBrowserSession["snapshot"]>>): string {
    return truncate(redactSensitiveText(JSON.stringify(snapshot), this.sensitiveValues), MAX_TOOL_OUTPUT);
  }

  private requireBrowser(): LocalBrowserSession {
    if (!this.browser) throw new Error("Local browser tools are disabled in workspace settings.");
    return this.browser;
  }

  private async listFiles(input: Record<string, unknown>): Promise<string> {
    const glob = validateWorkspaceGlob(optionalString(input.glob) || "**/*");
    const limit = clampInteger(input.limit, 1, 500, 200);
    const root = vscode.Uri.file(this.workspaceRoot);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, glob),
      FILE_EXCLUSIONS,
      limit
    );
    const relativeFiles = files
      .map((uri) => path.relative(this.workspaceRoot, uri.fsPath))
      .filter((file) => !isSensitiveWorkspacePath(file));
    this.onEvent({ type: "activity", kind: "files", title: `Listed ${relativeFiles.length} files · ${glob}` });
    return truncate(JSON.stringify({ files: relativeFiles, truncated: relativeFiles.length === limit }), MAX_TOOL_OUTPUT);
  }

  private async readFile(input: Record<string, unknown>): Promise<string> {
    const requestedPath = requiredString(input.path, "path");
    const file = await this.resolveExistingPath(requestedPath, vscode.FileType.File);
    const relative = path.relative(this.workspaceRoot, file);
    if (isSensitiveWorkspacePath(relative) && !await this.approveSensitiveRead(relative)) {
      return JSON.stringify({
        denied: true,
        path: relative,
        message: "The user declined sharing this potentially sensitive file."
      });
    }
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(file));
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`File is too large to read safely (${stat.size} bytes).`);
    }
    const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
    const lines = contents.split(/\r?\n/);
    const start = clampInteger(input.start_line, 1, Math.max(1, lines.length), 1);
    const end = clampInteger(input.end_line, start, Math.max(start, lines.length), Math.min(lines.length, start + 399));
    const numbered = lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n");
    this.onEvent({ type: "activity", kind: "read", title: `${relative}:${start}-${end}` });
    return truncate(JSON.stringify({
      path: relative,
      startLine: start,
      endLine: end,
      content: redactSensitiveText(numbered, this.sensitiveValues)
    }), MAX_TOOL_OUTPUT);
  }

  private async searchText(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const query = requiredString(input.query, "query");
    if (query.length > 500) throw new Error("Search query is too long.");
    const glob = optionalString(input.glob);
    if (glob) validateWorkspaceGlob(glob);
    const args = ["--line-number", "--column", "--no-heading", "--color", "never", "--max-count", "200"];
    if (glob) args.push("--glob", glob);
    args.push("--", query, ".");
    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await spawnAndCollect("rg", args, this.workspaceRoot, signal, 30_000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result = await this.fallbackSearch(query, glob, signal);
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr || `ripgrep exited with code ${result.exitCode}.`);
    }
    const matches = filterSensitiveSearchMatches(result.stdout);
    this.onEvent({ type: "activity", kind: "search", title: glob ? `${query} · ${glob}` : query });
    return truncate(JSON.stringify({
      matches: redactSensitiveText(matches, this.sensitiveValues),
      found: Boolean(matches.trim())
    }), MAX_TOOL_OUTPUT);
  }

  private async fallbackSearch(
    query: string,
    glob: string | undefined,
    signal: AbortSignal
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const root = vscode.Uri.file(this.workspaceRoot);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, glob || "**/*"),
      FILE_EXCLUSIONS,
      300
    );
    const matches: string[] = [];
    for (const uri of files) {
      if (signal.aborted) throw new Error("Search was cancelled.");
      const relative = path.relative(this.workspaceRoot, uri.fsPath);
      if (isSensitiveWorkspacePath(relative)) continue;
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) === 0 || stat.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        continue;
      }
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        const column = line.indexOf(query);
        if (column >= 0) {
          matches.push(`${relative}:${index + 1}:${column + 1}:${line}`);
          if (matches.length >= 200) break;
        }
      }
      if (matches.length >= 200) break;
    }
    return { exitCode: matches.length ? 0 : 1, stdout: matches.join("\n"), stderr: "" };
  }

  private updatePlan(input: Record<string, unknown>): string {
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 8) {
      throw new Error("Plan must contain between 1 and 8 items.");
    }
    const items = input.items.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Each plan item must be an object.");
      const record = item as Record<string, unknown>;
      return {
        text: requiredString(record.text, "plan item text").slice(0, 240),
        completed: Boolean(record.completed)
      };
    });
    this.onEvent({ type: "plan", items });
    return JSON.stringify({ updated: true });
  }

  private async editFile(input: Record<string, unknown>, mode: RunMode): Promise<string> {
    const requestedPath = requiredString(input.path, "path");
    const oldText = requiredString(input.old_text, "old_text", true);
    const newText = requiredString(input.new_text, "new_text", true);
    const file = await this.resolveExistingPath(requestedPath, vscode.FileType.File);
    const uri = vscode.Uri.file(file);
    const current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const first = current.indexOf(oldText);
    if (first < 0) throw new Error("old_text was not found in the target file.");
    if (current.indexOf(oldText, first + oldText.length) >= 0) {
      throw new Error("old_text is not unique; include more surrounding text.");
    }
    const updated = `${current.slice(0, first)}${newText}${current.slice(first + oldText.length)}`;
    const relative = path.relative(this.workspaceRoot, file);
    if (!await this.approveWorkspaceMutation(mode, "file-write", relative, "Replace one exact text block")) {
      return JSON.stringify({ denied: true, path: relative, message: "The user declined this file edit." });
    }
    await this.changeTracker.captureBefore(relativePath(this.workspaceRoot, file));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    await this.changeTracker.captureAfter(relative);
    this.onEvent({ type: "activity", kind: "files", title: `modified: ${relative}` });
    return JSON.stringify({ path: relative, changed: true });
  }

  private async createFile(input: Record<string, unknown>, mode: RunMode): Promise<string> {
    const requestedPath = requiredString(input.path, "path");
    const content = requiredString(input.content, "content", true);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("New file content is too large.");
    const file = await this.resolveNewPath(requestedPath);
    const uri = vscode.Uri.file(file);
    try {
      await vscode.workspace.fs.stat(uri);
      throw new Error("Target file already exists; use edit_file instead.");
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
    }
    const relative = path.relative(this.workspaceRoot, file);
    if (!await this.approveWorkspaceMutation(mode, "file-write", relative, `Create ${Buffer.byteLength(content)} bytes`)) {
      return JSON.stringify({ denied: true, path: relative, message: "The user declined file creation." });
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
    await this.changeTracker.captureBefore(relative);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    await this.changeTracker.captureAfter(relative);
    this.onEvent({ type: "activity", kind: "files", title: `created: ${relative}` });
    return JSON.stringify({ path: relative, created: true });
  }

  private async runCommand(input: Record<string, unknown>, signal: AbortSignal, mode: RunMode): Promise<string> {
    const command = requiredString(input.command, "command");
    if (!/^[a-zA-Z0-9._+-]+$/.test(command)) {
      throw new Error("Command must be an executable name without paths, shell syntax, or substitutions.");
    }
    const args = Array.isArray(input.args) ? input.args.map((value) => String(value)) : [];
    if (args.length > 40 || args.some((argument) => argument.length > 2_000 || argument.includes("\0"))) {
      throw new Error("Command arguments exceed the local safety limits.");
    }
    const policy = evaluateCommandPolicy(command, args);
    const cwdInput = optionalString(input.cwd) || ".";
    const cwd = await this.resolveExistingPath(cwdInput, vscode.FileType.Directory);
    const timeout = clampInteger(input.timeout_ms, 1_000, 120_000, 60_000);
    const printable = redactSensitiveText(
      [command, ...args].map(shellDisplay).join(" "),
      this.sensitiveValues
    );
    if (requiresLocalApproval(mode, "command", policy.level)) {
      const approvalLabel = policy.level === "destructive" ? "Run destructive command" : "Run command";
      const approved = await requestLocalApproval(this.onEvent, {
        prompt: policy.level === "destructive"
          ? "Allow this potentially destructive local command?"
          : "Allow the local agent to run this command?",
        action: approvalLabel,
        target: `Working directory: ${path.relative(this.workspaceRoot, cwd) || "."}`,
        explanation: `${printable}${policy.warning ? `\n\n${policy.warning}` : ""}`,
        risk: policy.level,
        sensitiveValues: this.sensitiveValues
      });
      if (!approved) {
        return JSON.stringify({ denied: true, risk: policy.level, message: "The user declined command execution." });
      }
    }
    this.onEvent({ type: "activity", kind: "command", title: printable });
    const rawResult = await spawnAndCollect(commandForPlatform(command), args, cwd, signal, timeout);
    const result = {
      ...rawResult,
      stdout: redactSensitiveText(rawResult.stdout, this.sensitiveValues),
      stderr: redactSensitiveText(rawResult.stderr, this.sensitiveValues)
    };
    const detail = truncate([result.stdout, result.stderr].filter(Boolean).join("\n"), 1_800);
    this.onEvent({ type: "activity", kind: "command", title: `${printable} · exit ${result.exitCode}`, detail });
    return truncate(JSON.stringify(result), MAX_TOOL_OUTPUT);
  }

  private async remember(input: Record<string, unknown>, mode: RunMode): Promise<string> {
    const note = requiredString(input.note, "note");
    if (
      /api[-_ ]?key|token|secret|password|bearer\s/i.test(note)
      || redactSensitiveText(note, this.sensitiveValues) !== note
    ) {
      throw new Error("Memory note looks like it may contain a secret and was not saved.");
    }
    const memoryPath = ".codex-agent/memory.md";
    if (!await this.approveWorkspaceMutation(mode, "memory", memoryPath, "Append one durable project-memory entry")) {
      return JSON.stringify({ denied: true, path: memoryPath, message: "The user declined the memory update." });
    }
    await this.changeTracker.captureBefore(memoryPath);
    const uri = await this.memory.append(note);
    await this.changeTracker.captureAfter(memoryPath);
    this.onEvent({ type: "activity", kind: "memory", title: `Updated ${vscode.workspace.asRelativePath(uri)}` });
    return JSON.stringify({ saved: true });
  }

  private async approveWorkspaceMutation(
    mode: RunMode,
    kind: LocalMutationKind,
    relativePath: string,
    detail: string
  ): Promise<boolean> {
    if (!requiresLocalApproval(mode, kind)) return true;
    if (mode === "plan") return false;
    const labels = kind === "memory"
      ? { title: "Allow this project-memory update?", action: "Update memory" }
      : { title: "Allow this workspace file change?", action: "Apply change" };
    return requestLocalApproval(this.onEvent, {
      prompt: labels.title,
      action: labels.action,
      target: relativePath,
      explanation: detail,
      risk: "standard",
      sensitiveValues: this.sensitiveValues
    });
  }

  private async approveSensitiveRead(relativePath: string): Promise<boolean> {
    return requestLocalApproval(this.onEvent, {
      prompt: "Share a potentially sensitive file with the configured model?",
      action: "Share redacted file once",
      target: relativePath,
      explanation: "Recognized credentials will be removed locally, but automatic detection cannot guarantee that every secret is found.",
      risk: "sensitive",
      sensitiveValues: this.sensitiveValues
    });
  }

  private async resolveExistingPath(relativePath: string, expectedType: vscode.FileType): Promise<string> {
    const candidate = lexicalWorkspacePath(this.workspaceRoot, relativePath);
    const [realRoot, realCandidate] = await Promise.all([realpath(this.workspaceRoot), realpath(candidate)]);
    assertInside(realRoot, realCandidate);
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(realCandidate));
    if ((stat.type & expectedType) === 0) {
      throw new Error(expectedType === vscode.FileType.File ? "Path is not a file." : "Path is not a directory.");
    }
    return realCandidate;
  }

  private async resolveNewPath(relativePath: string): Promise<string> {
    const candidate = lexicalWorkspacePath(this.workspaceRoot, relativePath);
    const realRoot = await realpath(this.workspaceRoot);
    let ancestor = path.dirname(candidate);
    while (ancestor !== path.dirname(ancestor)) {
      try {
        const realAncestor = await realpath(ancestor);
        assertInside(realRoot, realAncestor);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    throw new Error("Could not resolve a safe parent directory inside the workspace.");
  }
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute);
}

function lexicalWorkspacePath(root: string, requestedPath: string): string {
  if (!requestedPath.trim() || path.isAbsolute(requestedPath) || requestedPath.includes("\0")) {
    throw new Error("Tool paths must be non-empty and relative to the opened workspace.");
  }
  const candidate = path.resolve(root, requestedPath);
  assertInside(path.resolve(root), candidate);
  return candidate;
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Tool access is restricted to the opened workspace.");
  }
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${name} must be a ${allowEmpty ? "string" : "non-empty string"}.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function clampRequiredInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n…[truncated]`;
}

function filterSensitiveSearchMatches(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => {
      const match = /^(.+):\d+:\d+:/.exec(line);
      return !match?.[1] || !isSensitiveWorkspacePath(match[1]);
    })
    .join("\n");
}

function shellDisplay(value: string): string {
  return /^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function commandForPlatform(command: string): string {
  if (process.platform === "win32" && ["npm", "npx", "pnpm", "yarn"].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}

async function spawnAndCollect(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      signal,
      env: safeCommandEnvironment()
    });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer | string) => truncate(`${current}${String(chunk)}`, MAX_COMMAND_OUTPUT);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, terminatedBySignal) => {
      clearTimeout(timer);
      if (terminatedBySignal && signal.aborted) {
        reject(new Error("Command execution was cancelled."));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function safeCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
    "TERM", "COLORTERM", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT"
  ];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
}
