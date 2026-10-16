import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import {
  deleteDurableMemoryEntry,
  durableMemorySnapshot,
  normalizeMemoryText,
  replaceDurableMemoryEntry
} from "./memory-entries";
import type { DurableMemorySnapshot } from "./memory-entries";
import { redactSensitiveText } from "./redaction";

const MEMORY_DIRECTORY = ".local-agent";
const MEMORY_FILE = "memory.md";
const MAX_MEMORY_FILE_BYTES = 2_000_000;
const MAX_MEMORY_SOURCE_BYTES = 1_500_000;
const DEFAULT_MEMORY = `# Project memory

Durable facts, decisions, conventions, and follow-ups for the workspace agent.

<!-- Keep entries concise, dated, and verifiable. Do not store secrets. -->
`;

export class ProjectMemory {
  public get uri(): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, MEMORY_DIRECTORY, MEMORY_FILE) : undefined;
  }

  public async read(maxCharacters = 12_000): Promise<string> {
    const text = await this.withoutStaleSourceEntries(await this.readSource());
    return text.slice(-maxCharacters);
  }

  public async append(note: string): Promise<vscode.Uri> {
    const uri = this.uri;
    if (!uri) {
      throw new Error("Open a workspace folder before saving project memory.");
    }

    const clean = normalizeMemoryText(note);
    if (redactSensitiveText(clean) !== clean) {
      throw new Error("Memory note looks like it contains a credential and was not saved.");
    }

    const directory = vscode.Uri.joinPath(uri, "..");
    await vscode.workspace.fs.createDirectory(directory);
    const current = await this.readSource();
    const date = new Date().toISOString().slice(0, 10);
    const separator = current.endsWith("\n") ? "" : "\n";
    const updated = `${current}${separator}- ${date}: ${clean}\n`;
    await this.writeSource(uri, updated);
    return uri;
  }

  public async snapshot(maximumEntries = 200): Promise<DurableMemorySnapshot> {
    return durableMemorySnapshot(await this.readSource(), maximumEntries);
  }

  public async replaceEntry(id: string, note: string): Promise<vscode.Uri> {
    this.assertSafeMemoryText(note);
    return this.rewrite((source) => replaceDurableMemoryEntry(source, id, note));
  }

  public async deleteEntry(id: string): Promise<vscode.Uri> {
    return this.rewrite((source) => deleteDurableMemoryEntry(source, id));
  }

  public async open(): Promise<void> {
    const uri = this.uri;
    if (!uri) {
      throw new Error("Open a workspace folder before opening project memory.");
    }
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
      const directory = vscode.Uri.joinPath(uri, "..");
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(DEFAULT_MEMORY));
    }
    await vscode.window.showTextDocument(uri);
  }

  private assertSafeMemoryText(value: string): void {
    if (redactSensitiveText(value) !== value) {
      throw new Error("Memory entry looks like it contains a credential and was not saved.");
    }
  }

  private async rewrite(update: (source: string) => string): Promise<vscode.Uri> {
    const uri = this.uri;
    if (!uri) throw new Error("Open a workspace folder before changing project memory.");
    const source = await this.readSource();
    const updated = update(source);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await this.writeSource(uri, updated);
    return uri;
  }

  private async readSource(): Promise<string> {
    const uri = this.uri;
    if (!uri) return "No workspace memory is available because no folder is open.";
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_MEMORY_FILE_BYTES) {
        throw new Error("Project memory exceeds 2 MB. Open memory.md and reduce it before using agent memory.");
      }
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return DEFAULT_MEMORY;
      throw error;
    }
  }

  private async writeSource(uri: vscode.Uri, source: string): Promise<void> {
    const bytes = new TextEncoder().encode(source);
    if (bytes.byteLength > MAX_MEMORY_FILE_BYTES) {
      throw new Error("Project memory would exceed 2 MB. Remove obsolete entries before adding more.");
    }
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  private async withoutStaleSourceEntries(source: string): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return source;
    const lines = source.split(/\r?\n/);
    const retained: string[] = [];
    for (const line of lines) {
      const metadata = /\s\[sources:\s*([^\]]+)\]\s*$/.exec(line);
      if (!metadata) {
        retained.push(line);
        continue;
      }
      const sources = metadata[1]?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
      const valid = sources.length > 0 && (await Promise.all(sources.map((entry) => this.sourceFingerprintMatches(root, entry))))
        .every(Boolean);
      if (valid) retained.push(line);
    }
    return retained.join(source.includes("\r\n") ? "\r\n" : "\n");
  }

  private async sourceFingerprintMatches(root: string, entry: string): Promise<boolean> {
    const match = /^(.+?)#([a-f0-9]{16})$/.exec(entry);
    if (!match?.[1] || !match[2]) return false;
    const candidate = path.resolve(root, match[1]);
    try {
      const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
      const relative = path.relative(realRoot, realFile);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
      const uri = vscode.Uri.file(realFile);
      const metadata = await vscode.workspace.fs.stat(uri);
      if ((metadata.type & vscode.FileType.File) === 0 || metadata.size > MAX_MEMORY_SOURCE_BYTES) return false;
      const bytes = await vscode.workspace.fs.readFile(uri);
      return createHash("sha256").update(bytes).digest("hex").slice(0, 16) === match[2];
    } catch {
      return false;
    }
  }
}
