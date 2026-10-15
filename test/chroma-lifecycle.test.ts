import assert from "node:assert/strict";
import test from "node:test";
import {
  CHROMA_LOCK_WAIT_TIMEOUT_MS,
  CHROMA_START_LOCK_STALE_MS,
  CHROMA_STARTUP_TIMEOUT_MS,
  parseChromaClientLease,
  parseChromaHeartbeat,
  parseChromaServerMetadata,
  parseChromaStartLock,
  shouldReclaimChromaStartLock
} from "../src/chroma-lifecycle";

test("validates current and legacy Chroma server metadata", () => {
  assert.deepEqual(
    parseChromaServerMetadata({ version: 1, pid: 42, port: 8000, startedAt: 1234 }),
    { version: 1, pid: 42, port: 8000, startedAt: 1234 }
  );
  assert.deepEqual(
    parseChromaServerMetadata({ pid: 42, port: 8000 }),
    { version: 1, pid: 42, port: 8000, startedAt: 0 }
  );
  for (const invalid of [
    undefined,
    {},
    { version: 2, pid: 42, port: 8000, startedAt: 0 },
    { version: 1, pid: 0, port: 8000, startedAt: 0 },
    { version: 1, pid: 42, port: 0, startedAt: 0 },
    { version: 1, pid: 42, port: 65_536, startedAt: 0 }
  ]) {
    assert.equal(parseChromaServerMetadata(invalid), undefined);
  }
});

test("validates Chroma client leases used to protect other VS Code windows", () => {
  assert.deepEqual(
    parseChromaClientLease({ version: 1, id: "client-12345678", pid: 91, createdAt: 500 }),
    { version: 1, id: "client-12345678", pid: 91, createdAt: 500 }
  );
  assert.equal(parseChromaClientLease({ version: 1, id: "../escape", pid: 91, createdAt: 500 }), undefined);
  assert.equal(parseChromaClientLease({ version: 1, id: "client-12345678", pid: 0, createdAt: 500 }), undefined);
});

test("accepts only the documented numeric Chroma heartbeat shape", () => {
  assert.equal(parseChromaHeartbeat({ "nanosecond heartbeat": 1_792_058_114_007_589_000 }), 1_792_058_114_007_589_000);
  assert.equal(parseChromaHeartbeat({ "nanosecond heartbeat": "123456" }), 123456);
  assert.equal(parseChromaHeartbeat({ heartbeat: 123456 }), undefined);
  assert.equal(parseChromaHeartbeat({ "nanosecond heartbeat": 0 }), undefined);
  assert.equal(parseChromaHeartbeat("ok"), undefined);
});

test("reclaims dead or truly stale startup locks without racing a valid startup", () => {
  const now = 100_000;
  const active = parseChromaStartLock({ version: 1, pid: 77, createdAt: now - 1_000 });
  assert.ok(active);
  assert.equal(shouldReclaimChromaStartLock(active, 0, now, () => true), false);
  assert.equal(shouldReclaimChromaStartLock(active, 0, now, () => false), true);

  const stale = parseChromaStartLock({
    version: 1,
    pid: 77,
    createdAt: now - CHROMA_START_LOCK_STALE_MS - 1
  });
  assert.equal(shouldReclaimChromaStartLock(stale, 0, now, () => true), true);
  assert.equal(
    shouldReclaimChromaStartLock(undefined, now - CHROMA_START_LOCK_STALE_MS - 1, now, () => true),
    true
  );

  assert.ok(CHROMA_START_LOCK_STALE_MS > CHROMA_STARTUP_TIMEOUT_MS);
  assert.ok(CHROMA_LOCK_WAIT_TIMEOUT_MS > CHROMA_START_LOCK_STALE_MS);
});
