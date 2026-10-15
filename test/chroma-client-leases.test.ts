import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { releaseChromaClientLease } from "../src/chroma-client-leases";

test("keeps a shared Chroma server alive while another VS Code client lease is live", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "chroma-client-leases-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const own = path.join(root, "owner-12345678.json");
  const other = path.join(root, "other-12345678.json");
  await writeFile(own, JSON.stringify({ version: 1, id: "owner-12345678", pid: 10, createdAt: 1 }));
  await writeFile(other, JSON.stringify({ version: 1, id: "other-12345678", pid: 20, createdAt: 1 }));

  assert.equal(releaseChromaClientLease(root, own, (pid) => pid === 20), false);
  assert.deepEqual(await readdir(root), ["other-12345678.json"]);
  assert.equal(releaseChromaClientLease(root, other, () => false), true);
  assert.deepEqual(await readdir(root), []);
});

test("removes malformed and dead Chroma client leases", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "chroma-stale-leases-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const own = path.join(root, "owner-12345678.json");
  await writeFile(own, JSON.stringify({ version: 1, id: "owner-12345678", pid: 10, createdAt: 1 }));
  await writeFile(path.join(root, "dead-12345678.json"), JSON.stringify({ version: 1, id: "dead-12345678", pid: 20, createdAt: 1 }));
  await writeFile(path.join(root, "malformed.json"), "not-json");

  assert.equal(releaseChromaClientLease(root, own, () => false), true);
  assert.deepEqual(await readdir(root), []);
});
