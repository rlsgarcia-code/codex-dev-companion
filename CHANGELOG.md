# Changelog

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
