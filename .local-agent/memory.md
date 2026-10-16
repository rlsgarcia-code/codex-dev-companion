# Project memory

Durable facts, decisions, conventions, and follow-ups for the workspace agent.

- 2026-10-13: This product is a VS Code extension whose local agent runtime is built from LangChain and LangGraph primitives.
- 2026-10-13: Keep the Local Agent runtime sandboxed to the opened workspace, with network access limited to the configured provider and approved corporate MCP routes.
- 2026-10-13: Project memory is transparent Markdown in `.local-agent/memory.md`; never store secrets or raw transcripts.
- 2026-10-13: The interface uses a restrained timeline, one chartreuse accent, and native VS Code theme variables.
- 2026-10-13: The product must run entirely on the user's machine; model requests use the explicitly configured LiteLLM, Ollama, or OpenAI Chat Completions provider, and ChatGPT login and hosted tools are not allowed.
