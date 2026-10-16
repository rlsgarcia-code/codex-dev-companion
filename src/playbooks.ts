import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const PLAYBOOK_DIRECTORY = path.join(".local-agent", "playbooks");
const MAX_PLAYBOOKS = 100;
const MAX_PLAYBOOK_BYTES = 128_000;
const MAX_PLAYBOOK_CHARACTERS = 24_000;

export type LocalPlaybookSummary = {
  name: string;
  path: string;
};

export async function listLocalPlaybooks(workspaceRoot: string): Promise<LocalPlaybookSummary[]> {
  const root = vscode.Uri.file(workspaceRoot);
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, `${PLAYBOOK_DIRECTORY.replaceAll(path.sep, "/")}/*.md`),
    undefined,
    MAX_PLAYBOOKS
  );
  const summaries: LocalPlaybookSummary[] = [];
  for (const uri of files) {
    const safe = await safePlaybookPath(workspaceRoot, uri.fsPath).catch(() => undefined);
    if (!safe) continue;
    summaries.push({
      name: path.basename(safe, ".md"),
      path: path.relative(workspaceRoot, safe).split(path.sep).join("/")
    });
  }
  return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readLocalPlaybook(workspaceRoot: string, name: string): Promise<{
  name: string;
  path: string;
  content: string;
  truncated: boolean;
}> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) {
    throw new Error("Playbook names may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  const requested = path.join(workspaceRoot, PLAYBOOK_DIRECTORY, `${name}.md`);
  const safe = await safePlaybookPath(workspaceRoot, requested);
  const uri = vscode.Uri.file(safe);
  const metadata = await vscode.workspace.fs.stat(uri);
  if ((metadata.type & vscode.FileType.File) === 0 || metadata.size > MAX_PLAYBOOK_BYTES) {
    throw new Error("Playbook must be a regular Markdown file no larger than 128 KB.");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
  if (source.includes("\0")) throw new Error("Binary playbooks are not supported.");
  const content = source.slice(0, MAX_PLAYBOOK_CHARACTERS);
  return {
    name,
    path: path.relative(workspaceRoot, safe).split(path.sep).join("/"),
    content,
    truncated: content.length < source.length
  };
}

async function safePlaybookPath(workspaceRoot: string, requested: string): Promise<string> {
  const [realRoot, realPlaybookDirectory, realRequested] = await Promise.all([
    realpath(workspaceRoot),
    realpath(path.join(workspaceRoot, PLAYBOOK_DIRECTORY)),
    realpath(requested)
  ]);
  assertInside(realRoot, realPlaybookDirectory);
  assertInside(realPlaybookDirectory, realRequested);
  return realRequested;
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Playbooks must remain inside .local-agent/playbooks.");
  }
}
