import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { redactSensitiveText, safeErrorMessage } from "./redaction";

export type StdioMcpClientOptions = {
  command: string;
  args: string[];
  env: Record<string, string>;
  workspace: string;
  signal?: AbortSignal;
  caCertificatePath?: string;
  sensitiveValues: readonly string[];
};

export async function connectStdioMcpClient(options: StdioMcpClientOptions): Promise<Client> {
  const client = new Client({ name: "local-dev-companion", version: "0.11.0" });
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    env: {
      ...options.env,
      ...(options.caCertificatePath ? {
        NODE_EXTRA_CA_CERTS: options.caCertificatePath,
        npm_config_cafile: options.caCertificatePath
      } : {})
    },
    cwd: options.workspace,
    stderr: "pipe",
    maxBufferSize: 10 * 1024 * 1024
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 8_000) stderr += String(chunk).slice(0, 8_000 - stderr.length);
  });
  try {
    await client.connect(transport, { signal: options.signal, timeout: 120_000 });
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    const detail = stderr.trim()
      ? `\nLocal MCP output: ${redactSensitiveText(stderr, options.sensitiveValues).slice(0, 2_000)}`
      : "";
    throw new Error(`${safeErrorMessage(error, options.sensitiveValues)}${detail}`);
  }
}
