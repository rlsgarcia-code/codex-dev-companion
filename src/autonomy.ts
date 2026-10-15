import type { RunMode } from "./types";

export type LocalMutationKind = "file-write" | "file-delete" | "command" | "memory";
export type LocalMutationRisk = "standard" | "destructive";

export function isRunMode(value: unknown): value is RunMode {
  return value === "review" || value === "execute" || value === "plan";
}

export function parseRunMode(value: unknown, fallback: RunMode = "review"): RunMode {
  return isRunMode(value) ? value : fallback;
}

export function runModeLabel(mode: RunMode): string {
  switch (mode) {
    case "review": return "Ask first";
    case "execute": return "Auto edits";
    case "plan": return "Plan only";
  }
}

export function requiresLocalApproval(
  mode: RunMode,
  kind: LocalMutationKind,
  risk: LocalMutationRisk = "standard"
): boolean {
  if (mode === "plan") return true;
  if (kind === "command" || kind === "file-delete" || risk === "destructive") return true;
  return mode === "review";
}
