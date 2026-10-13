# Changelog

## 0.2.0

- Enforced a fully local Codex runtime with Azure OpenAI as the only external model endpoint.
- Added isolated `CODEX_HOME` state and a minimal environment allowlist.
- Added secure Azure API-key storage through VS Code Secret Storage.
- Disabled hosted web search, runtime update checks, and network access for agent shell commands.
- Added Azure provider validation and unit tests.

## 0.1.0

- Initial VS Code sidebar experience.
- Codex SDK thread start, streaming, resume, and cancellation.
- Automatic editor context and pinned selections.
- Project memory in `.codex-agent/memory.md`.
- Plan, command, file-change, tool, and usage events.
