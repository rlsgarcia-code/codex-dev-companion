import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import azureModule from "../dist-tests/src/azure.js";

const { buildAzureCodexConfig } = azureModule;

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
  const codex = new Codex({
    env: {
      HOME: process.env.HOME ?? codexHome,
      PATH: process.env.PATH ?? "",
      CODEX_HOME: codexHome,
      AZURE_OPENAI_API_KEY: "azure-smoke-key"
    },
    config: {
      ...buildAzureCodexConfig({
        endpoint: `http://127.0.0.1:${address.port}/openai`,
        deployment: "smoke-deployment",
        apiVersion: "smoke-version",
        apiKey: "azure-smoke-key"
      }),
      model_providers: {
        azure: {
          ...buildAzureCodexConfig({
            endpoint: `http://127.0.0.1:${address.port}/openai`,
            deployment: "smoke-deployment",
            apiVersion: "smoke-version",
            apiKey: "azure-smoke-key"
          }).model_providers.azure,
          request_max_retries: 0,
          stream_max_retries: 0
        }
      }
    }
  });
  const thread = codex.startThread({
    model: "smoke-deployment",
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
  assert.equal(requests[0].url, "/openai/responses?api-version=smoke-version");
  assert.equal(requests[0].headers["api-key"], "azure-smoke-key");
  assert.equal(requests[0].headers.authorization, undefined);
  console.log("AZURE_LOCAL_ROUTING_OK");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(codexHome, { recursive: true, force: true });
}
