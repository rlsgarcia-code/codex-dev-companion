import { readFileSync } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASE_TARGETS } from "./verify-release-metadata.mjs";

const TARGET_BY_HOST = new Map([
  ["darwin-arm64", "darwin-arm64"],
  ["darwin-x64", "darwin-x64"],
  ["linux-arm64", "linux-arm64"],
  ["linux-x64", "linux-x64"],
  ["win32-x64", "win32-x64"]
]);

export function nativeTarget(platform = process.platform, architecture = process.arch) {
  const host = `${platform}-${architecture}`;
  const target = TARGET_BY_HOST.get(host);
  if (!target || !RELEASE_TARGETS.includes(target)) {
    throw new Error(
      `Unsupported packaging host ${host}. Supported hosts: ${[...TARGET_BY_HOST.keys()].join(", ")}.`
    );
  }
  return target;
}

export function nativePackageName(version, target) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version || "<empty>"}`);
  }
  if (!RELEASE_TARGETS.includes(target)) {
    throw new Error(`Unsupported VSIX target: ${target}`);
  }
  return `codex-dev-companion-${version}-${target}.vsix`;
}

export function packageArguments(version, target) {
  return [
    "--no-install",
    "vsce",
    "package",
    "--no-dependencies",
    "--target",
    target,
    "--out",
    nativePackageName(version, target)
  ];
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const version = String(manifest.version ?? "").trim();
  const target = nativeTarget();
  const output = nativePackageName(version, target);
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, packageArguments(version, target), {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else process.stdout.write(`NATIVE_VSIX_READY ${target} ${output}\n`);
}
