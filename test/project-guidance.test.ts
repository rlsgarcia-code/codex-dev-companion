import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { collectProjectGuidance, guidanceCandidates } from "../src/project-guidance";

test("orders applicable nested AGENTS guidance before workspace documents", () => {
  const root = path.join(path.sep, "workspace");
  const candidates = guidanceCandidates([root], path.join(root, "packages", "app", "src", "main.ts"));
  assert.deepEqual(candidates.map((candidate) => candidate.displayPath), [
    "packages/app/src/AGENTS.md",
    "packages/app/AGENTS.md",
    "packages/AGENTS.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "CONTRIBUTING.md",
    "README.md"
  ]);
});

test("loads bounded local guidance and skips symlinks outside the workspace", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "local-companion-guidance-"));
  const root = path.join(parent, "workspace");
  const outside = path.join(parent, "outside.md");
  try {
    await mkdir(path.join(root, "packages", "app"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "workspace rules", "utf8");
    await writeFile(path.join(root, "packages", "app", "AGENTS.md"), "nearest rules", "utf8");
    await writeFile(path.join(root, "README.md"), "r".repeat(8_000), "utf8");
    await writeFile(outside, "must never be loaded", "utf8");
    await symlink(outside, path.join(root, "CONTRIBUTING.md"));

    const documents = await collectProjectGuidance(
      [root],
      path.join(root, "packages", "app", "index.ts")
    );
    assert.deepEqual(documents.map((document) => document.path), [
      "packages/app/AGENTS.md",
      "AGENTS.md",
      "README.md"
    ]);
    assert.equal(documents[0]?.content, "nearest rules");
    assert.equal(documents[2]?.content.length, 6_000);
    assert.equal(documents[2]?.truncated, true);
    assert.doesNotMatch(documents.map((document) => document.content).join("\n"), /must never be loaded/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
