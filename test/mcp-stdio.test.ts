import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { connectStdioMcpClient } from "../src/mcp-stdio";

test("the pinned MCP SDK starts stdio servers without a shell and with a bounded inherited environment", () => {
  const sdkTransport = readFileSync("node_modules/@modelcontextprotocol/client/dist/stdio.mjs", "utf8");
  assert.match(sdkTransport, /shell: false/);
  assert.match(sdkTransport, /\.\.\.getDefaultEnvironment\(\)/);
  assert.match(sdkTransport, /windowsHide: process\.platform === "win32"/);
});

test("starts, discovers, invokes, and closes an exact local stdio MCP process", async () => {
  const client = await connectStdioMcpClient({
    command: process.execPath,
    args: [path.resolve("test/fixtures/mcp-stdio-server.mjs")],
    env: { LOCAL_MCP_TEST: "1" },
    workspace: process.cwd(),
    sensitiveValues: []
  });
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name), ["echo_read_only"]);
    const result = await client.callTool({ name: "echo_read_only", arguments: {} });
    assert.deepEqual(result.content, [{ type: "text", text: "local stdio ok" }]);
  } finally {
    await client.close();
  }
});
