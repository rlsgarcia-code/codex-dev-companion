import assert from "node:assert/strict";
import test from "node:test";
import {
  hasMcpPlaceholder,
  isSecretMcpEnvironment,
  isSecretMcpHeader,
  mcpTemplatePlaceholders,
  mcpSecretStorageKey,
  normalizeMcpEndpoint,
  parseMcpTemplate,
  parseStoredMcpProfiles,
  safeMcpToolPrefix,
  stripSecretHeaderPrefix,
  validateMcpStdioLaunch
} from "../src/mcp-config";

const databricksTemplate = JSON.stringify({
  mcpServers: {
    "databricks-sql": {
      type: "http",
      url: "https://api.example.test/ia/mcp/v1/mcp-databricks-sql/<WORKSPACE>/mcp",
      headers: {
        "X-Route": "<OPTIONAL ENVIRONMENT>",
        apikey: "<SUBSCRIPTION KEY>",
        Authorization: "Bearer <DATABRICKS TOKEN>"
      },
      tools: ["execute_sql_read_only", "poll_sql_result"]
    }
  }
});

test("imports the portable corporate HTTP MCP template without resolving or persisting secrets", () => {
  const [server] = parseMcpTemplate(databricksTemplate);
  assert.equal(server?.name, "databricks-sql");
  assert.equal(server?.transport, "http");
  if (server?.transport !== "http") return;
  assert.equal(server.headers.Authorization, "Bearer <DATABRICKS TOKEN>");
  assert.deepEqual(server.tools, ["execute_sql_read_only", "poll_sql_result"]);
  assert.equal(hasMcpPlaceholder(server.url), true);
  assert.equal(isSecretMcpHeader("apikey"), true);
  assert.equal(isSecretMcpHeader("Authorization"), true);
  assert.equal(isSecretMcpHeader("X-Route"), false);
  assert.deepEqual(stripSecretHeaderPrefix("Authorization", "Bearer token-value"), {
    prefix: "Bearer ",
    secret: "token-value"
  });
});

test("accepts only final credential-free HTTPS MCP routes", () => {
  assert.equal(
    normalizeMcpEndpoint("https://api.example.test/ia/mcp/workspace/mcp"),
    "https://api.example.test/ia/mcp/workspace/mcp"
  );
  assert.throws(() => normalizeMcpEndpoint("http://api.example.test/mcp"), /require HTTPS/);
  assert.throws(() => normalizeMcpEndpoint("https://user:password@api.example.test/mcp"), /credentials/);
  assert.throws(() => normalizeMcpEndpoint("https://api.example.test/mcp?token=x"), /query parameters/);
  assert.throws(() => normalizeMcpEndpoint("https://api.example.test/<WORKSPACE>/mcp"), /placeholder/);
});

test("classifies titled input and secret placeholders while preserving legacy templates", () => {
  assert.deepEqual(mcpTemplatePlaceholders(
    "Bearer <secret:Databricks token> for ${input:Workspace} and <Legacy key>"
  ), [
    { raw: "<secret:Databricks token>", title: "Databricks token", kind: "secret" },
    { raw: "${input:Workspace}", title: "Workspace", kind: "input" },
    { raw: "<Legacy key>", title: "Legacy key" }
  ]);
  assert.equal(isSecretMcpHeader("Content-Type"), false);
  assert.equal(isSecretMcpHeader("X-Corporate-Token"), true);
  assert.throws(() => mcpTemplatePlaceholders("<secret:   >"), /needs a title/);
});

test("imports pinned corporate stdio MCP templates without treating the registry as a secret", () => {
  const [server] = parseMcpTemplate(JSON.stringify({
    mcpServers: {
      playwright: {
        type: "local",
        command: "npx",
        args: ["--yes", "@playwright/mcp@0.0.83"],
        env: { npm_config_registry: "https://registry.example.test/npm/" },
        tools: ["*"]
      }
    }
  }));
  assert.equal(server?.transport, "stdio");
  if (server?.transport !== "stdio") return;
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["--yes", "@playwright/mcp@0.0.83"]);
  assert.equal(server.env.npm_config_registry, "https://registry.example.test/npm/");
  assert.deepEqual(server.tools, ["*"]);
  assert.equal(isSecretMcpEnvironment("npm_config_registry"), false);
  assert.equal(isSecretMcpEnvironment("GITHUB_TOKEN"), true);
});

test("rejects unsafe stdio launches and malformed tool catalogs", () => {
  assert.throws(() => parseMcpTemplate(JSON.stringify({
    mcpServers: { local: { type: "stdio", command: "sh", args: ["-c", "server"] } }
  })), /shell or script host/);
  assert.throws(() => validateMcpStdioLaunch("npx", ["--yes", "@playwright/mcp@latest"]), /exact version/);
  assert.throws(() => validateMcpStdioLaunch("node", ["server.js", "--token", "secret"]), /not allowed in process arguments/);
  assert.throws(() => parseMcpTemplate(JSON.stringify({
    mcpServers: {
      local: {
        type: "local",
        command: "node",
        args: ["server.js"],
        env: { NODE_OPTIONS: "--require ./hook.js" },
        tools: ["read"]
      }
    }
  })), /controls process execution or trust/);
  assert.throws(() => parseMcpTemplate(JSON.stringify({
    mcpServers: {
      local: {
        type: "local",
        command: "npx",
        args: ["--yes", "@playwright/mcp@0.0.83"],
        env: { npm_config_registry: "http://registry.example.test/npm/" },
        tools: ["*"]
      }
    }
  })), /must use HTTPS/);
  assert.throws(() => parseMcpTemplate(JSON.stringify({
    servers: { remote: { type: "http", url: "https://api.example.test/mcp", tools: ["bad tool"] } }
  })), /invalid tool name/);
});

test("keeps persisted profiles non-secret and derives opaque Secret Storage keys", () => {
  const id = "2ea3399d-e89c-4c14-861e-2ed1915f1ef5";
  const [profile] = parseStoredMcpProfiles([{
    id,
    name: "databricks-sql",
    url: "https://api.example.test/mcp",
    enabled: true,
    headers: { "X-Route": "production" },
    secretHeaders: ["apikey", "Authorization"],
    tools: ["execute_sql_read_only"],
    updatedAt: 1
  }]);
  assert.equal(profile?.transport, "http");
  if (profile?.transport !== "http") return;
  assert.equal(profile.headers.apikey, undefined);
  assert.deepEqual(profile.secretHeaders, ["apikey", "Authorization"]);
  const key = mcpSecretStorageKey(id, "Authorization");
  assert.match(key, /^localAgentCompanion\.mcp\.[a-f0-9]{24}$/);
  assert.doesNotMatch(key, /authorization/i);
  assert.equal(safeMcpToolPrefix("Databricks SQL"), "databricks_sql");
});

test("keeps approved stdio profiles non-secret and rejects wildcard persistence", () => {
  const id = "2ea3399d-e89c-4c14-861e-2ed1915f1ef5";
  const [profile] = parseStoredMcpProfiles([{
    id,
    name: "playwright",
    transport: "stdio",
    command: "npx",
    args: ["--yes", "@playwright/mcp@0.0.83"],
    env: { npm_config_registry: "https://registry.example.test/npm/" },
    secretEnvironment: ["CORPORATE_TOKEN"],
    enabled: true,
    tools: ["browser_navigate", "*"],
    updatedAt: 1
  }]);
  assert.equal(profile?.transport, "stdio");
  if (profile?.transport !== "stdio") return;
  assert.equal(profile.env.CORPORATE_TOKEN, undefined);
  assert.deepEqual(profile.secretEnvironment, ["CORPORATE_TOKEN"]);
  assert.deepEqual(profile.tools, ["browser_navigate"]);
});
