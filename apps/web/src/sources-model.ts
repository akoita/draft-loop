import { ApiRequestError, type ApiSchemas } from "./api-client.js";
import { describeActionError } from "./consent-model.js";

/** The media types the API takes for a candidate source, by file extension. */
const mediaTypes: Readonly<Record<string, SourceMediaType>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
};

export type SourceMediaType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/markdown"
  | "text/plain";

export const acceptedSourceFiles = ".pdf,.docx,.md,.markdown,.txt";

const unsupportedMessage = "DraftLoop takes PDF, DOCX, Markdown and text files.";

/** The media type to upload a file as, from its name; the API checks it against the bytes. */
export function sourceMediaType(fileName: string): SourceMediaType | undefined {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : mediaTypes[extension];
}

/** Why a file cannot be uploaded before sending it, or `undefined` when it can. */
export function sourceFileProblem(file: { readonly name: string; readonly size: number }) {
  if (sourceMediaType(file.name) === undefined) return `${file.name}: ${unsupportedMessage}`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.name.length > 200) return "Rename the file to 200 characters or fewer.";
  if ([...file.name].some((character) => character < " " || "\u007f/\\".includes(character)))
    return "Rename the file without slashes or control characters.";
  return undefined;
}

/** What to tell the member when an upload is refused, pointing to a missing consent. */
export function uploadErrorMessage(fileName: string, error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 413) return `${fileName} is larger than this service accepts.`;
    if (error.status === 415) return `${fileName}: ${unsupportedMessage} ${error.message}`;
  }
  return `${fileName}: ${describeActionError(error)}`;
}

/** A file size as people read it, such as `12 KB` or `1.4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SelectionBody = { knowledgeBaseIds: string[]; combinationApproved?: boolean };

/**
 * The knowledge-selection request, or a problem: runs need at least one base, and combining
 * several needs the owner's explicit approval.
 */
export function selectionRequest(
  selected: readonly string[],
  combinationApproved: boolean,
): { readonly body: SelectionBody } | { readonly problem: string } {
  if (selected.length === 0) return { problem: "Choose at least one knowledge base." };
  if (selected.length > 1 && !combinationApproved)
    return { problem: "Confirm that runs may combine these knowledge bases." };
  return {
    body: {
      knowledgeBaseIds: [...selected],
      ...(selected.length > 1 ? { combinationApproved: true } : {}),
    },
  };
}

/** The bases the owner can still use, oldest first, as the API lists them. */
export function activeBases(
  bases: readonly ApiSchemas["KnowledgeBase"][],
): ApiSchemas["KnowledgeBase"][] {
  return bases.filter((base) => base.archivedAt === null);
}
