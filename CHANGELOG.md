# Changelog

## 0.9.2

- Added one-time corporate CA PEM import into the extension's global local storage so every workspace in the same VS Code profile and environment can reuse it.
- Automatically migrates a previously configured workspace PEM after its first successful local read.
- Added setup controls to keep, replace, or remove the imported CA and clearer guidance for generic TLS connection errors.

## 0.9.1

- Docked the live agent status and current plan directly above the composer so they remain visible at the active end of long conversations.
- Made the conversation timeline independently scrollable and bounded long plans and settings panels to the available sidebar height.
- Clear the previous plan when a new request is sent and keep the newest conversation activity in view as the plan changes.

## 0.9.0

- Added documented GPT and Claude compatibility presets with model-aware reasoning, tool-calling, and sampling validation.
- Added optional `top_p` configuration and the `max` reasoning effort while retaining a custom gateway-defined profile.
- Added an optional user-configured model catalog URL loaded with `Cache-Control: no-cache` and the Secret Storage key in `api-key`.
- Added a model picker that applies and remembers distinct capabilities for each exact LiteLLM alias.

## 0.8.2

- Added model-specific Chat Completions profiles for optional `reasoning_effort` and `temperature` values.
- Omit both parameters by default instead of inferring capabilities from a model name or forcing `temperature: 0`.
- Added sidebar and setup-wizard controls that remember distinct capabilities for each exact LiteLLM model alias.
- Added regression coverage for an explicitly configured `gpt-6-luna` tool call with `reasoning_effort: "none"` and no temperature.

## 0.8.1

- Added selectable gateway authentication headers: `Authorization: Bearer`, `api-key`, and `Ocp-Apim-Subscription-Key`.
- Kept the API/subscription key exclusively in VS Code Secret Storage while supporting Azure-compatible corporate gateways.
- Added header-mapping tests and local routing coverage for Azure API Management subscription-key authentication.

## 0.8.0

- Added a workspace-level choice between the focused `createAgent` runtime and the advanced `createDeepAgent` runtime.
- Added the runtime selector directly to the sidebar composer and to the first step of the setup wizard.
- Restricted Deep Agent filesystem access to the opened workspace and made its built-in filesystem tools read-only in Plan mode.
- Kept command execution behind the existing local confirmation flow and kept both runtimes on the same LiteLLM Chat Completions client.
- Added read-only local routing smoke coverage for both runtimes.

## 0.7.0

- Rebuilt the complete agent runtime with LangChain primitives: `ChatOpenAICompletions`, `createAgent`, `tool`, Zod schemas, callbacks, middleware, and `MemorySaver`.
- Removed the custom HTTP/SSE client, hand-written tool-call loop, and custom model-message/tool definitions.
- Forced Chat Completions routing through the LangChain OpenAI integration and kept optional corporate CA support through its configured transport.
- Added LangChain context-window middleware, checkpointed thread state, and per-run token-usage callbacks.
- Explicitly disabled LangSmith/LangChain external tracing so LiteLLM remains the only external request destination.

## 0.6.0

- Replaced the Codex SDK runtime with a custom local agent loop over LiteLLM Chat Completions.
- Added local function tools for workspace search, bounded file reads, exact edits, file creation, planning, project memory, and approved command execution.
- Added streamed Chat Completions parsing, including fragmented tool calls, usage, cancellation, and non-streaming fallback.
- Persist recent user/assistant context locally with bounded conversation compaction.
- Removed Responses API, Codex model catalogs, Codex binaries, and the `@openai/codex-sdk` dependency.
- Kept the LiteLLM virtual key exclusively in VS Code Secret Storage and corporate CA support inside the workspace.

## 0.5.0

- Replaced the Azure-specific provider with a LiteLLM Responses gateway provider.
- Added setup for HTTPS `/v1` base URL, model alias, scoped virtual key, optional CA PEM, and model catalog.
- Send the LiteLLM virtual key as a Bearer token from VS Code Secret Storage.
- Removed Azure deployment ID, API version, Azure hostname checks, and `api-key` header configuration.

## 0.2.4

- Added workspace-scoped corporate CA PEM selection for Azure gateways.
- Pass the selected certificate to the local Codex runtime through `CODEX_CA_CERTIFICATE`.
- Reject certificate paths and symbolic links that resolve outside the opened workspace.

## 0.2.3

- Added explicit support for HTTPS corporate gateways that route to Azure OpenAI.
- Preserve gateway API paths and send Azure credentials through the `api-key` header.
- Require a modal confirmation before trusting a non-Azure hostname.

## 0.2.2

- Aligned Azure setup labels with existing `AzureChatOpenAI` values: OpenAI API Base, Deployment ID, API Version, and API Key.
- Reject deployment-specific URLs so Codex can construct the Azure Responses route correctly.

## 0.2.1

- Turned Azure configuration into an explicit four-step flow with inline validation.
- Added clear cancellation feedback and support for retaining an existing secret key.

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
