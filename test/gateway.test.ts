import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions, OpenAIEmbeddings } from "@langchain/openai";
import {
  gatewayFetch,
  type GatewayTransport,
  validateGatewayRequest
} from "../src/gateway";

const CHAT_URL = "https://gateway.example.com/team/chat/completions";
const EMBEDDINGS_URL = "https://gateway.example.com/team/embeddings";

test("allows only POST requests to the exact configured LiteLLM route", () => {
  assert.doesNotThrow(() => validateGatewayRequest(CHAT_URL, { method: "POST" }, CHAT_URL));
  assert.throws(
    () => validateGatewayRequest("https://gateway.example.com/team/embeddings", { method: "POST" }, CHAT_URL),
    /outside the configured LiteLLM route/
  );
  assert.throws(
    () => validateGatewayRequest("https://other.example.com/team/chat/completions", { method: "POST" }, CHAT_URL),
    /outside the configured LiteLLM route/
  );
  assert.throws(
    () => validateGatewayRequest(`${CHAT_URL}?token=secret`, { method: "POST" }, CHAT_URL),
    /outside the configured LiteLLM route/
  );
  assert.throws(
    () => validateGatewayRequest(CHAT_URL, { method: "GET" }, CHAT_URL),
    /non-POST request/
  );
});

test("handles redirects manually and preserves only the intended gateway authentication header", async () => {
  let observed: { input?: RequestInfo | URL; init?: RequestInit & { dispatcher?: unknown } } = {};
  const transport: GatewayTransport = async (input, init) => {
    observed = { input, init };
    return new Response(null, { status: 204 });
  };
  const fetch = gatewayFetch(CHAT_URL, true, undefined, undefined, transport);
  await fetch(CHAT_URL, {
    method: "POST",
    redirect: "follow",
    headers: {
      authorization: "Bearer placeholder",
      "api-key": "corporate-placeholder"
    }
  });

  assert.equal(observed.input, CHAT_URL);
  assert.equal(observed.init?.redirect, "manual");
  const headers = new Headers(observed.init?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.get("api-key"), "corporate-placeholder");
});

test("turns a gateway redirect into an actionable failure without following it", async () => {
  let requestCount = 0;
  const transport: GatewayTransport = async () => {
    requestCount += 1;
    return new Response(null, {
      status: 307,
      headers: { location: "https://unconfigured.example.com/chat/completions" }
    });
  };
  const fetch = gatewayFetch(CHAT_URL, false, undefined, undefined, transport);
  await assert.rejects(
    fetch(CHAT_URL, { method: "POST" }),
    /Configure its final HTTPS URL; redirects are disabled/
  );
  assert.equal(requestCount, 1);
});

test("blocks an unexpected route before invoking the network transport", async () => {
  let called = false;
  const transport: GatewayTransport = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };
  const fetch = gatewayFetch(CHAT_URL, false, undefined, undefined, transport);
  await assert.rejects(
    fetch("https://api.openai.com/v1/chat/completions", { method: "POST" }),
    /outside the configured LiteLLM route/
  );
  assert.equal(called, false);
});

test("routes a real LangChain Chat Completions invocation through the guarded transport", async () => {
  let requestCount = 0;
  const transport: GatewayTransport = async (input, init) => {
    requestCount += 1;
    assert.equal(input.toString(), CHAT_URL);
    assert.equal(init?.method?.toUpperCase(), "POST");
    assert.equal(init?.redirect, "manual");
    return new Response(JSON.stringify({
      id: "chatcmpl-local-gate",
      object: "chat.completion",
      created: 1,
      model: "corporate-alias",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "guarded-ok" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const model = new ChatOpenAICompletions({
    model: "corporate-alias",
    apiKey: "placeholder",
    maxRetries: 0,
    configuration: {
      baseURL: "https://gateway.example.com/team",
      fetch: gatewayFetch(CHAT_URL, false, undefined, undefined, transport)
    }
  });

  const response = await model.invoke([new HumanMessage("Read-only routing probe")]);
  assert.equal(response.text, "guarded-ok");
  assert.equal(requestCount, 1);
});

test("routes a real LangChain embeddings invocation only to the derived embeddings route", async () => {
  let requestCount = 0;
  const transport: GatewayTransport = async (input, init) => {
    requestCount += 1;
    assert.equal(input.toString(), EMBEDDINGS_URL);
    assert.equal(init?.method?.toUpperCase(), "POST");
    assert.equal(init?.redirect, "manual");
    return new Response(JSON.stringify({
      object: "list",
      data: [{ object: "embedding", embedding: [0.25, 0.75], index: 0 }],
      model: "corporate-embedding-alias",
      usage: { prompt_tokens: 1, total_tokens: 1 }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const embeddings = new OpenAIEmbeddings({
    model: "corporate-embedding-alias",
    apiKey: "placeholder",
    maxRetries: 0,
    configuration: {
      baseURL: "https://gateway.example.com/team",
      fetch: gatewayFetch(EMBEDDINGS_URL, false, undefined, undefined, transport)
    }
  });

  assert.deepEqual(await embeddings.embedQuery("Read-only routing probe"), [0.25, 0.75]);
  assert.equal(requestCount, 1);
});
