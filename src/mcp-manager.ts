import type { StructuredToolInterface } from "@langchain/core/tools";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Agent as UndiciAgent } from "undici";
import * as vscode from "vscode";
import { requestLocalApproval } from "./local-approval";
import {
  mcpSecretStorageKey,
  type McpConnectionProfile,
  type McpConnectionSnapshot,
  normalizeMcpEndpoint,
  parseStoredMcpProfiles,
  safeMcpToolPrefix,
  validateMcpHeaderName,
  validateMcpHeaderValue
} from "./mcp-config";
import { mcpFetch } from "./mcp-transport";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import type { AgentUiEvent, RunMode } from "./types";

const MCP_PROFILES_KEY = "codexDevCompanion.mcpConnections.v1";

export type SaveMcpConnectionInput = {
  id?: string;
  name: string;
  url: string;
  enabled: boolean;
  headers: Record<string, string>;
  secrets: Record<string, string>;
  tools: string[];
};

export type McpConnectionTest = {
  profile: McpConnectionSnapshot;
  discoveredTools: string[];
  enabledTools: string[];
};

export type McpRunSession = {
  tools: StructuredToolInterface[];
  sensitiveValues: string[];
  close(): Promise<void>;
};

export class CorporateMcpManager {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async snapshots(): Promise<McpConnectionSnapshot[]> {
    const profiles = this.profiles();
    return Promise.all(profiles.map(async (profile) => ({
      ...profile,
      missingSecretHeaders: (await Promise.all(profile.secretHeaders.map(async (header) => ({
        header,
        present: Boolean(await this.context.secrets.get(mcpSecretStorageKey(profile.id, header)))
      })))).filter(({ present }) => !present).map(({ header }) => header)
    })));
  }

  public async save(input: SaveMcpConnectionInput): Promise<McpConnectionSnapshot> {
    const id = input.id ?? crypto.randomUUID();
    const profile: McpConnectionProfile = {
      id,
      name: input.name.trim().slice(0, 100),
      url: normalizeMcpEndpoint(input.url),
      enabled: input.enabled,
      headers: Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [
        validateMcpHeaderName(name),
        validateMcpHeaderValue(value)
      ]).filter(([, value]) => Boolean(value))),
      secretHeaders: [...new Set(Object.keys(input.secrets).map(validateMcpHeaderName))],
      tools: [...new Set(input.tools.map((tool) => tool.trim()).filter(Boolean))].slice(0, 200),
      updatedAt: Date.now()
    };
    if (!profile.name) throw new Error("MCP server name cannot be empty.");
    if (!profile.tools.length) throw new Error("Choose at least one MCP tool to expose to the agent.");

    const current = this.profiles();
    const previous = current.find((candidate) => candidate.id === id);
    const next = [profile, ...current.filter((candidate) => candidate.id !== id)].slice(0, 20);
    await this.context.workspaceState.update(MCP_PROFILES_KEY, next);
    await Promise.all(Object.entries(input.secrets).map(async ([header, secret]) => {
      const normalized = secret.trim();
      const key = mcpSecretStorageKey(id, header);
      if (normalized) await this.context.secrets.store(key, normalized);
    }));
    if (previous) {
      const removed = previous.secretHeaders.filter((header) => !profile.secretHeaders.some((nextHeader) => nextHeader.toLowerCase() === header.toLowerCase()));
      await Promise.all(removed.map((header) => this.context.secrets.delete(mcpSecretStorageKey(id, header))));
    }
    return (await this.snapshots()).find((candidate) => candidate.id === id)!;
  }

  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    const profiles = this.profiles();
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The MCP connection no longer exists.");
    profile.enabled = enabled;
    profile.updatedAt = Date.now();
    await this.context.workspaceState.update(MCP_PROFILES_KEY, profiles);
  }

  public async remove(id: string): Promise<void> {
    const profiles = this.profiles();
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    await this.context.workspaceState.update(MCP_PROFILES_KEY, profiles.filter((candidate) => candidate.id !== id));
    await Promise.all(profile.secretHeaders.map((header) => this.context.secrets.delete(mcpSecretStorageKey(id, header))));
  }

  public async test(id: string, dispatcher?: UndiciAgent, signal?: AbortSignal): Promise<McpConnectionTest> {
    const profile = (await this.snapshots()).find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The MCP connection no longer exists.");
    if (profile.missingSecretHeaders.length) {
      throw new Error(`Add the missing MCP credentials: ${profile.missingSecretHeaders.join(", ")}.`);
    }
    const resolved = await this.resolvedHeaders(profile);
    let client: Client;
    try {
      client = await this.connect(profile, resolved.headers, dispatcher, signal);
    } catch (error) {
      throw new Error(safeErrorMessage(error, resolved.sensitiveValues));
    }
    try {
      const discovered = (await client.listTools(undefined, { signal })).tools.map(({ name }) => name).sort();
      return {
        profile,
        discoveredTools: discovered,
        enabledTools: profile.tools.filter((tool) => discovered.includes(tool))
      };
    } catch (error) {
      throw new Error(safeErrorMessage(error, resolved.sensitiveValues));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  public async createRunSession(options: {
    mode: RunMode;
    dispatcher?: UndiciAgent;
    signal: AbortSignal;
    onEvent: (event: AgentUiEvent) => void;
    sensitiveValues: readonly string[];
  }): Promise<McpRunSession> {
    if (options.mode === "plan") return emptySession();
    const clients: Client[] = [];
    const tools: StructuredToolInterface[] = [];
    const sensitiveValues: string[] = [];
    for (const profile of (await this.snapshots()).filter((candidate) => candidate.enabled)) {
      if (profile.missingSecretHeaders.length) {
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP unavailable · ${profile.name}`,
          detail: `Missing credentials: ${profile.missingSecretHeaders.join(", ")}`
        });
        continue;
      }
      try {
        const resolved = await this.resolvedHeaders(profile);
        sensitiveValues.push(...resolved.sensitiveValues);
        const client = await this.connect(profile, resolved.headers, options.dispatcher, options.signal);
        clients.push(client);
        const prefix = safeMcpToolPrefix(profile.name);
        const loaded = await loadMcpTools(prefix, client, {
          prefixToolNameWithServerName: true,
          elicitation: false,
          defaultToolTimeout: 120_000,
          outputHandling: {
            text: "content",
            image: "artifact",
            audio: "artifact",
            resource: "artifact",
            resource_link: "artifact"
          },
          beforeToolCall: async ({ name, args }) => {
            const redactionValues = [...options.sensitiveValues, ...sensitiveValues];
            const approved = await requestLocalApproval(options.onEvent, {
              prompt: `Allow the agent to call the corporate MCP tool “${name}”?`,
              action: "Run MCP tool",
              target: `${profile.name} · ${new URL(profile.url).host}`,
              explanation: `The request is sent only to this configured HTTPS MCP route. Its result may be included in the next request to your configured LiteLLM model.\n\nArguments:\n${boundedMcpArguments(args, redactionValues)}`,
              risk: "sensitive",
              sensitiveValues: redactionValues
            });
            if (!approved) throw new Error("The user declined this MCP tool call.");
            options.onEvent({ type: "status", label: `Calling ${profile.name} · ${name}` });
          },
          afterToolCall: async ({ name, result }) => {
            options.onEvent({
              type: "activity",
              kind: "mcp",
              title: `MCP completed · ${name}`,
              detail: profile.name
            });
            return {
              result: sanitizeMcpResult(result, [...options.sensitiveValues, ...sensitiveValues])
            };
          }
        });
        const allowlist = new Set(profile.tools.map((name) => `${prefix}_${name}`));
        const allowed = loaded.filter((tool) => allowlist.has(tool.name));
        tools.push(...allowed);
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP connected · ${profile.name}`,
          detail: `${allowed.length} approved tool${allowed.length === 1 ? "" : "s"} available`
        });
      } catch (error) {
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP unavailable · ${profile.name}`,
          detail: safeErrorMessage(error, [...options.sensitiveValues, ...sensitiveValues])
        });
      }
    }
    return {
      tools,
      sensitiveValues,
      async close() {
        await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      }
    };
  }

  private profiles(): McpConnectionProfile[] {
    return parseStoredMcpProfiles(this.context.workspaceState.get<unknown>(MCP_PROFILES_KEY));
  }

  private async resolvedHeaders(profile: McpConnectionProfile): Promise<{ headers: Record<string, string>; sensitiveValues: string[] }> {
    const headers = { ...profile.headers };
    const sensitiveValues: string[] = [];
    for (const header of profile.secretHeaders) {
      const secret = await this.context.secrets.get(mcpSecretStorageKey(profile.id, header));
      if (!secret) throw new Error(`Missing credential for MCP header ${header}.`);
      headers[header] = secret;
      sensitiveValues.push(secret, secret.replace(/^Bearer\s+/i, ""));
    }
    return { headers, sensitiveValues: sensitiveValues.filter(Boolean) };
  }

  private async connect(
    profile: McpConnectionProfile,
    headers: Record<string, string>,
    dispatcher?: UndiciAgent,
    signal?: AbortSignal
  ): Promise<Client> {
    const client = new Client({ name: "local-dev-companion", version: "0.11.0" });
    const transport = new StreamableHTTPClientTransport(new URL(profile.url), {
      requestInit: { headers, redirect: "manual" },
      redirectPolicy: "same-origin",
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5
      },
      fetch: mcpFetch(profile.url, dispatcher, signal)
    });
    try {
      await client.connect(transport, { signal, timeout: 30_000 });
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }
}

function emptySession(): McpRunSession {
  return { tools: [], sensitiveValues: [], close: async () => undefined };
}

function boundedMcpArguments(args: unknown, sensitiveValues: readonly string[]): string {
  try {
    return redactSensitiveText(JSON.stringify(args, null, 2), sensitiveValues).slice(0, 2_000) || "{}";
  } catch {
    return "[arguments could not be displayed safely]";
  }
}

function sanitizeMcpResult(
  result: readonly [string | McpContentBlock[], unknown[]],
  sensitiveValues: readonly string[]
): [string | McpContentBlock[], []] {
  const [content] = result;
  if (typeof content === "string") {
    return [boundedMcpText(content, sensitiveValues), []];
  }
  let remaining = 30_000;
  const sanitized = content.flatMap((block) => {
    if (block.type !== "text" || typeof block.text !== "string" || remaining <= 0) return [];
    const text = redactSensitiveText(block.text, sensitiveValues).slice(0, remaining);
    remaining -= text.length;
    return [{ ...block, text }];
  });
  return [sanitized, []];
}

type McpContentBlock = {
  type: string;
  id?: string;
  [key: string]: unknown;
};

function boundedMcpText(value: string, sensitiveValues: readonly string[]): string {
  const redacted = redactSensitiveText(value, sensitiveValues);
  return redacted.length <= 30_000
    ? redacted
    : `${redacted.slice(0, 30_000)}\n\n[MCP output truncated locally]`;
}
