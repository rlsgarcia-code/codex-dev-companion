import * as path from "node:path";
import * as vscode from "vscode";
import { validateGatewayCaPem } from "./litellm";

const IMPORTED_GATEWAY_CA_FILENAME = "gateway-ca.pem";

function importedGatewayCaUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, IMPORTED_GATEWAY_CA_FILENAME);
}

export function importedGatewayCaPath(context: vscode.ExtensionContext): string {
  return importedGatewayCaUri(context).fsPath;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

export async function readImportedGatewayCa(
  context: vscode.ExtensionContext
): Promise<Buffer | undefined> {
  try {
    const contents = await vscode.workspace.fs.readFile(importedGatewayCaUri(context));
    validateGatewayCaPem(contents);
    return Buffer.from(contents);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

export async function hasImportedGatewayCa(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(importedGatewayCaUri(context));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch (error) {
    if (isFileNotFound(error)) return false;
    throw error;
  }
}

export async function storeImportedGatewayCa(
  context: vscode.ExtensionContext,
  contents: Uint8Array
): Promise<void> {
  validateGatewayCaPem(contents);
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(importedGatewayCaUri(context), contents);
}

export async function importGatewayCa(
  context: vscode.ExtensionContext,
  source: vscode.Uri
): Promise<void> {
  if (path.extname(source.path).toLowerCase() !== ".pem") {
    throw new Error("Gateway CA certificate must use the .pem extension.");
  }
  await storeImportedGatewayCa(context, await vscode.workspace.fs.readFile(source));
}

export async function clearImportedGatewayCa(context: vscode.ExtensionContext): Promise<void> {
  try {
    await vscode.workspace.fs.delete(importedGatewayCaUri(context), { useTrash: false });
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}
