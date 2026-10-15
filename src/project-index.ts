import * as path from "node:path";
import * as vscode from "vscode";
import { isSensitiveWorkspacePath } from "./sensitive-files";

const EXCLUSIONS = "**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor,.venv,venv}/**";
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".html", ".java", ".js", ".jsx", ".kt", ".php",
  ".py", ".rb", ".rs", ".scss", ".swift", ".ts", ".tsx", ".vue"
]);
const TEST_PATTERN = /(?:^|[/\\])(?:test|tests|spec|specs|__tests__)(?:[/\\]|$)|(?:\.test|\.spec|_test)\.[^.]+$/i;
const MAX_FILES = 2_500;
const MAX_SOURCE_BYTES = 500_000;
const MAX_GRAPH_FILES = 1_200;

type IndexedFile = {
  path: string;
  imports: string[];
  test: boolean;
};

type ProjectSnapshot = {
  generatedAt: number;
  files: string[];
  sourceFiles: IndexedFile[];
  scripts: Record<string, string>;
  frameworks: string[];
  truncated: boolean;
};

export class LocalProjectIndex implements vscode.Disposable {
  private snapshot: Promise<ProjectSnapshot> | undefined;
  private readonly watcher: vscode.FileSystemWatcher;

  public constructor(private readonly workspaceRoot: string) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(workspaceRoot), "**/*")
    );
    this.watcher.onDidCreate(() => this.invalidate());
    this.watcher.onDidChange(() => this.invalidate());
    this.watcher.onDidDelete(() => this.invalidate());
  }

  public async inspect(input: Record<string, unknown>): Promise<string> {
    const snapshot = await this.current();
    const focus = optionalString(input.focus);
    const maximum = boundedInteger(input.limit, 1, 200, 80);
    const source = focus
      ? snapshot.sourceFiles.find((file) => file.path === normalizeRelative(focus))
      : undefined;
    const focusStem = focus ? fileStem(focus) : "";
    const relatedTests = focus
      ? snapshot.sourceFiles
          .filter((file) => file.test && (
            file.path.toLowerCase().includes(focusStem.toLowerCase())
            || file.imports.some((entry) => importMayReference(entry, focus))
          ))
          .map((file) => file.path)
          .slice(0, maximum)
      : snapshot.sourceFiles.filter((file) => file.test).map((file) => file.path).slice(0, maximum);
    const dependents = focus
      ? snapshot.sourceFiles
          .filter((file) => file.imports.some((entry) => importMayReference(entry, focus)))
          .map((file) => file.path)
          .slice(0, maximum)
      : [];
    const directories = directoryCounts(snapshot.files).slice(0, 40);
    return JSON.stringify({
      generatedAt: snapshot.generatedAt,
      totalFiles: snapshot.files.length,
      indexedSourceFiles: snapshot.sourceFiles.length,
      truncated: snapshot.truncated,
      frameworks: snapshot.frameworks,
      scripts: snapshot.scripts,
      directories,
      ...(focus ? {
        focus: normalizeRelative(focus),
        imports: source?.imports ?? [],
        dependents,
        relatedTests
      } : { sampleTests: relatedTests })
    });
  }

  public async verificationPlan(changedPaths: string[] = []): Promise<string> {
    const snapshot = await this.current();
    const scripts = snapshot.scripts;
    const commands: Array<{ purpose: string; command: string; args: string[]; reason: string }> = [];
    const manager = snapshot.files.includes("pnpm-lock.yaml")
      ? "pnpm"
      : snapshot.files.includes("yarn.lock")
        ? "yarn"
        : snapshot.files.includes("bun.lockb") || snapshot.files.includes("bun.lock")
          ? "bun"
          : "npm";
    const scriptArgs = (name: string) => manager === "yarn" ? [name] : ["run", name];
    const addScript = (purpose: string, names: string[]) => {
      const name = names.find((candidate) => candidate in scripts);
      if (name) commands.push({ purpose, command: manager, args: scriptArgs(name), reason: `package.json script “${name}”` });
    };
    addScript("targeted-tests", ["test:related", "test:unit", "test"]);
    addScript("typecheck", ["check", "typecheck", "type-check"]);
    addScript("lint", ["lint"]);
    addScript("build", ["build"]);

    if (!Object.keys(scripts).length) {
      if (snapshot.files.includes("pyproject.toml") || snapshot.files.includes("pytest.ini")) {
        commands.push({ purpose: "tests", command: "pytest", args: ["-q"], reason: "Python test configuration detected" });
      } else if (snapshot.files.includes("Cargo.toml")) {
        commands.push({ purpose: "tests", command: "cargo", args: ["test"], reason: "Cargo project detected" });
      } else if (snapshot.files.includes("go.mod")) {
        commands.push({ purpose: "tests", command: "go", args: ["test", "./..."], reason: "Go module detected" });
      }
    }

    const changed = changedPaths.map(normalizeRelative).slice(0, 100);
    const relatedTests = changed.flatMap((changedPath) => snapshot.sourceFiles
      .filter((file) => file.test && (
        file.path.toLowerCase().includes(fileStem(changedPath).toLowerCase())
        || file.imports.some((entry) => importMayReference(entry, changedPath))
      ))
      .map((file) => file.path));
    return JSON.stringify({
      frameworks: snapshot.frameworks,
      changed,
      relatedTests: [...new Set(relatedTests)].slice(0, 100),
      commands,
      guidance: "Run the narrowest relevant command first, then typecheck/lint, and expand to the full suite when risk or failures justify it. Every command still requires normal local approval."
    });
  }

  public invalidate(): void {
    this.snapshot = undefined;
  }

  public dispose(): void {
    this.watcher.dispose();
    this.snapshot = undefined;
  }

  private current(): Promise<ProjectSnapshot> {
    this.snapshot ??= this.build();
    return this.snapshot;
  }

  private async build(): Promise<ProjectSnapshot> {
    const root = vscode.Uri.file(this.workspaceRoot);
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, "**/*"),
      EXCLUSIONS,
      MAX_FILES
    );
    const files = uris
      .map((uri) => normalizeRelative(path.relative(this.workspaceRoot, uri.fsPath)))
      .filter((file) => !isSensitiveWorkspacePath(file))
      .sort();
    const sourceUris = uris.filter((uri) => {
      const relative = normalizeRelative(path.relative(this.workspaceRoot, uri.fsPath));
      return SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase()) && !isSensitiveWorkspacePath(relative);
    }).slice(0, MAX_GRAPH_FILES);
    const sourceFiles: IndexedFile[] = [];
    for (const uri of sourceUris) {
      const relative = normalizeRelative(path.relative(this.workspaceRoot, uri.fsPath));
      try {
        const metadata = await vscode.workspace.fs.stat(uri);
        if (metadata.size > MAX_SOURCE_BYTES) continue;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
        sourceFiles.push({ path: relative, imports: extractImports(text).slice(0, 100), test: TEST_PATTERN.test(relative) });
      } catch {
        // Unreadable, binary, or concurrently removed files stay out of the structural graph.
      }
    }
    const packageJson = files.includes("package.json") ? await readJson(vscode.Uri.joinPath(root, "package.json")) : undefined;
    const scripts = stringRecord(packageJson?.scripts);
    const dependencies = { ...stringRecord(packageJson?.dependencies), ...stringRecord(packageJson?.devDependencies) };
    const frameworks = detectFrameworks(files, dependencies);
    return {
      generatedAt: Date.now(),
      files,
      sourceFiles,
      scripts,
      frameworks,
      truncated: uris.length === MAX_FILES || sourceUris.length === MAX_GRAPH_FILES
    };
  }
}

function extractImports(text: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*from\s+([\w.]+)\s+import\s+/gm,
    /^\s*import\s+([\w.]+)(?:\s|$)/gm,
    /^\s*use\s+([\w:]+)(?:;|\s)/gm
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) if (match[1]) imports.add(match[1]);
  }
  return [...imports];
}

function importMayReference(importPath: string, focusPath: string): boolean {
  const normalizedImport = importPath.replaceAll(".", "/").replace(/^\.\//, "").toLowerCase();
  const normalizedFocus = normalizeRelative(focusPath).replace(/\.[^.]+$/, "").toLowerCase();
  const stem = fileStem(focusPath).toLowerCase();
  return normalizedImport === normalizedFocus
    || normalizedImport.endsWith(`/${stem}`)
    || normalizedImport === stem;
}

function detectFrameworks(files: string[], dependencies: Record<string, string>): string[] {
  const detected = new Set<string>();
  const dependencyNames = new Set(Object.keys(dependencies));
  for (const [name, packages] of Object.entries({
    React: ["react"], Next: ["next"], Vue: ["vue"], Angular: ["@angular/core"], Svelte: ["svelte"],
    Vitest: ["vitest"], Jest: ["jest"], Playwright: ["@playwright/test"], Cypress: ["cypress"],
    TypeScript: ["typescript"]
  })) if (packages.some((item) => dependencyNames.has(item))) detected.add(name);
  if (files.includes("pyproject.toml")) detected.add("Python");
  if (files.includes("pytest.ini") || files.some((file) => file.endsWith("conftest.py"))) detected.add("Pytest");
  if (files.includes("Cargo.toml")) detected.add("Rust/Cargo");
  if (files.includes("go.mod")) detected.add("Go");
  if (files.some((file) => file.endsWith(".sln") || file.endsWith(".csproj"))) detected.add(".NET");
  return [...detected];
}

function directoryCounts(files: string[]): Array<{ path: string; files: number }> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const directory = path.posix.dirname(file);
    const top = directory === "." ? "." : directory.split("/").slice(0, 2).join("/");
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts].map(([pathName, count]) => ({ path: pathName, files: count }))
    .sort((left, right) => right.files - left.files || left.path.localeCompare(right.path));
}

function fileStem(file: string): string {
  return path.basename(file).replace(/(?:\.test|\.spec|_test)?\.[^.]+$/i, "");
}

function normalizeRelative(file: string): string {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

async function readJson(uri: vscode.Uri): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === "string" ? [[key, entry]] : []));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
