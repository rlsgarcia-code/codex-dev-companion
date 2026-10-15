import assert from "node:assert/strict";
import test from "node:test";
import { mcpFetch, validateMcpRequest } from "../src/mcp-transport";

const MCP_URL = "https://api.example.test/ia/mcp/workspace/mcp";

test("MCP transport sends only protocol methods to the exact configured route", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response("ok", { status: 200 });
  };
  const fetch = mcpFetch(MCP_URL, undefined, undefined, transport);
  await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: "Bearer secret", apikey: "subscription" }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, MCP_URL);
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer secret");
  assert.doesNotThrow(() => validateMcpRequest(MCP_URL, { method: "GET" }, MCP_URL));
  assert.doesNotThrow(() => validateMcpRequest(MCP_URL, { method: "DELETE" }, MCP_URL));
});

test("MCP transport blocks route changes, query injection, unsupported methods, and redirects", async () => {
  assert.throws(() => validateMcpRequest("https://other.example.test/mcp", { method: "POST" }, MCP_URL), /outside/);
  assert.throws(() => validateMcpRequest(`${MCP_URL}?token=x`, { method: "POST" }, MCP_URL), /outside/);
  assert.throws(() => validateMcpRequest(MCP_URL, { method: "PUT" }, MCP_URL), /unsupported HTTP method/);
  const fetch = mcpFetch(MCP_URL, undefined, undefined, async () => new Response(null, {
    status: 307,
    headers: { location: "https://other.example.test/mcp" }
  }));
  await assert.rejects(fetch(MCP_URL, { method: "POST" }), /redirects are disabled/);
});
