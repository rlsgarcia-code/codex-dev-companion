import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "local-companion-chroma-smoke-"));
const port = await availablePort();
const endpoint = `http://127.0.0.1:${port}`;
const output = [];
const child = spawn(process.execPath, [
  path.resolve("dist/chroma/server.cjs"),
  "run",
  "--path",
  path.join(root, "data"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port)
], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
  env: chromaEnvironment()
});

for (const stream of [child.stdout, child.stderr]) {
  stream?.on("data", (chunk) => {
    if (output.join("").length < 32_000) output.push(String(chunk));
  });
}

let exited = false;
const exit = new Promise((resolve) => child.once("exit", (code, signal) => {
  exited = true;
  resolve({ code, signal });
}));
try {
  const heartbeat = await waitForJson(`${endpoint}/api/v2/heartbeat`, 20_000);
  assert.equal(typeof heartbeat, "object");
  assert.ok(heartbeat && Number.isFinite(Number(heartbeat["nanosecond heartbeat"])));

  const version = await waitForJson(`${endpoint}/api/v2/version`, 3_000);
  assert.equal(typeof version, "string");
  assert.ok(version.trim(), "Chroma version must not be empty");
} catch (error) {
  const detail = output.join("").trim();
  throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? `\nChroma output:\n${detail}` : ""}`);
} finally {
  if (!exited) child.kill("SIGINT");
  await Promise.race([exit, delay(3_000)]);
  if (!exited) {
    child.kill("SIGKILL");
    await Promise.race([exit, delay(2_000)]);
  }
  assert.equal(exited, true, "Chroma process did not exit after SIGINT followed by SIGKILL");
  await rm(root, { recursive: true, force: true });
}

assert.equal(await endpointResponds(endpoint), false, "Chroma endpoint remained active after process shutdown");
console.log("LOCAL_CHROMA_NATIVE_LIFECYCLE_OK");

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chroma exited before becoming ready with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(750) });
      if (response.ok) return await response.json();
    } catch {
      // The native service may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function endpointResponds(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      cache: "no-store",
      signal: AbortSignal.timeout(500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function chromaEnvironment() {
  const environment = {
    ELECTRON_RUN_AS_NODE: "1",
    ANONYMIZED_TELEMETRY: "FALSE"
  };
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
