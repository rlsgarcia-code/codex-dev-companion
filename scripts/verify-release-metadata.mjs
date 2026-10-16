import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "node:path";

export const RELEASE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64"
];

export function expectedReleaseAssets(version) {
  return RELEASE_TARGETS.map((target) => `local-agent-companion-${version}-${target}.vsix`);
}

export function verifyReleaseMetadata({
  tag,
  packageFile = "package.json",
  changelogFile = "CHANGELOG.md",
  assetsDirectory
}) {
  const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
  const version = String(manifest.version ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json contains an invalid release version: ${version || "<empty>"}`);
  }
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag || "<empty>"} must match package version ${expectedTag}.`);
  }
  const changelog = readFileSync(changelogFile, "utf8");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## ${escapedVersion}(?:\\s|$)`, "m").test(changelog)) {
    throw new Error(`CHANGELOG.md must contain a top-level section for ${version}.`);
  }

  const assets = expectedReleaseAssets(version);
  if (assetsDirectory) {
    const present = new Set(readdirSync(assetsDirectory));
    for (const asset of assets) {
      if (!present.has(asset) || !existsSync(path.join(assetsDirectory, asset))) {
        throw new Error(`Missing release asset: ${asset}`);
      }
    }
  }
  return { version, expectedTag, assets };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const [, , tag = process.env.GITHUB_REF_NAME ?? "", assetsDirectory] = process.argv;
  const result = verifyReleaseMetadata({ tag, assetsDirectory });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
