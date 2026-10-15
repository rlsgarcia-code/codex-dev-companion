import {
  FilesystemBackend,
  type DeleteResult,
  type EditResult,
  type GlobResult,
  type GrepResult,
  type LsResult,
  type ReadRawResult,
  type ReadResult,
  type WriteResult
} from "deepagents";
import type { ChangeTracker } from "./change-tracker";
import { validateWorkspaceGlob } from "./glob-policy";
import { redactSensitiveText } from "./redaction";
import { isSensitiveWorkspacePath } from "./sensitive-files";

export type FilesystemMutationRequest = {
  operation: "write" | "edit" | "delete";
  filePath: string;
};

export class ReviewableFilesystemBackend extends FilesystemBackend {
  public constructor(
    options: { rootDir: string; virtualMode: boolean; maxFileSizeMb: number },
    private readonly tracker: ChangeTracker,
    private readonly approveMutation: (request: FilesystemMutationRequest) => Promise<boolean> = async (request) => request.operation !== "delete",
    private readonly sensitiveValues: readonly string[] = [],
    private readonly approveSensitiveRead: (filePath: string) => Promise<boolean> = async () => false
  ) {
    super(options);
  }

  public override async read(filePath: string, offset?: number, limit?: number): Promise<ReadResult> {
    if (isSensitiveWorkspacePath(filePath) && !await this.approveSensitiveRead(filePath)) {
      return { error: `Sharing was not approved for potentially sensitive file ${filePath}.` };
    }
    const result = await super.read(filePath, offset, limit);
    return {
      ...result,
      ...(result.error ? { error: redactSensitiveText(result.error, this.sensitiveValues) } : {}),
      ...(typeof result.content === "string"
        ? { content: redactSensitiveText(result.content, this.sensitiveValues) }
        : {})
    };
  }

  public override async readRaw(filePath: string): Promise<ReadRawResult> {
    if (isSensitiveWorkspacePath(filePath) && !await this.approveSensitiveRead(filePath)) {
      return { error: `Sharing was not approved for potentially sensitive file ${filePath}.` };
    }
    const result = await super.readRaw(filePath);
    if (!result.data) {
      return result.error
        ? { ...result, error: redactSensitiveText(result.error, this.sensitiveValues) }
        : result;
    }
    if ("mimeType" in result.data) {
      return {
        ...result,
        data: {
          ...result.data,
          content: typeof result.data.content === "string"
            ? redactSensitiveText(result.data.content, this.sensitiveValues)
            : result.data.content
        }
      };
    }
    return {
      ...result,
      data: {
        ...result.data,
        content: result.data.content.map((line) => redactSensitiveText(line, this.sensitiveValues))
      }
    };
  }

  public override async grep(
    pattern: string,
    searchPath?: string,
    glob?: string | null,
    maxCount?: number | null
  ): Promise<GrepResult> {
    try {
      if (glob) validateWorkspaceGlob(glob);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unsafe glob pattern." };
    }
    const result = await super.grep(pattern, searchPath, glob, maxCount);
    return {
      ...result,
      ...(result.error ? { error: redactSensitiveText(result.error, this.sensitiveValues) } : {}),
      ...(result.matches
        ? {
            matches: result.matches
              .filter((match) => !isSensitiveWorkspacePath(match.path))
              .map((match) => ({
                ...match,
                text: redactSensitiveText(match.text, this.sensitiveValues)
              }))
          }
        : {})
    };
  }

  public override async ls(dirPath: string): Promise<LsResult> {
    const result = await super.ls(dirPath);
    return {
      ...result,
      ...(result.files ? { files: result.files.filter((file) => !isSensitiveWorkspacePath(file.path)) } : {})
    };
  }

  public override async glob(pattern: string, searchPath?: string): Promise<GlobResult> {
    try {
      validateWorkspaceGlob(pattern);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unsafe glob pattern." };
    }
    const result = await super.glob(pattern, searchPath);
    return {
      ...result,
      ...(result.files ? { files: result.files.filter((file) => !isSensitiveWorkspacePath(file.path)) } : {})
    };
  }

  public override async write(filePath: string, content: string): Promise<WriteResult> {
    if (!await this.approveMutation({ operation: "write", filePath })) {
      return { error: `Writing was not approved for ${filePath}.` };
    }
    await this.tracker.captureBefore(filePath);
    const result = await super.write(filePath, content);
    if (!result.error) await this.tracker.captureAfter(filePath);
    return result;
  }

  public override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    if (!await this.approveMutation({ operation: "edit", filePath })) {
      return { error: `Editing was not approved for ${filePath}.` };
    }
    await this.tracker.captureBefore(filePath);
    const result = await super.edit(filePath, oldString, newString, replaceAll);
    if (!result.error) await this.tracker.captureAfter(filePath);
    return result;
  }

  public override async delete(filePath: string): Promise<DeleteResult> {
    if (!await this.approveMutation({ operation: "delete", filePath })) {
      return { error: `Deletion was not approved for ${filePath}.` };
    }
    await this.tracker.captureBefore(filePath);
    const result = await super.delete(filePath);
    if (!result.error) await this.tracker.captureAfter(filePath);
    return result;
  }
}
