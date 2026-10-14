import { spawn } from "node:child_process";
import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import * as path from "node:path";
import * as vscode from "vscode";

type ServerMetadata = { pid: number; port: number };

export class LocalChromaServer {
  private endpoint: Promise<string> | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async start(): Promise<string> {
    if (this.endpoint) {
      const existing = await this.endpoint;
      if (await heartbeat(existing)) return existing;
      this.endpoint = undefined;
    }
    this.endpoint = this.startOrReuse();
    try {
      return await this.endpoint;
    } catch (error) {
      this.endpoint = undefined;
      throw error;
    }
  }

  private async startOrReuse(): Promise<string> {
    const root = vscode.Uri.joinPath(this.context.globalStorageUri, "chroma").fsPath;
    const database = path.join(root, "data");
    const metadataPath = path.join(root, "server.json");
    const lockPath = path.join(root, "starting.lock");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(database));

    const existing = await this.readHealthyServer(metadataPath);
    if (existing) return existing;

    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await delay(250);
        const running = await this.readHealthyServer(metadataPath);
        if (running) return running;
        if (await isOlderThan(lockPath, 15_000)) {
          await unlink(lockPath).catch(() => undefined);
          return this.startOrReuse();
        }
      }
      throw new Error("Timed out waiting for the local ChromaDB service to start.");
    }

    try {
      const afterLock = await this.readHealthyServer(metadataPath);
      if (afterLock) return afterLock;
      const port = await availablePort();
      const launcher = vscode.Uri.joinPath(this.context.extensionUri, "dist", "chroma", "server.cjs").fsPath;
      const child = spawn(process.execPath, [
        launcher,
        "run",
        "--path",
        database,
        "--host",
        "127.0.0.1",
        "--port",
        String(port)
      ], {
        detached: true,
        stdio: "ignore",
        env: chromaEnvironment()
      });
      child.unref();
      if (!child.pid) throw new Error("The bundled local ChromaDB service could not be started.");
      const endpoint = `http://127.0.0.1:${port}`;
      await waitForHeartbeat(endpoint, child.pid);
      await writeFile(metadataPath, JSON.stringify({ pid: child.pid, port } satisfies ServerMetadata), {
        encoding: "utf8",
        mode: 0o600
      });
      return endpoint;
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async readHealthyServer(metadataPath: string): Promise<string | undefined> {
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as ServerMetadata;
      if (!Number.isInteger(metadata.port) || metadata.port < 1 || metadata.port > 65535) return undefined;
      const endpoint = `http://127.0.0.1:${metadata.port}`;
      return await heartbeat(endpoint) ? endpoint : undefined;
    } catch {
      return undefined;
    }
  }
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHeartbeat(endpoint: string, pid: number | undefined): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await heartbeat(endpoint)) return;
    if (pid && !processIsAlive(pid)) break;
    await delay(250);
  }
  throw new Error("The bundled local ChromaDB service did not become ready.");
}

async function heartbeat(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/api/v2/heartbeat`, {
      signal: AbortSignal.timeout(750)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isOlderThan(filename: string, ageMs: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(filename)).mtimeMs > ageMs;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chromaEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: "1",
    ANONYMIZED_TELEMETRY: "FALSE"
  };
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}
