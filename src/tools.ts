import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { tool } from "langchain";
import * as vscode from "vscode";
import { z } from "zod";
import { ProjectMemory } from "./memory";
import type { AgentUiEvent, RunMode } from "./types";

const FILE_EXCLUSIONS = "**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**";
const MAX_TOOL_OUTPUT = 30_000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_COMMAND_OUTPUT = 30_000;

export class LocalToolHost {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly memory: ProjectMemory,
    private readonly onEvent: (event: AgentUiEvent) => void
  ) {}

  public tools(mode: RunMode, signal: AbortSignal) {
    const readTools = [
      tool(
        (input) => this.safe(() => this.listFiles(input)),
        {
          name: "list_files",
          description: "List workspace files matching a glob. Use this before guessing paths.",
          schema: z.object({
            glob: z.string().optional().describe("Workspace glob such as src/**/*.ts. Defaults to **/*."),
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
            glob: z.string().optional().describe("Optional include glob such as *.ts or src/**.")
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
      )
    ];

    if (mode === "plan") return readTools;
    return [
      ...readTools,
      tool(
        (input) => this.safe(() => this.editFile(input)),
        {
          name: "edit_file",
          description: "Replace one exact, unique text block in an existing workspace file.",
          schema: z.object({ path: z.string(), old_text: z.string(), new_text: z.string() })
        }
      ),
      tool(
        (input) => this.safe(() => this.createFile(input)),
        {
          name: "create_file",
          description: "Create a new UTF-8 text file inside the workspace. Fails if it already exists.",
          schema: z.object({ path: z.string(), content: z.string() })
        }
      ),
      tool(
        (input) => this.safe(() => this.runCommand(input, signal)),
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
        (input) => this.safe(() => this.remember(input)),
        {
          name: "remember_project_fact",
          description: "Append a durable, confirmed project decision or convention to project memory. Never store secrets or chat logs.",
          schema: z.object({ note: z.string() })
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
    if (mode === "plan") return [planningTool];
    return [
      planningTool,
      tool(
        (input) => this.safe(() => this.runCommand(input, signal)),
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
        (input) => this.safe(() => this.remember(input)),
        {
          name: "remember_project_fact",
          description: "Append a durable, confirmed project decision or convention to project memory. Never store secrets or chat logs.",
          schema: z.object({ note: z.string() })
        }
      )
    ];
  }

  private async safe(action: () => string | Promise<string>): Promise<string> {
    try {
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: message });
    }
  }

  private async listFiles(input: Record<string, unknown>): Promise<string> {
    const glob = optionalString(input.glob) || "**/*";
    const limit = clampInteger(input.limit, 1, 500, 200);
    const root = vscode.Uri.file(this.workspaceRoot);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, glob),
      FILE_EXCLUSIONS,
      limit
    );
    const relativeFiles = files.map((uri) => path.relative(this.workspaceRoot, uri.fsPath));
    this.onEvent({ type: "activity", kind: "files", title: `Listed ${relativeFiles.length} files · ${glob}` });
    return truncate(JSON.stringify({ files: relativeFiles, truncated: relativeFiles.length === limit }), MAX_TOOL_OUTPUT);
  }

  private async readFile(input: Record<string, unknown>): Promise<string> {
    const requestedPath = requiredString(input.path, "path");
    const file = await this.resolveExistingPath(requestedPath, vscode.FileType.File);
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
    const relative = path.relative(this.workspaceRoot, file);
    this.onEvent({ type: "activity", kind: "read", title: `${relative}:${start}-${end}` });
    return truncate(JSON.stringify({ path: relative, startLine: start, endLine: end, content: numbered }), MAX_TOOL_OUTPUT);
  }

  private async searchText(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const query = requiredString(input.query, "query");
    if (query.length > 500) throw new Error("Search query is too long.");
    const glob = optionalString(input.glob);
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
    this.onEvent({ type: "activity", kind: "search", title: glob ? `${query} · ${glob}` : query });
    return truncate(JSON.stringify({ matches: result.stdout, found: result.exitCode === 0 }), MAX_TOOL_OUTPUT);
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
          matches.push(`${path.relative(this.workspaceRoot, uri.fsPath)}:${index + 1}:${column + 1}:${line}`);
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

  private async editFile(input: Record<string, unknown>): Promise<string> {
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
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    const relative = path.relative(this.workspaceRoot, file);
    this.onEvent({ type: "activity", kind: "files", title: `modified: ${relative}` });
    return JSON.stringify({ path: relative, changed: true });
  }

  private async createFile(input: Record<string, unknown>): Promise<string> {
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
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    const relative = path.relative(this.workspaceRoot, file);
    this.onEvent({ type: "activity", kind: "files", title: `created: ${relative}` });
    return JSON.stringify({ path: relative, created: true });
  }

  private async runCommand(input: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const command = requiredString(input.command, "command");
    if (!/^[a-zA-Z0-9._+-]+$/.test(command)) {
      throw new Error("Command must be an executable name without paths, shell syntax, or substitutions.");
    }
    const args = Array.isArray(input.args) ? input.args.map((value) => String(value)) : [];
    if (args.length > 40 || args.some((argument) => argument.length > 2_000 || argument.includes("\0"))) {
      throw new Error("Command arguments exceed the local safety limits.");
    }
    rejectNetworkCommand(command, args);
    const cwdInput = optionalString(input.cwd) || ".";
    const cwd = await this.resolveExistingPath(cwdInput, vscode.FileType.Directory);
    const timeout = clampInteger(input.timeout_ms, 1_000, 120_000, 60_000);
    const printable = [command, ...args].map(shellDisplay).join(" ");
    const approval = await vscode.window.showWarningMessage(
      `Allow the local agent to run this command in ${path.relative(this.workspaceRoot, cwd) || "."}?\n\n${printable}`,
      { modal: true },
      "Run command"
    );
    if (approval !== "Run command") {
      return JSON.stringify({ denied: true, message: "The user declined command execution." });
    }
    this.onEvent({ type: "activity", kind: "command", title: printable });
    const result = await spawnAndCollect(commandForPlatform(command), args, cwd, signal, timeout);
    const detail = truncate([result.stdout, result.stderr].filter(Boolean).join("\n"), 1_800);
    this.onEvent({ type: "activity", kind: "command", title: `${printable} · exit ${result.exitCode}`, detail });
    return truncate(JSON.stringify(result), MAX_TOOL_OUTPUT);
  }

  private async remember(input: Record<string, unknown>): Promise<string> {
    const note = requiredString(input.note, "note");
    if (/api[-_ ]?key|token|secret|password|bearer\s/i.test(note)) {
      throw new Error("Memory note looks like it may contain a secret and was not saved.");
    }
    const uri = await this.memory.append(note);
    this.onEvent({ type: "activity", kind: "memory", title: `Updated ${vscode.workspace.asRelativePath(uri)}` });
    return JSON.stringify({ saved: true });
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

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n…[truncated]`;
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

function rejectNetworkCommand(command: string, args: string[]): void {
  const executable = command.toLowerCase().replace(/\.exe$|\.cmd$/g, "");
  if (["curl", "wget", "ssh", "scp", "sftp", "ftp", "telnet", "nc", "ncat"].includes(executable)) {
    throw new Error("Network client commands are disabled; only the configured LiteLLM inference endpoint may be contacted.");
  }
  const subcommand = args[0]?.toLowerCase();
  if (executable === "git" && ["clone", "fetch", "pull", "push", "ls-remote"].includes(subcommand ?? "")) {
    throw new Error("Networked Git commands are disabled for the agent runtime.");
  }
  if (["npm", "npx", "pnpm", "yarn"].includes(executable) && ["install", "add", "publish", "exec", "dlx"].includes(subcommand ?? "")) {
    throw new Error("Package download and publish commands are disabled for the agent runtime.");
  }
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
