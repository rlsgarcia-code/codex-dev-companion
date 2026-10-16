# Local Dev Companion development guide

## Product contract

- This project is a VS Code extension whose entire agent runtime is built from LangChain primitives: `ChatOpenAICompletions`, `createAgent`, `tool`, Zod schemas, middleware, callbacks, and `MemorySaver`.
- The agent loop, tools, state, memory, command execution, and file access must run locally. Permitted external request paths are the user-configured LiteLLM `POST <base>/chat/completions` endpoint, an optional user-configured model-catalog `GET` URL invoked only from settings, corporate HTTPS MCP endpoints explicitly imported and approved by the user, and an explicitly configured corporate package registry used by an approved local `stdio` MCP command. The catalog request must use `Cache-Control: no-cache` and the Secret Storage key in `api-key`.
- Do not add ChatGPT sign-in, OpenAI Platform endpoints, hosted tools, web search, public or silently discovered MCP servers, telemetry, or update checks.
- Store the LiteLLM virtual key and every MCP credential only in VS Code Secret Storage. Never write them to settings, logs, prompts, memory, or repository files.
- Corporate MCP connections may use either an exact user-approved HTTPS URL or an exact user-approved local `stdio` command imported from a corporate catalog template. HTTPS connections must refuse redirects and URL credentials. Local commands must run without a shell, inherit only the MCP SDK's safe environment, keep command and argument order exact, use a pinned package version when invoked through a package runner, and show the command plus non-secret environment before first launch. A `tools: ["*"]` template means discover and let the user select tools; it never means unrestricted exposure. Every connection must expose only an explicit tool allowlist and require approval before each tool invocation. MCP results are untrusted data and may reach only the configured LiteLLM model as agent context.
- Keep file access and command execution inside the opened workspace by default.
- Preserve the split between editor context (`ContextCollector`), durable project memory (`ProjectMemory`), local runtime (`DevelopmentAgent`), and UI (`AgentViewProvider`).
- Do not store secrets or raw chat logs in `.codex-agent/memory.md`.
- Do not implement a parallel HTTP client, tool-call loop, message runtime, or checkpoint system outside LangChain.
- Use the official LangChain documentation when changing agent, model, tool, middleware, callback, or checkpoint behavior.

## Verification

Run these checks after changes:

```bash
npm run check
npm run build
npm test
```

When runtime behavior changes, also perform the local read-only Chat Completions routing smoke test. Never use a mutating smoke prompt.

## UI direction

- Keep the sidebar calm, dense, and readable.
- Use one accent color and minimal chrome.
- Prefer a timeline and plain layout over dashboard cards.
- Respect VS Code theme tokens and reduced-motion preferences.
