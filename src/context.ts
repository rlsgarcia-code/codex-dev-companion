import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { composeContextSourcesWithinBudget } from "./context-budget";
import type { ContextBudget } from "./context-budget";
import { collectProjectGuidance } from "./project-guidance";
import { isSensitiveWorkspacePath } from "./sensitive-files";
import type { ContextSnapshot, PinnedContextSource } from "./types";

const EXCLUDED_FILES = "**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**";
const MAX_PINNED_CONTEXT_ENTRIES = 6;
const MAX_PINNED_FILE_BYTES = 1_000_000;
const MAX_PINNED_FILE_CHARACTERS = 24_000;

export type PinnedContextSummary = PinnedContextSource;

type PinnedContextEntry = Omit<PinnedContextSummary, "characters" | "estimatedTokens"> & {
  content: string;
};

export class ContextCollector {
  private readonly pinned: PinnedContextEntry[] = [];

  public pinSelection(): PinnedContextSummary | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return undefined;
    }

    const root = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
    const filename = root
      ? path.relative(root, editor.document.uri.fsPath)
      : editor.document.uri.fsPath;
    if (isSensitiveWorkspacePath(filename)) {
      throw new Error("Sensitive credential files cannot be pinned as automatic message context.");
    }
    const range = `${editor.selection.start.line + 1}:${editor.selection.start.character + 1}-${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`;
    const content = editor.document.getText(editor.selection);
    const block = `${filename} (${range})\n\`\`\`${editor.document.languageId}\n${content}\n\`\`\``;
    const entry: PinnedContextEntry = {
      id: crypto.randomUUID(),
      filename,
      range,
      kind: "selection",
      content: block
    };
    this.addPinned(entry);
    return this.summary(entry);
  }

  public async pinFile(uri: vscode.Uri): Promise<PinnedContextSummary> {
    if (uri.scheme !== "file") throw new Error("Choose a local workspace file.");
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) throw new Error("The selected file is outside the opened workspace.");
    const [realRoot, realFile] = await Promise.all([
      realpath(folder.uri.fsPath),
      realpath(uri.fsPath)
    ]);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("The selected file resolves outside the opened workspace.");
    }
    const filename = path.relative(folder.uri.fsPath, uri.fsPath);
    if (isSensitiveWorkspacePath(filename)) {
      throw new Error("Sensitive credential files cannot be pinned as automatic message context.");
    }
    const duplicate = this.pinned.find((entry) => entry.kind === "file" && entry.filename === filename);
    if (duplicate) return this.summary(duplicate);

    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.File) === 0) throw new Error("Choose a file, not a directory.");
    if (stat.size > MAX_PINNED_FILE_BYTES) {
      throw new Error("This file is too large to pin. Ask the agent to read it on demand instead.");
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const fullText = document.getText();
    if (fullText.includes("\0")) throw new Error("Binary files cannot be pinned as message context.");
    const truncated = fullText.length > MAX_PINNED_FILE_CHARACTERS;
    const text = fullText.slice(0, MAX_PINNED_FILE_CHARACTERS);
    const lineCount = Math.max(1, text.split("\n").length);
    const range = truncated
      ? `First ${MAX_PINNED_FILE_CHARACTERS.toLocaleString()} characters`
      : `${lineCount.toLocaleString()} line${lineCount === 1 ? "" : "s"}`;
    const entry: PinnedContextEntry = {
      id: crypto.randomUUID(),
      filename,
      range,
      kind: "file",
      content: `${filename} (${truncated ? "pinned file, truncated" : "pinned file"})\n\`\`\`${document.languageId}\n${text}\n\`\`\``
    };
    this.addPinned(entry);
    return this.summary(entry);
  }

  public async workspaceFiles(limit = 2_000): Promise<vscode.Uri[]> {
    const files = await vscode.workspace.findFiles("**/*", EXCLUDED_FILES, limit);
    return files.filter((uri) => {
      const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
      return !isSensitiveWorkspacePath(root ? path.relative(root, uri.fsPath) : uri.fsPath);
    });
  }

  public clearPinned(): void {
    this.pinned.length = 0;
  }

  public removePinned(id: string): boolean {
    const index = this.pinned.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    this.pinned.splice(index, 1);
    return true;
  }

  public pinnedContext(): PinnedContextSummary[] {
    return this.pinned.map((entry) => this.summary(entry));
  }

  private addPinned(entry: PinnedContextEntry): void {
    this.pinned.push(entry);
    if (this.pinned.length > MAX_PINNED_CONTEXT_ENTRIES) this.pinned.shift();
  }

  private summary(entry: PinnedContextEntry): PinnedContextSummary {
    return {
      id: entry.id,
      filename: entry.filename,
      range: entry.range,
      kind: entry.kind,
      characters: entry.content.length,
      estimatedTokens: Math.ceil(entry.content.length / 4)
    };
  }

  public async collect(maxCharacters: number, includeAutomaticContext = true): Promise<ContextSnapshot> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const editor = vscode.window.activeTextEditor;
    const activeRoot = editor
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
      : folders[0]?.uri.fsPath;

    let selection: string | undefined;
    let activeFile: string | undefined;
    let language: string | undefined;
    let cursor: string | undefined;
    if (editor && includeAutomaticContext) {
      const candidateActiveFile = activeRoot
        ? path.relative(activeRoot, editor.document.uri.fsPath)
        : editor.document.uri.fsPath;
      if (!isSensitiveWorkspacePath(candidateActiveFile)) {
        activeFile = candidateActiveFile;
        language = editor.document.languageId;
        cursor = `${editor.selection.active.line + 1}:${editor.selection.active.character + 1}`;
        if (!editor.selection.isEmpty) {
          selection = editor.document.getText(editor.selection).slice(0, Math.floor(maxCharacters * 0.55));
        }
      }
    }

    const diagnostics = editor && includeAutomaticContext && activeFile
      ? vscode.languages.getDiagnostics(editor.document.uri).slice(0, 30).map((diagnostic) => {
          const line = diagnostic.range.start.line + 1;
          const severity = vscode.DiagnosticSeverity[diagnostic.severity] ?? "Unknown";
          return `${activeFile}:${line} [${severity}] ${diagnostic.message}`;
        })
      : [];

    const openFiles = includeAutomaticContext ? vscode.workspace.textDocuments
      .filter((document) => !document.isUntitled && document.uri.scheme === "file")
      .slice(0, 30)
      .map((document) => {
        const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        return root ? path.relative(root, document.uri.fsPath) : document.uri.fsPath;
      })
      .filter((filename) => !isSensitiveWorkspacePath(filename)) : [];

    const [files, projectGuidance] = includeAutomaticContext
      ? await Promise.all([
          vscode.workspace.findFiles("**/*", EXCLUDED_FILES, 100),
          collectProjectGuidance(
            folders.map((folder) => folder.uri.fsPath),
            editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined
          )
        ])
      : [[], []];
    const projectFiles = files
      .map((uri) => {
        const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
        return root ? path.relative(root, uri.fsPath) : uri.fsPath;
      })
      .filter((file) => !isSensitiveWorkspacePath(file));

    return {
      automaticContextEnabled: includeAutomaticContext,
      workspaceName: vscode.workspace.name ?? "Untitled workspace",
      workspaceRoots: folders.map((folder) => folder.uri.fsPath),
      activeFile,
      language,
      cursor,
      selection,
      diagnostics,
      openFiles,
      projectFiles,
      projectGuidance,
      pinnedContext: this.pinned.map((entry) => entry.content),
      pinnedSources: this.pinned.map((entry) => this.summary(entry))
    };
  }

  public async preview(maxCharacters: number, includeAutomaticContext: boolean): Promise<ContextBudget> {
    const snapshot = await this.collect(maxCharacters, includeAutomaticContext);
    return renderContextWithBudget(snapshot, maxCharacters).budget;
  }
}

export function renderContext(snapshot: ContextSnapshot, maxCharacters: number): string {
  return renderContextWithBudget(snapshot, maxCharacters).text;
}

export function renderContextWithBudget(snapshot: ContextSnapshot, maxCharacters: number) {
  const automaticSections = [
    `<workspace name="${snapshot.workspaceName}">\n${snapshot.workspaceRoots.join("\n")}\n</workspace>`,
    snapshot.automaticContextEnabled && snapshot.activeFile
      ? `<active_editor file="${snapshot.activeFile}" language="${snapshot.language}" cursor="${snapshot.cursor}" />`
      : snapshot.automaticContextEnabled
        ? "<active_editor none=\"true\" />"
        : "<automatic_editor_context enabled=\"false\" />",
    snapshot.automaticContextEnabled && snapshot.selection
      ? `<selection>\n${snapshot.selection}\n</selection>`
      : "<selection none=\"true\" />",
    `<diagnostics>\n${snapshot.diagnostics.join("\n") || "None"}\n</diagnostics>`,
    `<open_files>\n${snapshot.openFiles.join("\n") || "None"}\n</open_files>`,
    `<project_file_sample>\n${snapshot.projectFiles.join("\n") || "None"}\n</project_file_sample>`
  ];
  const pinnedSection = snapshot.pinnedContext.length
    ? `<pinned_context priority="user">\n${snapshot.pinnedContext.join("\n\n")}\n</pinned_context>`
    : "";
  const guidanceSection = snapshot.projectGuidance.length
    ? `<project_guidance trust="workspace-content" precedence="below-user-and-operating-rules">\n${snapshot.projectGuidance.map((document) =>
        `<guidance_file path="${escapeAttribute(document.path)}" scope="${document.scope}" truncated="${document.truncated}">\n${escapeXmlText(document.content)}\n</guidance_file>`
      ).join("\n\n")}\n</project_guidance>`
    : "";
  const composed = composeContextSourcesWithinBudget(
    automaticSections.join("\n\n"),
    guidanceSection,
    pinnedSection,
    maxCharacters
  );
  composed.budget.guidancePaths = snapshot.projectGuidance
    .filter((document) => composed.text.includes(`path="${escapeAttribute(document.path)}"`))
    .map((document) => document.path);
  composed.budget.guidanceFiles = composed.budget.guidancePaths.length;
  return composed;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
