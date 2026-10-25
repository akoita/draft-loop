import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { supportedMediaTypes } from "@draft-loop/ingestion";

import { CliUserError } from "./cli-user-error.js";
import { ensureDirectory, ensureFile } from "./workspace-paths.js";

/**
 * The files a local workspace names: the job description and the folder of evidence sources. A
 * hosted workspace has neither; its job comes from a reviewed brief and its evidence from
 * candidate knowledge bases.
 */
export interface WorkspaceFilesPort {
  /**
   * Whether the workspace keeps files of its own. Without them, an application's pasted job text
   * is kept in the application's record instead of a file beside the history.
   */
  readonly keepsFiles: boolean;
  readonly requireJobDescription: (path: string) => Promise<void>;
  readonly requireSourceDirectory: (path: string) => Promise<void>;
  /** The trimmed job description; refuses an empty one. */
  readonly readJobDescription: (path: string) => Promise<string>;
  /** Supported source files under the path, in a stable order; hidden entries are skipped. */
  readonly listSourceFiles: (path: string) => Promise<readonly string[]>;
}

function isSupportedSourceFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return supportedMediaTypes.some((mediaType) => {
    if (mediaType === "text/plain") return [".txt", ".text"].includes(extension);
    if (mediaType === "text/markdown") return [".md", ".markdown"].includes(extension);
    if (mediaType === "text/html") return [".html", ".htm"].includes(extension);
    if (mediaType === "application/pdf") return extension === ".pdf";
    return extension === ".docx";
  });
}

async function collectSourceFiles(path: string): Promise<readonly string[]> {
  const details = await stat(path);
  if (details.isFile()) return isSupportedSourceFile(path) ? [path] : [];
  if (!details.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) continue;
    files.push(...(await collectSourceFiles(join(path, entry.name))));
  }
  return files;
}

export const localWorkspaceFiles: WorkspaceFilesPort = {
  keepsFiles: true,
  requireJobDescription: (path) => ensureFile(path, "Job description"),
  requireSourceDirectory: (path) => ensureDirectory(path, "Source directory"),
  readJobDescription: async (path) => {
    await ensureFile(path, "Job description");
    const content = (await readFile(path, "utf8")).trim();
    if (content === "") throw new CliUserError("The job description is empty.");
    return content;
  },
  listSourceFiles: collectSourceFiles,
};

/** A workspace without local files, as the hosted service keeps them. */
export const noWorkspaceFiles: WorkspaceFilesPort = {
  keepsFiles: false,
  requireJobDescription: async () => undefined,
  requireSourceDirectory: async () => undefined,
  readJobDescription: async () => {
    throw new CliUserError(
      "This workspace has no job description file; start the run from a reviewed job brief.",
    );
  },
  listSourceFiles: async () => [],
};

const activeFiles = new AsyncLocalStorage<WorkspaceFilesPort>();

/** The workspace files of the driver call in progress; local files unless a driver says otherwise. */
export function workspaceFiles(): WorkspaceFilesPort {
  return activeFiles.getStore() ?? localWorkspaceFiles;
}

export function withWorkspaceFiles<Result>(
  files: WorkspaceFilesPort,
  action: () => Promise<Result>,
): Promise<Result> {
  return activeFiles.run(files, action);
}
