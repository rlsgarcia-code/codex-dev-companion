# Project memory

Durable facts, decisions, conventions, and follow-ups for the development agent.

- 2026-10-13: This product is a VS Code extension built on the official `@openai/codex-sdk` package.
- 2026-10-13: Keep the Codex runtime sandboxed to `workspace-write`, with network access disabled by default.
- 2026-10-13: Project memory is transparent Markdown in `.codex-agent/memory.md`; never store secrets or raw transcripts.
- 2026-10-13: The interface uses a restrained timeline, one chartreuse accent, and native VS Code theme variables.
- 2026-10-13: The product must run entirely on the user's machine; the only permitted external request path is the configured Azure OpenAI Responses API endpoint. ChatGPT/OpenAI login and hosted tools are not allowed.
