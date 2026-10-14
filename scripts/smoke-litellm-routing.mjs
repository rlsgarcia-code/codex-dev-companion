import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { createAgent, tool } from "langchain";
import { z } from "zod";

process.env.LANGSMITH_TRACING = "false";
process.env.LANGSMITH_TRACING_V2 = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.LANGSMITH_OTEL_ENABLED = "false";
process.env.OTEL_ENABLED = "false";
delete process.env.LANGCHAIN_TRACING;

const requests = [];
const server = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    requests.push({ url: request.url, headers: request.headers, method: request.method, body });
    response.writeHead(200, { "content-type": "text/event-stream" });
    const common = {
      id: `chatcmpl-local-smoke-${requests.length}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "smoke-model-alias"
    };
    response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
    if (requests.length === 1) {
      response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_smoke", type: "function", function: { name: "read_marker", arguments: "{\"value\":\"safe\"}" } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
    } else {
      response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { content: "smoke-ok" }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    }
    response.write(`data: ${JSON.stringify({ ...common, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");

try {
  let localToolCalls = 0;
  const readMarker = tool(
    ({ value }) => {
      localToolCalls += 1;
      return JSON.stringify({ value, readOnly: true });
    },
    {
      name: "read_marker",
      description: "Read a fixed marker without mutating anything.",
      schema: z.object({ value: z.string() })
    }
  );
  const model = new ChatOpenAICompletions({
    model: "smoke-model-alias",
    apiKey: "litellm-smoke-key",
    streaming: true,
    streamUsage: true,
    maxRetries: 0,
    configuration: { baseURL: `http://127.0.0.1:${address.port}/v1` }
  });
  const agent = createAgent({
    model,
    tools: [readMarker],
    systemPrompt: "Read-only local routing smoke test."
  });
  const result = await agent.invoke({
    messages: [{ role: "user", content: "Read the safe marker, then reply with smoke-ok." }]
  });

  assert.equal(result.messages.at(-1)?.text, "smoke-ok");
  assert.equal(localToolCalls, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/chat/completions");
  assert.equal(requests[0].headers.authorization, "Bearer litellm-smoke-key");
  const firstPayload = JSON.parse(requests[0].body);
  const secondPayload = JSON.parse(requests[1].body);
  assert.equal(firstPayload.model, "smoke-model-alias");
  assert.equal(firstPayload.stream, true);
  assert.equal(firstPayload.messages.at(-1).content, "Read the safe marker, then reply with smoke-ok.");
  assert.equal(firstPayload.tools[0].function.name, "read_marker");
  assert.equal(secondPayload.messages.at(-1).role, "tool");
  assert.match(secondPayload.messages.at(-1).content, /readOnly/);

  const deepAgent = createDeepAgent({
    model,
    tools: [readMarker],
    systemPrompt: "Read-only Deep Agent local routing smoke test. Do not call tools."
  });
  const deepResult = await deepAgent.invoke({
    messages: [{ role: "user", content: "Reply with smoke-ok without changing anything." }]
  });
  assert.equal(deepResult.messages.at(-1)?.text, "smoke-ok");
  assert.equal(requests.length, 3);
  assert.equal(requests[2].method, "POST");
  assert.equal(requests[2].url, "/v1/chat/completions");
  assert.equal(requests[2].headers.authorization, "Bearer litellm-smoke-key");
  const deepPayload = JSON.parse(requests[2].body);
  assert.equal(deepPayload.model, "smoke-model-alias");
  assert.equal(deepPayload.stream, true);
  assert.ok(deepPayload.tools.some((entry) => entry.function.name === "read_file"));
  assert.ok(deepPayload.tools.some((entry) => entry.function.name === "task"));
  console.log("LANGCHAIN_AND_DEEPAGENT_LITELLM_CHAT_COMPLETIONS_LOCAL_ROUTING_OK");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
