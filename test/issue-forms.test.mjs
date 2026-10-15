import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bugReport = readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");
const featureRequest = readFileSync(".github/ISSUE_TEMPLATE/feature_request.yml", "utf8");
const configuration = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8");

test("public bug reports require privacy and security confirmation", () => {
  assert.match(bugReport, /id: privacy/);
  assert.match(bugReport, /required: true/g);
  for (const prohibitedData of [
    "chave",
    "certificado",
    "endpoint privado",
    "conversa",
    "prompt",
    "código proprietário",
    "log não sanitizado"
  ]) {
    assert.match(bugReport, new RegExp(prohibitedData, "i"));
  }
  assert.match(bugReport, /Export support bundle/);
  assert.match(bugReport, /security\/advisories\/new/);
});

test("issue configuration disables unstructured reports and points security reports to the private channel", () => {
  assert.match(configuration, /blank_issues_enabled:\s*false/);
  assert.match(configuration, /security\/advisories\/new/);
  assert.match(configuration, /Não publique detalhes de segurança/);
});

test("feature requests also require a privacy confirmation", () => {
  assert.match(featureRequest, /id: privacy/);
  assert.match(featureRequest, /informações corporativas, credenciais ou conteúdo de projeto/);
  assert.match(featureRequest, /required: true/);
});

