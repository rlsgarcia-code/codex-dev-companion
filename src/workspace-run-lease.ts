import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, stat, unlink, utimes } from "node:fs/promises";
import * as path from "node:path";

type LeaseRecord = {
  version: 1;
  id: string;
  workspace: string;
  sessionId: string;
  pid: number;
  startedAt: number;
  updatedAt: number;
};

export type WorkspaceRunLease = {
  id: string;
  touch(): Promise<void>;
  release(): Promise<void>;
};

export class WorkspaceRunLeaseConflictError extends Error {
  public constructor() {
    super("This workspace already has an active agent run in another VS Code window. Wait for it to finish, then refresh the thread.");
    this.name = "WorkspaceRunLeaseConflictError";
  }
}

export async function acquireWorkspaceRunLease(options: {
  storageRoot: string;
  workspaceRoot: string;
  sessionId: string;
  pid?: number;
  now?: () => number;
}): Promise<WorkspaceRunLease> {
  const workspace = await realpath(options.workspaceRoot);
  const directory = path.join(options.storageRoot, "run-leases");
  const leasePath = workspaceRunLeasePath(directory, workspace);
  const now = options.now ?? Date.now;
  await mkdir(directory, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timestamp = now();
    const record: LeaseRecord = {
      version: 1,
      id: randomUUID(),
      workspace,
      sessionId: options.sessionId,
      pid: options.pid ?? process.pid,
      startedAt: timestamp,
      updatedAt: timestamp
    };
    try {
      const handle = await open(leasePath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(record));
      } finally {
        await handle.close();
      }
      return createLease(leasePath, record, now);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const existing = await readLease(leasePath);
      if (existing && processIsAlive(existing.pid)) throw new WorkspaceRunLeaseConflictError();
      if (!existing && await recentlyModified(leasePath, now())) {
        await delay(15);
        continue;
      }
      await unlink(leasePath).catch((unlinkError) => {
        if (!isFileMissingError(unlinkError)) throw unlinkError;
      });
    }
  }
  throw new WorkspaceRunLeaseConflictError();
}

export async function workspaceRunLeaseOwner(options: {
  storageRoot: string;
  workspaceRoot: string;
}): Promise<{ sessionId: string; pid: number } | undefined> {
  const workspace = await realpath(options.workspaceRoot);
  const leasePath = workspaceRunLeasePath(path.join(options.storageRoot, "run-leases"), workspace);
  const record = await readLease(leasePath);
  if (!record || !processIsAlive(record.pid)) return undefined;
  return { sessionId: record.sessionId, pid: record.pid };
}

export function workspaceRunLeasePath(directory: string, workspace: string): string {
  const digest = createHash("sha256").update(workspace).digest("hex");
  return path.join(directory, `${digest}.json`);
}

function createLease(
  leasePath: string,
  initial: LeaseRecord,
  now: () => number
): WorkspaceRunLease {
  let released = false;
  return {
    id: initial.id,
    async touch() {
      if (released) return;
      const current = await readLease(leasePath);
      if (!current || current.id !== initial.id) {
        released = true;
        return;
      }
      const timestamp = new Date(now());
      await utimes(leasePath, timestamp, timestamp);
    },
    async release() {
      if (released) return;
      released = true;
      const current = await readLease(leasePath);
      if (!current || current.id !== initial.id) return;
      await unlink(leasePath).catch((error) => {
        if (!isFileMissingError(error)) throw error;
      });
    }
  };
}

async function readLease(leasePath: string): Promise<LeaseRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(leasePath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Partial<LeaseRecord>;
    if (
      record.version !== 1 ||
      typeof record.id !== "string" ||
      typeof record.workspace !== "string" ||
      typeof record.sessionId !== "string" ||
      typeof record.pid !== "number" ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.startedAt !== "number" ||
      typeof record.updatedAt !== "number"
    ) return undefined;
    return record as LeaseRecord;
  } catch (error) {
    if (isFileMissingError(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isFileMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function recentlyModified(filePath: string, now: number): Promise<boolean> {
  try {
    const value = await stat(filePath);
    return now - value.mtimeMs < 60_000;
  } catch (error) {
    if (isFileMissingError(error)) return false;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
