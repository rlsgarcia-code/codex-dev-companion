import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteDurableMemoryEntry,
  durableMemorySnapshot,
  normalizeMemoryText,
  replaceDurableMemoryEntry
} from "../src/memory-entries";

const MEMORY = `# Project memory

Durable facts, decisions, conventions, and follow-ups for the development agent.

- 2026-10-10: Use exact replacements for audited edits.
- Keep this undated convention too.
- 2026-10-12: Run the complete gate before release.
`;

test("parses durable memory entries newest first with stable local identifiers", () => {
  const snapshot = durableMemorySnapshot(MEMORY);
  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.omitted, 0);
  assert.deepEqual(snapshot.entries.map((entry) => entry.date), ["2026-10-12", undefined, "2026-10-10"]);
  assert.equal(new Set(snapshot.entries.map((entry) => entry.id)).size, 3);
});

test("bounds the memory-center projection without changing the source", () => {
  const snapshot = durableMemorySnapshot(MEMORY, 2);
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.omitted, 1);
});

test("replaces one exact entry while preserving its date and surrounding markdown", () => {
  const entry = durableMemorySnapshot(MEMORY).entries[0]!;
  const updated = replaceDurableMemoryEntry(MEMORY, entry.id, "  Run   all checks before release.  ");
  assert.match(updated, /- 2026-10-12: Run all checks before release\./);
  assert.match(updated, /# Project memory/);
  assert.match(updated, /Use exact replacements/);
});

test("deletes only the selected entry and rejects stale identifiers", () => {
  const entry = durableMemorySnapshot(MEMORY).entries[1]!;
  const updated = deleteDurableMemoryEntry(MEMORY, entry.id);
  assert.doesNotMatch(updated, /undated convention/);
  assert.match(updated, /Run the complete gate/);
  assert.throws(() => deleteDurableMemoryEntry(updated, entry.id), /changed or no longer exists/);
});

test("rejects empty and oversized durable-memory entries", () => {
  assert.throws(() => normalizeMemoryText("   "), /cannot be empty/);
  assert.throws(() => normalizeMemoryText("x".repeat(4_001)), /under 4,000/);
});
