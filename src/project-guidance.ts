import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";

const MAX_GUIDANCE_FILE_BYTES = 512_000;
const MAX_GUIDANCE_FILE_CHARACTERS = 6_000;
const MAX_GUIDANCE_CHARACTERS = 16_000;

export type ProjectGuidanceDocument = {
  path: string;
  content: string;
  truncated: boolean;
  scope: "workspace" | "active-file";
};

type GuidanceCandidate = {
  absolutePath: string;
  displayPath: string;
  scope: ProjectGuidanceDocument["scope"];
};

/**
 * Loads a small, deterministic set of repository guidance files. More-specific
 * AGENTS.md files are returned before workspace-level background documents so
 * they survive context truncation first.
 */
export async function collectProjectGuidance(
  workspaceRoots: readonly string[],
  activeFile?: string
): Promise<ProjectGuidanceDocument[]> {
  const candidates = guidanceCandidates(workspaceRoots, activeFile);
  const documents: ProjectGuidanceDocument[] = [];
  const visited = new Set<string>();
  let remaining = MAX_GUIDANCE_CHARACTERS;

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const root = workspaceRoots.find((workspaceRoot) => isPathInside(workspaceRoot, candidate.absolutePath));
    if (!root) continue;

    try {
      const [realRoot, realCandidate] = await Promise.all([
        realpath(root),
        realpath(candidate.absolutePath)
      ]);
      if (!isPathInside(realRoot, realCandidate) || visited.has(realCandidate)) continue;
      const fileStat = await stat(realCandidate);
      if (!fileStat.isFile() || fileStat.size > MAX_GUIDANCE_FILE_BYTES) continue;
      const buffer = await readFile(realCandidate);
      if (buffer.includes(0)) continue;
      const fullText = buffer.toString("utf8").trim();
      if (!fullText) continue;
      const maximum = Math.min(MAX_GUIDANCE_FILE_CHARACTERS, remaining);
      const content = fullText.slice(0, maximum);
      documents.push({
        path: candidate.displayPath,
        content,
        truncated: content.length < fullText.length,
        scope: candidate.scope
      });
      visited.add(realCandidate);
      remaining -= content.length;
    } catch {
      // Missing, unreadable, or concurrently removed guidance is simply absent.
    }
  }

  return documents;
}

export function guidanceCandidates(
  workspaceRoots: readonly string[],
  activeFile?: string
): GuidanceCandidate[] {
  const candidates: GuidanceCandidate[] = [];
  const multipleRoots = workspaceRoots.length > 1;

  for (const root of workspaceRoots) {
    const prefix = multipleRoots ? `${path.basename(root)}/` : "";
    if (activeFile && isPathInside(root, activeFile)) {
      const relativeDirectory = path.relative(root, path.dirname(activeFile));
      const directories = relativeDirectory && relativeDirectory !== "."
        ? relativeDirectory.split(path.sep).filter(Boolean)
        : [];
      for (let depth = directories.length; depth >= 1; depth -= 1) {
        const relativePath = path.join(...directories.slice(0, depth), "AGENTS.md");
        candidates.push({
          absolutePath: path.join(root, relativePath),
          displayPath: `${prefix}${relativePath.replaceAll(path.sep, "/")}`,
          scope: "active-file"
        });
      }
    }

    for (const relativePath of [
      "AGENTS.md",
      path.join(".github", "copilot-instructions.md"),
      "CONTRIBUTING.md",
      "README.md"
    ]) {
      candidates.push({
        absolutePath: path.join(root, relativePath),
        displayPath: `${prefix}${relativePath.replaceAll(path.sep, "/")}`,
        scope: "workspace"
      });
    }
  }

  return candidates;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
