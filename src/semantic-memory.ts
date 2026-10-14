import { createHash } from "node:crypto";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import * as vscode from "vscode";
import { LocalChromaServer } from "./chroma";
import { memoryChunks } from "./memory-chunks";

export type SemanticMemoryOptions = {
  query: string;
  memoryText: string;
  embeddingModel: string;
  embeddingsBaseUrl: string;
  apiKey: string;
  defaultHeaders?: Record<string, string | null>;
  fetch?: typeof globalThis.fetch;
  results: number;
};

export class SemanticProjectMemory {
  private readonly server: LocalChromaServer;
  private readonly indexedCollections = new Map<string, string>();

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.server = new LocalChromaServer(context);
  }

  public async recall(options: SemanticMemoryOptions): Promise<string[]> {
    const model = options.embeddingModel.trim();
    if (!model) return [];
    const chunks = memoryChunks(options.memoryText);
    if (!chunks.length) return [];

    const endpoint = await this.server.start();
    const workspaceId = createHash("sha256")
      .update(vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace")
      .digest("hex")
      .slice(0, 20);
    const modelId = createHash("sha256").update(`${model}\0${options.embeddingsBaseUrl}`).digest("hex").slice(0, 12);
    const collectionName = `local-memory-${workspaceId}-${modelId}`;
    const embeddings = new OpenAIEmbeddings({
      model,
      apiKey: options.apiKey,
      batchSize: 64,
      maxConcurrency: 2,
      configuration: {
        baseURL: options.embeddingsBaseUrl,
        ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {})
      }
    });
    const store = new Chroma(embeddings, {
      url: endpoint,
      collectionName
    });

    const memoryHash = createHash("sha256").update(options.memoryText).digest("hex");
    if (this.indexedCollections.get(collectionName) !== memoryHash) {
      await store.delete({ filter: { workspace_id: workspaceId } }).catch(() => undefined);
      const documents = chunks.map((pageContent, index) => new Document({
        pageContent,
        metadata: { workspace_id: workspaceId, source: ".codex-agent/memory.md", chunk: index }
      }));
      const ids = chunks.map((chunk, index) => createHash("sha256")
        .update(`${workspaceId}\0${modelId}\0${index}\0${chunk}`)
        .digest("hex"));
      await store.addDocuments(documents, { ids });
      this.indexedCollections.set(collectionName, memoryHash);
    }

    const matches = await store.similaritySearch(options.query, Math.max(1, Math.min(options.results, 12)), {
      workspace_id: workspaceId
    });
    return matches.map((match) => match.pageContent.trim()).filter(Boolean);
  }
}
