import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("keeps professional extension metadata and a valid package icon", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    homepage?: string;
    bugs?: { url?: string };
    icon?: string;
    keywords?: string[];
    scripts?: Record<string, string>;
    capabilities?: {
      untrustedWorkspaces?: { supported?: boolean; description?: string };
    };
    contributes?: {
      configuration?: {
        properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
      };
    };
  };
  assert.equal(manifest.homepage, "https://github.com/rlsgarcia-code/codex-dev-companion#readme");
  assert.equal(manifest.bugs?.url, "https://github.com/rlsgarcia-code/codex-dev-companion/issues");
  assert.equal(manifest.icon, "media/extension-icon.png");
  assert.ok(manifest.keywords?.includes("local-first"));
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
  assert.match(manifest.capabilities?.untrustedWorkspaces?.description ?? "", /must be trusted/);
  const autonomy = manifest.contributes?.configuration?.properties?.["codexDevCompanion.autonomyMode"];
  assert.equal(autonomy?.default, "review");
  assert.deepEqual(autonomy?.enum, ["review", "execute", "plan"]);
  const notifications = manifest.contributes?.configuration?.properties?.["codexDevCompanion.completionNotifications"];
  assert.equal(notifications?.default, "whenHidden");
  assert.deepEqual(notifications?.enum, ["whenHidden", "always", "never"]);
  assert.equal(
    manifest.scripts?.["test:repository"],
    "node --test test/license-inventory.test.mjs test/native-package.test.mjs test/release-metadata.test.mjs test/security-audit.test.mjs"
  );
  assert.match(manifest.scripts?.test ?? "", /npm run test:repository/);
  assert.match(manifest.scripts?.package ?? "", /npm run smoke:litellm/);
  assert.match(manifest.scripts?.package ?? "", /npm run smoke:chroma/);
  assert.match(manifest.scripts?.package ?? "", /node scripts\/package-native\.mjs/);
  assert.equal(manifest.scripts?.["audit:prod"], "node scripts/audit-production.mjs");
  assert.equal(
    manifest.scripts?.["test:extension-host"],
    "npm run build && npm run compile:extension-host-tests && node scripts/run-extension-host-tests.mjs"
  );

  const icon = readFileSync(manifest.icon);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
  assert.doesNotMatch(readFileSync(".vscodeignore", "utf8"), /^media\/extension-icon\.png$/m);
  assert.doesNotMatch(readFileSync(".vscodeignore", "utf8"), /^dist\/licenses/m);
});

test("CI verifies and packages every supported native target", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    assert.match(workflow, new RegExp(`target: ${target.replace("-", "\\-")}`));
  }
  for (const command of [
    "npm ci --ignore-scripts",
    "npm run audit:prod",
    "npm run check",
    "npm test",
    "npm run smoke:litellm",
    "npm run build",
    "xvfb-run -a npm run test:extension-host",
    "npm run smoke:chroma",
    "vsce package --no-dependencies --target"
  ]) {
    assert.ok(workflow.includes(command), `missing CI command: ${command}`);
  }
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /if: matrix\.target == 'linux-x64'[\s\S]*xvfb-run -a npm run test:extension-host/);
});

test("tagged releases publish a complete, immutable, checksummed native package set", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /tags:\s+\- "v\*\.\*\.\*"/);
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    assert.match(workflow, new RegExp(`target: ${target.replace("-", "\\-")}`));
  }
  for (const requirement of [
    "scripts/verify-release-metadata.mjs",
    "npm run audit:prod",
    "xvfb-run -a npm run test:extension-host",
    "actions/download-artifact@v8",
    "SHA256SUMS.txt",
    "gh release create",
    "is already published and will not be overwritten"
  ]) {
    assert.ok(workflow.includes(requirement), `missing release safeguard: ${requirement}`);
  }
  assert.match(workflow, /publish:[\s\S]*permissions:\s+contents: write/);
  assert.match(workflow, /gh release create[\s\S]*--draft/);
  assert.match(workflow, /gh release edit[\s\S]*--draft=false/);
});

test("repository policy documents stay present", () => {
  assert.match(readFileSync("CONTRIBUTING.md", "utf8"), /Contrato arquitetural/);
  assert.match(readFileSync("SECURITY.md", "utf8"), /Report a vulnerability/);
  assert.match(readFileSync("docs/CORPORATE-PILOT.md", "utf8"), /Critério de aprovação/);
  assert.match(readFileSync("docs/CORPORATE-PILOT.md", "utf8"), /Não acrescente chaves/);
});
