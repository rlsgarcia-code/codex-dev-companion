import * as path from "node:path";
import * as vscode from "vscode";
import type { ContextSnapshot } from "./types";

const EXCLUDED_FILES = "**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**";

export class ContextCollector {
  private readonly pinned: string[] = [];

  public pinSelection(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return undefined;
    }

    const root = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
    const filename = root
      ? path.relative(root, editor.document.uri.fsPath)
      : editor.document.uri.fsPath;
    const range = `${editor.selection.start.line + 1}:${editor.selection.start.character + 1}-${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`;
    const content = editor.document.getText(editor.selection);
    const block = `${filename} (${range})\n\`\`\`${editor.document.languageId}\n${content}\n\`\`\``;
    this.pinned.push(block);
    if (this.pinned.length > 6) {
      this.pinned.shift();
    }
    return filename;
  }

  public clearPinned(): void {
    this.pinned.length = 0;
  }

  public async collect(maxCharacters: number): Promise<ContextSnapshot> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const editor = vscode.window.activeTextEditor;
    const activeRoot = editor
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
      : folders[0]?.uri.fsPath;

    let selection: string | undefined;
    let activeFile: string | undefined;
    let language: string | undefined;
    let cursor: string | undefined;
    if (editor) {
      activeFile = activeRoot
        ? path.relative(activeRoot, editor.document.uri.fsPath)
        : editor.document.uri.fsPath;
      language = editor.document.languageId;
      cursor = `${editor.selection.active.line + 1}:${editor.selection.active.character + 1}`;
      if (!editor.selection.isEmpty) {
        selection = editor.document.getText(editor.selection).slice(0, Math.floor(maxCharacters * 0.55));
      }
    }

    const diagnostics = editor
      ? vscode.languages.getDiagnostics(editor.document.uri).slice(0, 30).map((diagnostic) => {
          const line = diagnostic.range.start.line + 1;
          const severity = vscode.DiagnosticSeverity[diagnostic.severity] ?? "Unknown";
          return `${activeFile}:${line} [${severity}] ${diagnostic.message}`;
        })
      : [];

    const openFiles = vscode.workspace.textDocuments
      .filter((document) => !document.isUntitled && document.uri.scheme === "file")
      .slice(0, 30)
      .map((document) => {
        const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        return root ? path.relative(root, document.uri.fsPath) : document.uri.fsPath;
      });

    const files = await vscode.workspace.findFiles("**/*", EXCLUDED_FILES, 100);
    const projectFiles = files.map((uri) => {
      const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
      return root ? path.relative(root, uri.fsPath) : uri.fsPath;
    });

    return {
      workspaceName: vscode.workspace.name ?? "Untitled workspace",
      workspaceRoots: folders.map((folder) => folder.uri.fsPath),
      activeFile,
      language,
      cursor,
      selection,
      diagnostics,
      openFiles,
      projectFiles,
      pinnedContext: [...this.pinned]
    };
  }
}

export function renderContext(snapshot: ContextSnapshot, maxCharacters: number): string {
  const sections = [
    `<workspace name="${snapshot.workspaceName}">\n${snapshot.workspaceRoots.join("\n")}\n</workspace>`,
    snapshot.activeFile
      ? `<active_editor file="${snapshot.activeFile}" language="${snapshot.language}" cursor="${snapshot.cursor}" />`
      : "<active_editor none=\"true\" />",
    snapshot.selection
      ? `<selection>\n${snapshot.selection}\n</selection>`
      : "<selection none=\"true\" />",
    `<diagnostics>\n${snapshot.diagnostics.join("\n") || "None"}\n</diagnostics>`,
    `<open_files>\n${snapshot.openFiles.join("\n") || "None"}\n</open_files>`,
    `<project_file_sample>\n${snapshot.projectFiles.join("\n") || "None"}\n</project_file_sample>`,
    snapshot.pinnedContext.length
      ? `<pinned_context>\n${snapshot.pinnedContext.join("\n\n")}\n</pinned_context>`
      : "<pinned_context none=\"true\" />"
  ];
  return sections.join("\n\n").slice(0, maxCharacters);
}
