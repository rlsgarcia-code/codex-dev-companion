import type { ConnectionDiagnosticFix } from "./connection-remediation";
import type { CompletionReview } from "./completion-review";
import type { RunOutcome } from "./completion-notification";
import type { ProjectGuidanceDocument } from "./project-guidance";
import type { RunEvidenceSnapshot } from "./run-evidence";

export type RunMode = "review" | "execute" | "plan";
export type AgentRuntime = "standard" | "deep";

export type RunPreflightResult =
  | { ready: true }
  | {
      ready: false;
      kind: "workspace" | "busy" | "connection" | "model" | "certificate";
      message: string;
      openConnectionSettings: boolean;
    };

export type ConnectionDiagnostic = {
  id: "configuration" | "catalog" | "chat" | "embeddings";
  label: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
  durationMs?: number;
  fixes?: ConnectionDiagnosticFix[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  html?: string;
  createdAt: number;
};

export type PinnedContextSource = {
  id: string;
  filename: string;
  range: string;
  kind: "selection" | "file";
  characters: number;
  estimatedTokens: number;
};

export type AgentContextReceipt = {
  automaticContextEnabled: boolean;
  activeFile?: string;
  guidanceFiles: string[];
  pinnedSources: Array<Pick<PinnedContextSource, "filename" | "range" | "kind">>;
  diagnostics: number;
  openFiles: number;
  projectFiles: number;
  estimatedTokens: number;
  utilizationPercent: number;
  truncated: boolean;
  memory: {
    mode: "recent" | "semantic";
    recalledChunks: number;
    estimatedTokens: number;
    fallback: boolean;
    references: string[];
  };
};

export type RunFileChange = {
  id: string;
  path: string;
  kind: "created" | "modified" | "deleted";
  restored: boolean;
};

export type ContextSnapshot = {
  automaticContextEnabled: boolean;
  workspaceName: string;
  workspaceRoots: string[];
  activeFile?: string;
  language?: string;
  cursor?: string;
  selection?: string;
  diagnostics: string[];
  openFiles: string[];
  projectFiles: string[];
  projectGuidance: ProjectGuidanceDocument[];
  pinnedContext: string[];
  pinnedSources: PinnedContextSource[];
};

export type AgentUiEvent =
  | { type: "thread"; threadId: string }
  | { type: "status"; label: string }
  | { type: "plan"; items: Array<{ text: string; completed: boolean }> }
  | { type: "activity"; kind: string; title: string; detail?: string }
  | { type: "changes"; items: RunFileChange[]; omitted: number }
  | { type: "evidence"; evidence: RunEvidenceSnapshot }
  | { type: "verification"; review: CompletionReview }
  | { type: "contextReceipt"; receipt: AgentContextReceipt }
  | { type: "assistant"; text: string }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string; recoverable?: boolean }
  | { type: "done"; outcome: RunOutcome };
