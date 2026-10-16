import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const MAX_MCP_TEMPLATE_CHARACTERS = 64_000;
const PLACEHOLDER_SOURCE = String.raw`<[^<>\r\n]{1,240}>|\$\{[^{}\r\n]{1,240}\}`;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,200}$/;
const BLOCKED_STDIO_COMMANDS = new Set([
  "bash", "cscript", "cmd", "cmd.exe", "fish", "mshta", "osascript", "powershell",
  "powershell.exe", "pwsh", "sh", "wscript", "zsh"
]);
const RESERVED_STDIO_ENVIRONMENT = new Set([
  "comspec", "dyld_insert_libraries", "dyld_library_path", "ld_library_path", "ld_preload",
  "node_extra_ca_certs", "node_options", "node_path", "npm_config_cafile", "npm_config_node_options",
  "npm_config_script_shell", "path", "pathext", "shell"
]);

const importedHttpServerSchema = z.object({
  type: z.enum(["http", "streamable-http"]).optional(),
  transport: z.enum(["http", "streamable-http"]).optional(),
  url: z.string().min(1).max(4_096),
  headers: z.record(z.string(), z.string()).optional().default({}),
  tools: z.array(z.string().min(1).max(200)).max(200).optional().default([])
}).strict();

const importedStdioServerSchema = z.object({
  type: z.enum(["local", "stdio"]).optional(),
  transport: z.literal("stdio").optional(),
  command: z.string().min(1).max(512),
  args: z.array(z.string().max(4_096)).max(64).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  tools: z.array(z.string().min(1).max(200)).max(200).optional().default([])
}).strict();

type ImportedMcpServerBase = {
  name: string;
  tools: string[];
};

export type ImportedMcpServer = ImportedMcpServerBase & ({
  transport: "http";
  url: string;
  headers: Record<string, string>;
} | {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
});

export type McpTemplatePlaceholder = {
  raw: string;
  title: string;
  kind?: "input" | "secret";
};

type McpConnectionProfileBase = {
  id: string;
  name: string;
  enabled: boolean;
  tools: string[];
  updatedAt: number;
};

export type McpHttpConnectionProfile = McpConnectionProfileBase & {
  transport: "http";
  url: string;
  headers: Record<string, string>;
  secretHeaders: string[];
};

export type McpStdioConnectionProfile = McpConnectionProfileBase & {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  secretEnvironment: string[];
};

export type McpConnectionProfile = McpHttpConnectionProfile | McpStdioConnectionProfile;

export type McpConnectionSnapshot = McpConnectionProfile & {
  missingSecrets: string[];
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
    const isStdio = isRecord(rawServer)
      && (rawServer.type === "local" || rawServer.type === "stdio" || rawServer.transport === "stdio" || "command" in rawServer);
    if (isStdio) {
      const parsed = importedStdioServerSchema.safeParse(rawServer);
      if (!parsed.success) throw new Error(`MCP server “${name}” is not a supported local stdio configuration.`);
      const command = normalizeMcpCommand(parsed.data.command);
      const args = parsed.data.args.map(validateMcpArgument);
      validateMcpStdioLaunch(command, args);
      const env = normalizeMcpEnvironment(parsed.data.env);
      return { name, transport: "stdio", command, args, env, tools: normalizeImportedTools(name, parsed.data.tools) };
    }
    const parsed = importedHttpServerSchema.safeParse(rawServer);
    if (!parsed.success) throw new Error(`MCP server “${name}” is not a supported HTTPS configuration.`);
    const headers = Object.fromEntries(Object.entries(parsed.data.headers).map(([header, headerValue]) => [
      validateMcpHeaderName(header),
      validateMcpHeaderValue(headerValue)
    ]));
    return {
      name,
      transport: "http",
      url: parsed.data.url.trim(),
      headers,
      tools: normalizeImportedTools(name, parsed.data.tools)
    };
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

export function normalizeMcpCommand(value: string): string {
  const command = value.trim();
  if (!command || command.length > 512 || /[\0\r\n]/.test(command)) {
    throw new Error("Local MCP command must be a bounded single-line executable name or path.");
  }
  if (hasMcpPlaceholder(command)) throw new Error("Placeholders are not allowed in a local MCP executable name.");
  const executable = path.win32.basename(path.basename(command)).toLowerCase();
  if (BLOCKED_STDIO_COMMANDS.has(executable)) {
    throw new Error(`Local MCP command “${executable}” is a shell or script host and is not allowed.`);
  }
  return command;
}

export function validateMcpArgument(value: string): string {
  if (value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw new Error("Local MCP arguments must be bounded single-line values.");
  }
  return value;
}

export function validateMcpStdioLaunch(command: string, args: readonly string[]): void {
  const executable = path.win32.basename(path.basename(command)).toLowerCase();
  if (args.some((argument) => /^--?(?:api[-_]?key|auth|authorization|cookie|credential|password|secret|token)(?:=|$)/i.test(argument))) {
    throw new Error("MCP credentials are not allowed in process arguments. Put them in an env entry so Secret Storage can protect them.");
  }
  if (!["npx", "npx.cmd", "npx.exe"].includes(executable)) return;
  if (args.some((argument) => ["-c", "--call", "--shell"].includes(argument.toLowerCase()))) {
    throw new Error("Local MCP npx commands cannot invoke a shell or command string.");
  }
  const pinnedPackage = args.some((argument) => (
    /^@[a-z0-9._-]+\/[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?$/i.test(argument)
    || /^[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?$/i.test(argument)
  ));
  if (!pinnedPackage) {
    throw new Error("Corporate MCP packages started with npx must use an exact version such as package@1.2.3.");
  }
}

export function validateMcpEnvironmentName(value: string): string {
  const name = value.trim();
  if (!ENVIRONMENT_NAME.test(name)) throw new Error(`Invalid MCP environment variable name: ${name || "(empty)"}.`);
  if (RESERVED_STDIO_ENVIRONMENT.has(name.toLowerCase())) {
    throw new Error(`MCP environment variable ${name} controls process execution or trust and cannot come from a template.`);
  }
  return name;
}

export function validateMcpEnvironmentValue(value: string): string {
  if (value.length > 8_192 || /[\0\r\n]/.test(value)) {
    throw new Error("MCP environment values must be bounded single-line values.");
  }
  return value;
}

export function normalizeMcpEnvironment(value: Record<string, string>): Record<string, string> {
  const entries = Object.entries(value);
  if (entries.length > 64) throw new Error("A local MCP server may define at most 64 environment variables.");
  return Object.fromEntries(entries.map(([name, environmentValue]) => {
    const normalizedName = validateMcpEnvironmentName(name);
    const normalizedValue = validateMcpEnvironmentValue(environmentValue);
    if (/^npm_config_registry$/i.test(normalizedName) && !hasMcpPlaceholder(normalizedValue)) {
      let registry: URL;
      try {
        registry = new URL(normalizedValue);
      } catch {
        throw new Error("The corporate npm registry must be a complete HTTPS URL.");
      }
      if (registry.protocol !== "https:" || registry.username || registry.password) {
        throw new Error("The corporate npm registry must use HTTPS and cannot contain credentials.");
      }
    }
    return [normalizedName, normalizedValue];
  }));
}

export function isSecretMcpEnvironment(name: string): boolean {
  return /(?:^|_)(?:api_?key|auth|authorization|cookie|credential|password|secret|token)(?:_|$)/i.test(name.trim());
}

export function hasMcpPlaceholder(value: string): boolean {
  return new RegExp(PLACEHOLDER_SOURCE).test(value);
}

export function mcpTemplatePlaceholders(value: string): McpTemplatePlaceholder[] {
  const matches = value.match(new RegExp(PLACEHOLDER_SOURCE, "g")) ?? [];
  return [...new Set(matches)].map((raw) => {
    const inner = raw.startsWith("${") ? raw.slice(2, -1) : raw.slice(1, -1);
    const qualified = inner.match(/^\s*(input|secret)\s*:\s*(.*?)\s*$/i);
    const kind = qualified?.[1]?.toLowerCase() as McpTemplatePlaceholder["kind"];
    const title = (qualified?.[2] ?? inner).replace(/[\0\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
    if (!title) throw new Error(`MCP placeholder ${raw} needs a title.`);
    if (title.length > 120) throw new Error(`MCP placeholder ${raw} has a title longer than 120 characters.`);
    return { raw, title, ...(kind ? { kind } : {}) };
  });
}

export function isSecretMcpHeader(name: string): boolean {
  return !/^(accept|content-type|user-agent|x-route)$/i.test(name.trim());
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

export function mcpSecretStorageKey(profileId: string, secretName: string): string {
  const digest = createHash("sha256").update(`${profileId}\0${secretName.toLowerCase()}`).digest("hex").slice(0, 24);
  return `localAgentCompanion.mcp.${digest}`;
}

export function safeMcpToolPrefix(name: string): string {
  const prefix = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return prefix || "mcp";
}

export function validateMcpToolName(value: string): string {
  const name = value.trim();
  if (!TOOL_NAME.test(name)) throw new Error(`Invalid MCP tool name: ${name || "(empty)"}.`);
  return name;
}

export function mcpConnectionDescription(profile: McpConnectionProfile): string {
  return profile.transport === "http" ? profile.url : [profile.command, ...profile.args].join(" ");
}

export function parseStoredMcpProfiles(value: unknown): McpConnectionProfile[] {
  const common = {
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    enabled: z.boolean(),
    tools: z.array(z.string().min(1).max(200)).max(200),
    updatedAt: z.number().int().nonnegative()
  };
  const httpProfileSchema = z.object({
    ...common,
    transport: z.literal("http").optional(),
    url: z.string().min(1).max(4_096),
    headers: z.record(z.string(), z.string()),
    secretHeaders: z.array(z.string().min(1).max(128)).max(20)
  }).strict();
  const stdioProfileSchema = z.object({
    ...common,
    transport: z.literal("stdio"),
    command: z.string().min(1).max(512),
    args: z.array(z.string().max(4_096)).max(64),
    env: z.record(z.string(), z.string()),
    secretEnvironment: z.array(z.string().min(1).max(128)).max(64)
  }).strict();
  const parsed = z.array(z.unknown()).max(20).safeParse(value);
  if (!parsed.success) return [];
  const profiles: McpConnectionProfile[] = [];
  for (const candidate of parsed.data) {
    const stdio = stdioProfileSchema.safeParse(candidate);
    const http = stdio.success ? undefined : httpProfileSchema.safeParse(candidate);
    try {
      if (stdio.success) {
        const command = normalizeMcpCommand(stdio.data.command);
        const args = stdio.data.args.map(validateMcpArgument);
        validateMcpStdioLaunch(command, args);
        profiles.push({
          ...stdio.data,
          name: normalizeMcpServerName(stdio.data.name),
          command,
          args,
          env: normalizeMcpEnvironment(stdio.data.env),
          secretEnvironment: [...new Set(stdio.data.secretEnvironment.map(validateMcpEnvironmentName))],
          tools: normalizeStoredTools(stdio.data.tools)
        } satisfies McpStdioConnectionProfile);
        continue;
      }
      if (http?.success) {
        profiles.push({
          ...http.data,
          transport: "http" as const,
          name: normalizeMcpServerName(http.data.name),
          url: normalizeMcpEndpoint(http.data.url),
          headers: Object.fromEntries(Object.entries(http.data.headers).map(([name, headerValue]) => [
            validateMcpHeaderName(name),
            validateMcpHeaderValue(headerValue)
          ])),
          secretHeaders: [...new Set(http.data.secretHeaders.map(validateMcpHeaderName))],
          tools: normalizeStoredTools(http.data.tools)
        } satisfies McpHttpConnectionProfile);
      }
    } catch {
      // Ignore malformed stored profiles instead of blocking every valid connection.
    }
  }
  return profiles;
}

function normalizeImportedTools(serverName: string, tools: string[]): string[] {
  const normalized = [...new Set(tools.map((tool) => tool.trim()))];
  if (normalized.includes("*") && normalized.length !== 1) {
    throw new Error(`MCP server “${serverName}” must use either tools ["*"] or an explicit tool list.`);
  }
  if (normalized.some((tool) => tool !== "*" && !TOOL_NAME.test(tool))) {
    throw new Error(`MCP server “${serverName}” contains an invalid tool name.`);
  }
  return normalized;
}

function normalizeStoredTools(tools: string[]): string[] {
  return [...new Set(tools.filter((tool) => TOOL_NAME.test(tool)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
