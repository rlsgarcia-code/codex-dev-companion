import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "local-test-mcp", version: "1.0.0" }
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{
        name: "echo_read_only",
        description: "Returns a local test value",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    reply(message.id, { content: [{ type: "text", text: "local stdio ok" }] });
    return;
  }
  replyError(message.id, -32601, `Unsupported method: ${message.method}`);
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
