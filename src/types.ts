export type RunMode = "execute" | "plan";
export type AgentRuntime = "standard" | "deep";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
};

export type ContextSnapshot = {
  workspaceName: string;
  workspaceRoots: string[];
  activeFile?: string;
  language?: string;
  cursor?: string;
  selection?: string;
  diagnostics: string[];
  openFiles: string[];
  projectFiles: string[];
  pinnedContext: string[];
};

export type AgentUiEvent =
  | { type: "thread"; threadId: string }
  | { type: "status"; label: string }
  | { type: "plan"; items: Array<{ text: string; completed: boolean }> }
  | { type: "activity"; kind: string; title: string; detail?: string }
  | { type: "assistant"; text: string }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string }
  | { type: "done" };
