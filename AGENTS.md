# Codex Dev Companion development guide

## Product contract

- This project is a VS Code extension backed by the official OpenAI Codex SDK.
- The harness, tools, state, memory, shell, and file access must run locally. The only permitted external request path is the user-configured LiteLLM Responses API endpoint.
- Do not add ChatGPT sign-in, OpenAI Platform endpoints, hosted tools, web search, external MCP servers, telemetry, or update checks.
- Store the LiteLLM virtual key only in VS Code Secret Storage. Never write it to settings, logs, prompts, or repository files.
- Keep file access and command execution inside the opened workspace by default.
- Preserve the split between editor context (`ContextCollector`), durable project memory (`ProjectMemory`), Codex runtime (`DevelopmentAgent`), and UI (`AgentViewProvider`).
- Do not store secrets or raw chat logs in `.codex-agent/memory.md`.
- Use the official OpenAI documentation when changing Codex SDK or app-server behavior.

## Verification

Run these checks after changes:

```bash
npm run check
npm run build
npm test
```

When runtime behavior changes, also perform a read-only Codex SDK smoke test. Never use a mutating smoke prompt.

## UI direction

- Keep the sidebar calm, dense, and readable.
- Use one accent color and minimal chrome.
- Prefer a timeline and plain layout over dashboard cards.
- Respect VS Code theme tokens and reduced-motion preferences.
