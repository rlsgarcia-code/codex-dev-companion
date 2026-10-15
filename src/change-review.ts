import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ChangeTracker, type TrackedFileChange } from "./change-tracker";
import type { RunFileChange } from "./types";

const MAX_RETAINED_RUNS = 5;

type StoredChange = TrackedFileChange & {
  threadId: string;
  restored: boolean;
};

export type RestoreChangeResult = {
  item: RunFileChange;
  unsavedPaths: string[];
};

export type RestoreRunResult = {
  items: RunFileChange[];
  unsavedPaths: string[];
};

export class ChangeReviewManager implements vscode.TextDocumentContentProvider, vscode.Disposable {
  public static readonly scheme = "local-companion-review";

  private readonly changes = new Map<string, StoredChange>();
  private readonly retainedRuns: string[][] = [];

  public startRun(workspaceRoot: string): ChangeTracker {
    return new ChangeTracker(workspaceRoot);
  }

  public finishRun(
    threadId: string,
    tracker: ChangeTracker
  ): { items: RunFileChange[]; omitted: number } {
    const result = tracker.finalize();
    const runIds: string[] = [];
    for (const change of result.changes) {
      this.changes.set(change.id, { ...change, threadId, restored: false });
      runIds.push(change.id);
    }
    if (runIds.length) this.retainedRuns.push(runIds);
    while (this.retainedRuns.length > MAX_RETAINED_RUNS) {
      for (const id of this.retainedRuns.shift() ?? []) this.changes.delete(id);
    }
    return {
      items: runIds.map((id) => this.summary(this.requiredChange(id))),
      omitted: result.omitted
    };
  }

  public change(changeId: string): RunFileChange {
    return this.summary(this.requiredChange(changeId));
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const { change, side } = this.changeFromUri(uri);
    return (side === "before" ? change.before : change.after) ?? "";
  }

  public async openDiff(changeId: string): Promise<void> {
    const change = this.requiredChange(changeId);
    const before = this.snapshotUri(change, "before");
    const after = this.snapshotUri(change, "after");
    await vscode.commands.executeCommand(
      "vscode.diff",
      before,
      after,
      `${change.path} · before ↔ after Local Companion`
    );
  }

  public async restore(changeId: string): Promise<RestoreChangeResult> {
    const change = this.requiredChange(changeId);
    if (change.restored) return { item: this.summary(change), unsavedPaths: [] };
    const unsavedPaths = await this.restoreChanges([change]);
    return { item: this.summary(change), unsavedPaths };
  }

  public async restoreRun(changeIds: string[]): Promise<RestoreRunResult> {
    const uniqueIds = [...new Set(changeIds)];
    if (!uniqueIds.length || uniqueIds.length !== changeIds.length) {
      throw new Error("The run restore request is empty or contains duplicate files.");
    }
    const retainedRun = this.retainedRuns.find(
      (ids) => ids.length === uniqueIds.length && ids.every((id) => uniqueIds.includes(id))
    );
    if (!retainedRun) {
      throw new Error("This complete run snapshot is no longer available. Review files individually instead.");
    }
    const changes = retainedRun.map((id) => this.requiredChange(id));
    const unsavedPaths = await this.restoreChanges(changes.filter((change) => !change.restored));
    return { items: changes.map((change) => this.summary(change)), unsavedPaths };
  }

  private async restoreChanges(changes: StoredChange[]): Promise<string[]> {
    if (!changes.length) return [];
    const prepared = await Promise.all(changes.map(async (change) => {
      const uri = await safeReviewUri(change.workspaceRoot, change.absolutePath);
      const current = await this.currentContents(uri);
      if (current !== change.after) {
        throw new Error(
          `${change.path} changed after this agent run. No files were restored so newer work is preserved.`
        );
      }
      return { change, uri };
    }));

    const edit = new vscode.WorkspaceEdit();
    for (const { change, uri } of prepared) {
      if (change.before === null) {
        edit.deleteFile(uri, { ignoreIfNotExists: false, recursive: false });
      } else if (change.after === null) {
        edit.createFile(uri, { ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), change.before);
      } else {
        const document = await vscode.workspace.openTextDocument(uri);
        edit.replace(uri, fullDocumentRange(document), change.before);
      }
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error("VS Code could not restore the selected run files.");
    }
    for (const { change } of prepared) change.restored = true;
    const unsavedPaths: string[] = [];
    for (const { change, uri } of prepared) {
      if (change.before === null) continue;
      try {
        const restoredDocument = await vscode.workspace.openTextDocument(uri);
        if (!await restoredDocument.save()) unsavedPaths.push(change.path);
      } catch {
        unsavedPaths.push(change.path);
      }
    }
    return unsavedPaths;
  }

  public dispose(): void {
    this.changes.clear();
    this.retainedRuns.length = 0;
  }

  private async currentContents(uri: vscode.Uri): Promise<string | null> {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.scheme === "file" && document.uri.fsPath === uri.fsPath
    );
    if (open) return open.getText();
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return null;
      throw error;
    }
  }

  private snapshotUri(change: StoredChange, side: "before" | "after"): vscode.Uri {
    return vscode.Uri.from({
      scheme: ChangeReviewManager.scheme,
      authority: "snapshot",
      path: `/${change.id}/${side}/${change.path}`
    });
  }

  private changeFromUri(uri: vscode.Uri): { change: StoredChange; side: "before" | "after" } {
    const [, changeId, side] = uri.path.split("/");
    if (side !== "before" && side !== "after") throw new Error("Invalid review snapshot URI.");
    return { change: this.requiredChange(changeId ?? ""), side };
  }

  private requiredChange(changeId: string): StoredChange {
    const change = this.changes.get(changeId);
    if (!change) throw new Error("This run review is no longer available. Run the task again to create a new snapshot.");
    return change;
  }

  private summary(change: StoredChange): RunFileChange {
    return {
      id: change.id,
      path: change.path,
      kind: change.kind,
      restored: change.restored
    };
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length));
}

async function safeReviewUri(workspaceRoot: string, absolutePath: string): Promise<vscode.Uri> {
  const realRoot = await realpath(workspaceRoot);
  try {
    const realFile = await realpath(absolutePath);
    assertInside(realRoot, realFile);
    return vscode.Uri.file(realFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    let ancestor = path.dirname(absolutePath);
    while (ancestor !== path.dirname(ancestor)) {
      try {
        assertInside(realRoot, await realpath(ancestor));
        return vscode.Uri.file(absolutePath);
      } catch (ancestorError) {
        if ((ancestorError as NodeJS.ErrnoException).code !== "ENOENT") throw ancestorError;
        ancestor = path.dirname(ancestor);
      }
    }
    throw new Error("The review target no longer resolves inside the opened workspace.");
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The review target resolves outside the opened workspace.");
  }
}
