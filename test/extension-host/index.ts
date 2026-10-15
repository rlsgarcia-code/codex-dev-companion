import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "local.codex-dev-companion";
const EXPECTED_COMMANDS = [
  "codexDevCompanion.open",
  "codexDevCompanion.newThread",
  "codexDevCompanion.addSelection",
  "codexDevCompanion.addFileContext",
  "codexDevCompanion.remember",
  "codexDevCompanion.configureLiteLlm",
  "codexDevCompanion.clearLiteLlmKey"
] as const;

async function completesWithin<T>(label: string, operation: PromiseLike<T>, timeoutMs = 10_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, true, "the integration fixture must run as a trusted workspace");
  assert.equal(vscode.workspace.workspaceFolders?.length, 1, "the test must open exactly one isolated workspace");

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} must be discoverable by the Extension Host`);
  assert.equal(extension.packageJSON.main, "./dist/extension.js");
  assert.equal(extension.packageJSON.capabilities?.untrustedWorkspaces?.supported, false);

  await completesWithin("extension activation", extension.activate(), 15_000);
  assert.equal(extension.isActive, true, "the extension must remain active after activation");

  const registeredCommands = new Set(await vscode.commands.getCommands(true));
  for (const command of EXPECTED_COMMANDS) {
    assert.ok(registeredCommands.has(command), `${command} must be registered after activation`);
  }

  const configuration = vscode.workspace.getConfiguration("codexDevCompanion");
  assert.equal(configuration.get("agentRuntime"), "standard");
  assert.equal(configuration.get("autonomyMode"), "review");
  assert.equal(configuration.get("completionNotifications"), "whenHidden");

  await completesWithin(
    "opening the Local Companion view",
    vscode.commands.executeCommand("codexDevCompanion.open")
  );
  await completesWithin(
    "creating a new local thread",
    vscode.commands.executeCommand("codexDevCompanion.newThread")
  );
  await completesWithin(
    "opening the LiteLLM settings surface",
    vscode.commands.executeCommand("codexDevCompanion.configureLiteLlm")
  );

  assert.equal(extension.isActive, true, "sidebar commands must not deactivate or crash the extension");
  console.log("VSCODE_EXTENSION_HOST_ACTIVATION_AND_COMMANDS_OK");
}
