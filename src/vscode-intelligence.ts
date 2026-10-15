import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ChangeTracker } from "./change-tracker";
import { isSensitiveWorkspacePath } from "./sensitive-files";

const MAX_RESULTS = 200;
const MAX_RENAME_FILES = 30;
const MAX_RENAME_EDITS = 500;
const MAX_CODE_ACTION_FILES = 20;
const MAX_CODE_ACTION_EDITS = 300;

type PreparedWorkspaceEdit = {
  workspaceEdit: vscode.WorkspaceEdit;
  summary: { files: Array<{ path: string; edits: number }>; totalEdits: number };
};

export type ProblemSnapshot = {
  capturedAt: number;
  items: ProblemItem[];
};

export type ProblemItem = {
  path: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "information" | "hint";
  source?: string;
  code?: string;
  message: string;
};

export class VsCodeIntelligence {
  private problemBaseline: ProblemSnapshot | undefined;

  public constructor(private readonly workspaceRoot: string) {}

  public problems(input: Record<string, unknown>): string {
    const action = optionalString(input.action) ?? "current";
    const pathFilter = optionalString(input.path);
    const severityFilter = optionalString(input.severity);
    const current = this.problemSnapshot(pathFilter, severityFilter);
    if (action === "baseline") {
      this.problemBaseline = current;
      return JSON.stringify({ action, capturedAt: current.capturedAt, count: current.items.length, items: current.items });
    }
    if (action === "compare") {
      if (!this.problemBaseline) throw new Error("Capture a Problems baseline before requesting a comparison.");
      const baselineKeys = new Set(this.problemBaseline.items.map(problemKey));
      const currentKeys = new Set(current.items.map(problemKey));
      const introduced = current.items.filter((item) => !baselineKeys.has(problemKey(item)));
      const resolved = this.problemBaseline.items.filter((item) => !currentKeys.has(problemKey(item)));
      return JSON.stringify({
        action,
        baselineAt: this.problemBaseline.capturedAt,
        capturedAt: current.capturedAt,
        counts: { before: this.problemBaseline.items.length, after: current.items.length },
        introduced,
        resolved,
        unchanged: current.items.length - introduced.length
      });
    }
    if (action !== "current") throw new Error("Problems action must be current, baseline, or compare.");
    return JSON.stringify({ action, capturedAt: current.capturedAt, count: current.items.length, items: current.items });
  }

  public async symbols(input: Record<string, unknown>): Promise<string> {
    const requestedPath = optionalString(input.path);
    const query = optionalString(input.query) ?? "";
    const limit = boundedInteger(input.limit, 1, MAX_RESULTS, 100);
    if (requestedPath) {
      const uri = await this.fileUri(requestedPath);
      const result = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
        "vscode.executeDocumentSymbolProvider",
        uri
      ) ?? [];
      const symbols = flattenDocumentSymbols(result, this.workspaceRoot)
        .filter((item) => !query || String(item.name).toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
      return JSON.stringify({ scope: requestedPath, symbols, truncated: symbols.length === limit });
    }
    if (!query) throw new Error("Provide path for document symbols or query for workspace symbols.");
    const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    ) ?? [];
    const symbols = result.flatMap((item) => {
      const location = serializeLocation(item.location, this.workspaceRoot);
      return location ? [{ name: item.name, kind: vscode.SymbolKind[item.kind], container: item.containerName, ...location }] : [];
    }).slice(0, limit);
    return JSON.stringify({ scope: "workspace", query, symbols, truncated: symbols.length === limit });
  }

  public async navigate(input: Record<string, unknown>): Promise<string> {
    const uri = await this.fileUri(requiredString(input.path, "path"));
    const position = new vscode.Position(
      boundedInteger(input.line, 1, 1_000_000, 1) - 1,
      boundedInteger(input.character, 1, 100_000, 1) - 1
    );
    const kind = requiredString(input.kind, "kind");
    if (kind === "definition" || kind === "references") {
      const command = kind === "definition" ? "vscode.executeDefinitionProvider" : "vscode.executeReferenceProvider";
      const result = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
        command,
        uri,
        position
      ) ?? [];
      const locations = result.flatMap((item) => {
        const location = item instanceof vscode.Location
          ? item
          : new vscode.Location(item.targetUri, item.targetSelectionRange ?? item.targetRange);
        const serialized = serializeLocation(location, this.workspaceRoot);
        return serialized ? [serialized] : [];
      }).slice(0, MAX_RESULTS);
      return JSON.stringify({ kind, locations, count: locations.length });
    }
    if (kind === "incoming_calls" || kind === "outgoing_calls") {
      const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        uri,
        position
      ) ?? [];
      const root = items[0];
      if (!root) return JSON.stringify({ kind, calls: [], message: "No call hierarchy is available at this position." });
      if (kind === "incoming_calls") {
        const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
          "vscode.provideIncomingCalls",
          root
        ) ?? [];
        return JSON.stringify({
          kind,
          calls: calls.flatMap((call) => {
            const location = serializeLocation(new vscode.Location(call.from.uri, call.from.selectionRange), this.workspaceRoot);
            return location ? [{ name: call.from.name, detail: call.from.detail, ...location }] : [];
          }).slice(0, MAX_RESULTS)
        });
      }
      const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        "vscode.provideOutgoingCalls",
        root
      ) ?? [];
      return JSON.stringify({
        kind,
        calls: calls.flatMap((call) => {
          const location = serializeLocation(new vscode.Location(call.to.uri, call.to.selectionRange), this.workspaceRoot);
          return location ? [{ name: call.to.name, detail: call.to.detail, ...location }] : [];
        }).slice(0, MAX_RESULTS)
      });
    }
    throw new Error("Navigation kind must be definition, references, incoming_calls, or outgoing_calls.");
  }

  public async codeActions(input: Record<string, unknown>): Promise<string> {
    const uri = await this.fileUri(requiredString(input.path, "path"));
    const line = boundedInteger(input.line, 1, 1_000_000, 1) - 1;
    const character = boundedInteger(input.character, 1, 100_000, 1) - 1;
    const range = new vscode.Range(new vscode.Position(line, character), new vscode.Position(line, character));
    const result = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
      "vscode.executeCodeActionProvider",
      uri,
      range
    ) ?? [];
    const actions = result.slice(0, 100).map((item) => item instanceof vscode.CodeAction
      ? {
          title: item.title,
          kind: item.kind?.value,
          preferred: Boolean(item.isPreferred),
          disabled: item.disabled?.reason,
          hasEdit: Boolean(item.edit),
          command: item.command?.command
        }
      : { title: item.title, command: item.command, hasEdit: false });
    return JSON.stringify({ path: path.relative(this.workspaceRoot, uri.fsPath), line: line + 1, actions });
  }

  public async codeActionPreview(input: Record<string, unknown>): Promise<PreparedWorkspaceEdit & {
    title: string;
    kind?: string;
  }> {
    const requestedPath = requiredString(input.path, "path");
    const uri = await this.fileUri(requestedPath);
    const line = boundedInteger(input.line, 1, 1_000_000, 1) - 1;
    const character = boundedInteger(input.character, 1, 100_000, 1) - 1;
    const title = requiredString(input.title, "title");
    const requestedKind = optionalString(input.kind);
    const range = new vscode.Range(new vscode.Position(line, character), new vscode.Position(line, character));
    const result = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
      "vscode.executeCodeActionProvider",
      uri,
      range
    ) ?? [];
    const matches = result.filter((item): item is vscode.CodeAction => item instanceof vscode.CodeAction
      && item.title === title
      && (!requestedKind || item.kind?.value === requestedKind));
    if (matches.length !== 1) {
      throw new Error(matches.length
        ? "The requested code action is ambiguous; include its exact kind."
        : "The requested code action is no longer available at this position.");
    }
    const action = matches[0];
    if (!action) throw new Error("The requested code action is no longer available at this position.");
    if (action.disabled) throw new Error(`The requested code action is disabled: ${action.disabled.reason}`);
    if (!action.edit) throw new Error("This code action has no reviewable WorkspaceEdit.");
    if (action.command) {
      throw new Error("Code actions that also execute an extension command are not applied automatically.");
    }
    const prepared = this.validateWorkspaceEdit(action.edit, MAX_CODE_ACTION_FILES, MAX_CODE_ACTION_EDITS);
    return { ...prepared, title: action.title, ...(action.kind ? { kind: action.kind.value } : {}) };
  }

  public async applyCodeAction(prepared: PreparedWorkspaceEdit, tracker: ChangeTracker): Promise<string> {
    const result = await this.applyTrackedWorkspaceEdit(prepared, tracker);
    return JSON.stringify({ applied: true, ...prepared.summary, unsaved: result.unsaved });
  }

  public async renamePreview(input: Record<string, unknown>): Promise<{
    workspaceEdit: vscode.WorkspaceEdit;
    summary: { oldLocation: string; newName: string; files: Array<{ path: string; edits: number }>; totalEdits: number };
  }> {
    const requestedPath = requiredString(input.path, "path");
    const uri = await this.fileUri(requestedPath);
    const line = boundedInteger(input.line, 1, 1_000_000, 1) - 1;
    const character = boundedInteger(input.character, 1, 100_000, 1) - 1;
    const newName = requiredString(input.new_name, "new_name");
    if (newName.length > 256 || /[\r\n\0]/.test(newName)) throw new Error("The new symbol name is invalid or too long.");
    const workspaceEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
      "vscode.executeDocumentRenameProvider",
      uri,
      new vscode.Position(line, character),
      newName
    );
    if (!workspaceEdit) throw new Error("The active language service could not prepare this rename.");
    const prepared = this.validateWorkspaceEdit(workspaceEdit, MAX_RENAME_FILES, MAX_RENAME_EDITS);
    return {
      workspaceEdit: prepared.workspaceEdit,
      summary: {
        oldLocation: `${requestedPath}:${line + 1}:${character + 1}`,
        newName,
        ...prepared.summary
      }
    };
  }

  public async applyRename(
    prepared: Awaited<ReturnType<VsCodeIntelligence["renamePreview"]>>,
    tracker: ChangeTracker
  ): Promise<string> {
    const { unsaved } = await this.applyTrackedWorkspaceEdit(prepared, tracker);
    return JSON.stringify({ renamed: true, ...prepared.summary, unsaved });
  }

  private validateWorkspaceEdit(
    workspaceEdit: vscode.WorkspaceEdit,
    maximumFiles: number,
    maximumEdits: number
  ): PreparedWorkspaceEdit {
    const reviewableEdit = new vscode.WorkspaceEdit();
    const files = workspaceEdit.entries().map(([target, edits]) => {
      const relative = safeRelativeFile(this.workspaceRoot, target);
      if (!relative) throw new Error("The language service proposed an edit outside the opened workspace.");
      if (isSensitiveWorkspacePath(relative)) throw new Error("The language service proposed editing a sensitive file.");
      reviewableEdit.set(target, edits);
      return { path: relative, edits: edits.length };
    });
    const totalEdits = files.reduce((sum, file) => sum + file.edits, 0);
    if (!files.length || files.length > maximumFiles || totalEdits > maximumEdits) {
      throw new Error(`Language-service edit must affect between 1 and ${maximumFiles} files and at most ${maximumEdits} text edits.`);
    }
    return { workspaceEdit: reviewableEdit, summary: { files, totalEdits } };
  }

  private async applyTrackedWorkspaceEdit(
    prepared: PreparedWorkspaceEdit,
    tracker: ChangeTracker
  ): Promise<{ unsaved: string[] }> {
    for (const file of prepared.summary.files) await tracker.captureBefore(file.path);
    if (!await vscode.workspace.applyEdit(prepared.workspaceEdit)) {
      throw new Error("VS Code could not apply the language-service WorkspaceEdit.");
    }
    const unsaved: string[] = [];
    for (const file of prepared.summary.files) {
      const uri = vscode.Uri.file(path.join(this.workspaceRoot, file.path));
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.isDirty && !await document.save()) unsaved.push(file.path);
      } catch {
        unsaved.push(file.path);
      }
      await tracker.captureAfter(file.path);
    }
    return { unsaved };
  }

  private problemSnapshot(pathFilter?: string, severityFilter?: string): ProblemSnapshot {
    const normalizedSeverity = severityFilter?.toLowerCase();
    const items = vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) => {
      const relative = safeRelativeFile(this.workspaceRoot, uri);
      if (!relative || isSensitiveWorkspacePath(relative)) return [];
      if (pathFilter && relative !== pathFilter && !relative.startsWith(`${pathFilter.replace(/\/$/, "")}/`)) return [];
      return diagnostics.flatMap((diagnostic): ProblemItem[] => {
        const severity = diagnosticSeverity(diagnostic.severity);
        if (normalizedSeverity && severity !== normalizedSeverity) return [];
        return [{
          path: relative,
          line: diagnostic.range.start.line + 1,
          character: diagnostic.range.start.character + 1,
          severity,
          ...(diagnostic.source ? { source: diagnostic.source } : {}),
          ...(diagnostic.code !== undefined
            ? { code: typeof diagnostic.code === "object" ? String(diagnostic.code.value) : String(diagnostic.code) }
            : {}),
          message: diagnostic.message.slice(0, 2_000)
        }];
      });
    }).slice(0, MAX_RESULTS);
    return { capturedAt: Date.now(), items };
  }

  private async fileUri(requestedPath: string): Promise<vscode.Uri> {
    if (!requestedPath || path.isAbsolute(requestedPath) || requestedPath.includes("\0")) {
      throw new Error("Code-intelligence paths must be relative to the opened workspace.");
    }
    const candidate = path.resolve(this.workspaceRoot, requestedPath);
    const [root, target] = await Promise.all([realpath(this.workspaceRoot), realpath(candidate)]);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Code intelligence is restricted to workspace files.");
    }
    if (isSensitiveWorkspacePath(relative)) throw new Error("Code intelligence is disabled for sensitive files.");
    return vscode.Uri.file(target);
  }
}

function flattenDocumentSymbols(
  symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>,
  workspaceRoot: string,
  container = ""
): Array<Record<string, unknown>> {
  return symbols.flatMap((item) => {
    if (item instanceof vscode.DocumentSymbol) {
      return [
        {
          name: item.name,
          kind: vscode.SymbolKind[item.kind],
          container,
          line: item.selectionRange.start.line + 1,
          character: item.selectionRange.start.character + 1
        },
        ...flattenDocumentSymbols(item.children, workspaceRoot, item.name)
      ];
    }
    const location = serializeLocation(item.location, workspaceRoot);
    return location ? [{ name: item.name, kind: vscode.SymbolKind[item.kind], container: item.containerName, ...location }] : [];
  });
}

function serializeLocation(location: vscode.Location, workspaceRoot: string): { path: string; line: number; character: number } | undefined {
  const relative = safeRelativeFile(workspaceRoot, location.uri);
  if (!relative || isSensitiveWorkspacePath(relative)) return undefined;
  return {
    path: relative,
    line: location.range.start.line + 1,
    character: location.range.start.character + 1
  };
}

function safeRelativeFile(workspaceRoot: string, uri: vscode.Uri): string | undefined {
  if (uri.scheme !== "file") return undefined;
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(uri.fsPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function diagnosticSeverity(value: vscode.DiagnosticSeverity): ProblemItem["severity"] {
  if (value === vscode.DiagnosticSeverity.Error) return "error";
  if (value === vscode.DiagnosticSeverity.Warning) return "warning";
  if (value === vscode.DiagnosticSeverity.Information) return "information";
  return "hint";
}

function problemKey(item: ProblemItem): string {
  return `${item.path}\0${item.line}\0${item.character}\0${item.severity}\0${item.source ?? ""}\0${item.code ?? ""}\0${item.message}`;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
