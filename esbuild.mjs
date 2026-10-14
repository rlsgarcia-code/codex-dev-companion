import * as esbuild from "esbuild";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import * as path from "node:path";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  minify: false,
  logLevel: "info"
});

await copyNativeAssets();

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
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

  await mkdir(path.join("dist", "licenses"), { recursive: true });
  await rm(path.join("dist", "build"), { recursive: true, force: true });
  await rm(path.join("dist", "licenses", "better-sqlite3-mit.txt"), { force: true });
  await copyFile(path.join("node_modules", "chromadb", "LICENSE"), path.join("dist", "licenses", "chromadb-apache-2.0.txt"));
  await copyFile(path.join("node_modules", "@langchain", "community", "LICENSE"), path.join("dist", "licenses", "langchain-community-mit.txt"));
}
