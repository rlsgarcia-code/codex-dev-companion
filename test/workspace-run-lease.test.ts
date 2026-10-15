import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  acquireWorkspaceRunLease,
  workspaceRunLeasePath,
  workspaceRunLeaseOwner,
  WorkspaceRunLeaseConflictError
} from "../src/workspace-run-lease";

test("allows only one live process lease per workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-companion-lease-"));
  const storageRoot = path.join(root, "storage");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  try {
    const lease = await acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "first" });
    assert.deepEqual(await workspaceRunLeaseOwner({ storageRoot, workspaceRoot }), {
      sessionId: "first",
      pid: process.pid
    });
    await assert.rejects(
      acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "second" }),
      WorkspaceRunLeaseConflictError
    );
    await lease.release();
    assert.equal(await workspaceRunLeaseOwner({ storageRoot, workspaceRoot }), undefined);
    const replacement = await acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "second" });
    await replacement.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not remove a newly created lease while its owner record is being written", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-companion-partial-lease-"));
  const storageRoot = path.join(root, "storage");
  const workspaceRoot = path.join(root, "workspace");
  const leaseDirectory = path.join(storageRoot, "run-leases");
  await Promise.all([mkdir(workspaceRoot), mkdir(leaseDirectory, { recursive: true })]);
  try {
    const resolvedWorkspace = await realpath(workspaceRoot);
    await writeFile(workspaceRunLeasePath(leaseDirectory, resolvedWorkspace), "{");
    await assert.rejects(
      acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "contender" }),
      WorkspaceRunLeaseConflictError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reclaims a lease whose owning process no longer exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-companion-stale-lease-"));
  const storageRoot = path.join(root, "storage");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  try {
    const stale = await acquireWorkspaceRunLease({
      storageRoot,
      workspaceRoot,
      sessionId: "stale",
      pid: 2_147_483_647
    });
    const active = await acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "active" });
    await stale.release();
    await assert.rejects(
      acquireWorkspaceRunLease({ storageRoot, workspaceRoot, sessionId: "third" }),
      WorkspaceRunLeaseConflictError
    );
    await active.touch();
    await active.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
