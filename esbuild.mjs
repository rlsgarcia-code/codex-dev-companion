import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { generateThirdPartyNotices } from "./scripts/generate-third-party-notices.mjs";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "dist/extension.js",
  external: ["vscode", "playwright-core"],
  sourcemap: true,
  minify: false,
  metafile: true,
  logLevel: "info"
});

const result = await context.rebuild();
const nativePackage = await copyNativeAssets();
await generateThirdPartyNotices({
  metafile: result.metafile,
  additionalPackages: [nativePackage, "playwright-core"]
});

if (watch) {
  await context.watch();
} else {
  await context.dispose();
}

async function copyNativeAssets() {
  const chromaPackages = {
    "darwin-arm64": "chromadb-js-bindings-darwin-arm64",
    "darwin-x64": "chromadb-js-bindings-darwin-x64",
    "linux-arm64": "chromadb-js-bindings-linux-arm64-gnu",
    "linux-x64": "chromadb-js-bindings-linux-x64-gnu",
    "win32-x64": "chromadb-js-bindings-win32-x64-msvc"
  };
  const platformKey = `${process.platform}-${process.arch}`;
  const chromaPackage = chromaPackages[platformKey];
  if (!chromaPackage) throw new Error(`ChromaDB is not packaged for ${platformKey}.`);
  const chromaDirectory = path.join("node_modules", chromaPackage);
  const chromaBinary = (await readdir(chromaDirectory)).find((entry) => entry.endsWith(".node"));
  if (!chromaBinary) throw new Error(`Native ChromaDB binary is missing from ${chromaPackage}.`);

  await mkdir(path.join("dist", "chroma"), { recursive: true });
  await copyFile(path.join(chromaDirectory, chromaBinary), path.join("dist", "chroma", "chromadb.node"));
  await copyFile(path.join("scripts", "chroma-server.cjs"), path.join("dist", "chroma", "server.cjs"));

  const packagedPlaywright = path.join("dist", "node_modules", "playwright-core");
  await rm(packagedPlaywright, { recursive: true, force: true });
  await mkdir(path.dirname(packagedPlaywright), { recursive: true });
  await cp(path.join("node_modules", "playwright-core"), packagedPlaywright, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("types") && !source.split(path.sep).includes("bin")
  });

  await rm(path.join("dist", "build"), { recursive: true, force: true });
  return chromaPackage;
}
