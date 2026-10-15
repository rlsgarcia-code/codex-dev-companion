import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_MCP_TEMPLATE_CHARACTERS = 64_000;
const PLACEHOLDER = /<[^<>]{3,240}>|\$\{[^{}]{1,240}\}/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,200}$/;

const importedServerSchema = z.object({
  type: z.enum(["http", "streamable-http"]).optional(),
  transport: z.enum(["http", "streamable-http"]).optional(),
  url: z.string().min(1).max(4_096),
  headers: z.record(z.string(), z.string()).optional().default({}),
  tools: z.array(z.string().min(1).max(200)).max(200).optional().default([])
}).strict();

export type ImportedMcpServer = {
  name: string;
  url: string;
  headers: Record<string, string>;
  tools: string[];
};

export type McpConnectionProfile = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headers: Record<string, string>;
  secretHeaders: string[];
  tools: string[];
  updatedAt: number;
};

export type McpConnectionSnapshot = McpConnectionProfile & {
  missingSecretHeaders: string[];
};

export function parseMcpTemplate(source: string): ImportedMcpServer[] {
  if (!source.trim()) throw new Error("Paste or select an MCP JSON configuration first.");
  if (source.length > MAX_MCP_TEMPLATE_CHARACTERS) {
    throw new Error("MCP configuration exceeds the 64 KB safety limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("The MCP configuration is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("The MCP configuration must be a JSON object.");
  const candidate = value.mcpServers ?? value.servers;
  if (!isRecord(candidate)) {
    throw new Error("Expected an mcpServers or servers object in the MCP configuration.");
  }
  const entries = Object.entries(candidate);
  if (!entries.length) throw new Error("The MCP configuration contains no servers.");
  if (entries.length > 20) throw new Error("An MCP configuration may contain at most 20 servers.");

  return entries.map(([rawName, rawServer]) => {
    const name = normalizeMcpServerName(rawName);
    if (isRecord(rawServer) && (rawServer.type === "stdio" || rawServer.transport === "stdio" || "command" in rawServer)) {
      throw new Error(`MCP server “${name}” uses stdio. This release accepts corporate HTTPS MCP servers only.`);
    }
    const parsed = importedServerSchema.safeParse(rawServer);
    if (!parsed.success) {
      throw new Error(`MCP server “${name}” is not a supported HTTPS configuration.`);
    }
    for (const [header, headerValue] of Object.entries(parsed.data.headers)) {
      validateMcpHeaderName(header);
      validateMcpHeaderValue(headerValue);
    }
    const tools = [...new Set(parsed.data.tools.map((tool) => tool.trim()))];
    if (tools.some((tool) => !TOOL_NAME.test(tool))) {
      throw new Error(`MCP server “${name}” contains an invalid tool name.`);
    }
    return { name, url: parsed.data.url.trim(), headers: parsed.data.headers, tools };
  });
}

export function normalizeMcpServerName(value: string): string {
  const name = value.replace(/[\r\n\t\0]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name) throw new Error("MCP server name cannot be empty.");
  return name;
}

export function normalizeMcpEndpoint(value: string): string {
  const input = value.trim();
  if (hasMcpPlaceholder(input)) throw new Error("Replace every placeholder in the MCP URL.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete HTTPS MCP URL.");
  }
  if (url.protocol !== "https:") throw new Error("Corporate MCP connections require HTTPS.");
  if (url.username || url.password) throw new Error("Do not put credentials in the MCP URL.");
  if (url.hash) throw new Error("MCP URLs cannot contain a fragment.");
  if (url.search) throw new Error("MCP URLs cannot contain query parameters; use headers for credentials.");
  return url.href;
}

export function hasMcpPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

export function isSecretMcpHeader(name: string): boolean {
  return !/^x-route$/i.test(name.trim());
}

export function validateMcpHeaderName(value: string): string {
  const name = value.trim();
  if (!HEADER_NAME.test(name)) throw new Error(`Invalid MCP header name: ${name || "(empty)"}.`);
  return name;
}

export function validateMcpHeaderValue(value: string): string {
  const normalized = value.trim();
  if (/\0|\r|\n/.test(value)) throw new Error("MCP header values cannot contain line breaks.");
  if (normalized.length > 8_192) throw new Error("MCP header value exceeds the 8 KB safety limit.");
  return normalized;
}

export function stripSecretHeaderPrefix(name: string, value: string): { prefix: string; secret: string } {
  if (/^authorization$/i.test(name)) {
    const bearer = value.match(/^\s*(Bearer\s+)(.*)$/i);
    if (bearer) return { prefix: bearer[1]!, secret: bearer[2]!.trim() };
  }
  return { prefix: "", secret: value.trim() };
}

export function mcpSecretStorageKey(profileId: string, headerName: string): string {
  const digest = createHash("sha256").update(`${profileId}\0${headerName.toLowerCase()}`).digest("hex").slice(0, 24);
  return `codexDevCompanion.mcp.${digest}`;
}

export function safeMcpToolPrefix(name: string): string {
  const prefix = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return prefix || "mcp";
}

export function parseStoredMcpProfiles(value: unknown): McpConnectionProfile[] {
  const profileSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    url: z.string().min(1).max(4_096),
    enabled: z.boolean(),
    headers: z.record(z.string(), z.string()),
    secretHeaders: z.array(z.string().min(1).max(128)).max(20),
    tools: z.array(z.string().min(1).max(200)).max(200),
    updatedAt: z.number().int().nonnegative()
  }).strict();
  const parsed = z.array(profileSchema).max(20).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.flatMap((profile) => {
    try {
      return [{
        ...profile,
        name: normalizeMcpServerName(profile.name),
        url: normalizeMcpEndpoint(profile.url),
        headers: Object.fromEntries(Object.entries(profile.headers).map(([name, headerValue]) => [
          validateMcpHeaderName(name),
          validateMcpHeaderValue(headerValue)
        ])),
        secretHeaders: [...new Set(profile.secretHeaders.map(validateMcpHeaderName))],
        tools: [...new Set(profile.tools.filter((tool) => TOOL_NAME.test(tool)))]
      }];
    } catch {
      return [];
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
