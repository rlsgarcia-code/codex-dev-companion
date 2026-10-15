import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  expectedReleaseAssets,
  RELEASE_TARGETS,
  verifyReleaseMetadata
} from "../scripts/verify-release-metadata.mjs";

async function withFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "local-companion-release-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## 1.2.3\n\n- Ready.\n");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("requires the tag, package version, and changelog section to agree", async () => {
  await withFixture(async (root) => {
    const options = {
      tag: "v1.2.3",
      packageFile: path.join(root, "package.json"),
      changelogFile: path.join(root, "CHANGELOG.md")
    };
    assert.deepEqual(verifyReleaseMetadata(options), {
      version: "1.2.3",
      expectedTag: "v1.2.3",
      assets: expectedReleaseAssets("1.2.3")
    });
    assert.throws(() => verifyReleaseMetadata({ ...options, tag: "v1.2.4" }), /must match package version/);
    await writeFile(options.changelogFile, "# Changelog\n");
    assert.throws(() => verifyReleaseMetadata(options), /section for 1\.2\.3/);
  });
});

test("requires one native VSIX for every supported release target", async () => {
  await withFixture(async (root) => {
    const assetsDirectory = path.join(root, "release");
    await mkdir(assetsDirectory);
    const assets = expectedReleaseAssets("1.2.3");
    for (const asset of assets) await writeFile(path.join(assetsDirectory, asset), "vsix");
    const options = {
      tag: "v1.2.3",
      packageFile: path.join(root, "package.json"),
      changelogFile: path.join(root, "CHANGELOG.md"),
      assetsDirectory
    };
    assert.equal(verifyReleaseMetadata(options).assets.length, RELEASE_TARGETS.length);
    await rm(path.join(assetsDirectory, assets[0]));
    assert.throws(() => verifyReleaseMetadata(options), /Missing release asset/);
  });
});
