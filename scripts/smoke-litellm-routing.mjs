import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import liteLlmModule from "../dist-tests/src/litellm.js";

const { buildLiteLlmCodexConfig } = liteLlmModule;
const codexHome = mkdtempSync(join(tmpdir(), "codex-dev-companion-smoke-"));
const requests = [];
const server = createServer((request, response) => {
  requests.push({ url: request.url, headers: request.headers, method: request.method });
  request.resume();
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: "Expected smoke-test stop" } }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");

try {
  const connection = {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    model: "smoke-model-alias",
    apiKey: "litellm-smoke-key"
  };
  const providerConfig = buildLiteLlmCodexConfig(connection);
  const codex = new Codex({
    env: {
      HOME: process.env.HOME ?? codexHome,
      PATH: process.env.PATH ?? "",
      CODEX_HOME: codexHome,
      LITELLM_API_KEY: connection.apiKey
    },
    config: {
      ...providerConfig,
      model_providers: {
        litellm: {
          ...providerConfig.model_providers.litellm,
          request_max_retries: 0,
          stream_max_retries: 0
        }
      }
    }
  });
  const thread = codex.startThread({
    model: connection.model,
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    modelReasoningEffort: "low"
  });
  await assert.rejects(thread.run("Read-only routing smoke test. Do not use tools."));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/responses");
  assert.equal(requests[0].headers.authorization, "Bearer litellm-smoke-key");
  assert.equal(requests[0].headers["api-key"], undefined);
  console.log("LITELLM_LOCAL_ROUTING_OK");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(codexHome, { recursive: true, force: true });
}
