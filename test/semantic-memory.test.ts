import assert from "node:assert/strict";
import test from "node:test";
import { memoryChunks } from "../src/memory-chunks";

test("turns auditable project memory into bounded semantic chunks", () => {
  const chunks = memoryChunks(`# Project memory

<!-- do not index this comment -->
- 2026-10-14: Use LangChain primitives.
- 2026-10-14: Keep secrets in Secret Storage.
`, 55);
  assert.deepEqual(chunks, [
    "- 2026-10-14: Use LangChain primitives.",
    "- 2026-10-14: Keep secrets in Secret Storage."
  ]);
});

test("does not create vectors for an empty memory template", () => {
  assert.deepEqual(memoryChunks("# Project memory\n\n<!-- template -->\n"), []);
});
