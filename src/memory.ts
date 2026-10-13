import * as vscode from "vscode";

const MEMORY_DIRECTORY = ".codex-agent";
const MEMORY_FILE = "memory.md";
const DEFAULT_MEMORY = `# Project memory

Durable facts, decisions, conventions, and follow-ups for the development agent.

<!-- Keep entries concise, dated, and verifiable. Do not store secrets. -->
`;

export class ProjectMemory {
  public get uri(): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, MEMORY_DIRECTORY, MEMORY_FILE) : undefined;
  }

  public async read(maxCharacters = 12_000): Promise<string> {
    const uri = this.uri;
    if (!uri) {
      return "No workspace memory is available because no folder is open.";
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      return text.slice(-maxCharacters);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return DEFAULT_MEMORY;
      }
      throw error;
    }
  }

  public async append(note: string): Promise<vscode.Uri> {
    const uri = this.uri;
    if (!uri) {
      throw new Error("Open a workspace folder before saving project memory.");
    }

    const clean = note.replace(/\s+/g, " ").trim();
    if (!clean) {
      throw new Error("Memory note cannot be empty.");
    }

    const directory = vscode.Uri.joinPath(uri, "..");
    await vscode.workspace.fs.createDirectory(directory);
    const current = await this.read(100_000);
    const date = new Date().toISOString().slice(0, 10);
    const separator = current.endsWith("\n") ? "" : "\n";
    const updated = `${current}${separator}- ${date}: ${clean}\n`;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    return uri;
  }

  public async open(): Promise<void> {
    const uri = this.uri;
    if (!uri) {
      throw new Error("Open a workspace folder before opening project memory.");
    }
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      const directory = vscode.Uri.joinPath(uri, "..");
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(DEFAULT_MEMORY));
    }
    await vscode.window.showTextDocument(uri);
  }
}
