import type { AgentRuntime } from "./types";

export const DEFAULT_AGENT_RUNTIME: AgentRuntime = "standard";

export function parseAgentRuntime(value: unknown): AgentRuntime {
  return value === "deep" ? "deep" : DEFAULT_AGENT_RUNTIME;
}

export function agentRuntimeLabel(runtime: AgentRuntime): string {
  return runtime === "deep" ? "Deep Agent" : "LangChain Agent";
}
