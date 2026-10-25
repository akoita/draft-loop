import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ApplicationView } from "@draft-loop/application";

import {
  type ApplicationJobResult,
  maximumApplicationJobTextLength,
} from "@draft-loop/ui/application-job-contract";

/**
 * The job an application is written for, read back for the review screen.
 *
 * The default application (`application` undefined) reads the workspace's own job file; a created
 * application reads its pasted text or chosen file, the same files its readiness reads. A job from
 * an approved page answers with that address, since only its extracted requirements are kept. A
 * file that cannot be read answers `unavailable` rather than failing the review screen.
 */
export async function readApplicationJob(input: {
  readonly workspaceId: string;
  readonly root: string;
  readonly workspaceJobPath: string | undefined;
  readonly application: ApplicationView | undefined;
}): Promise<ApplicationJobResult> {
  const source = input.application?.jobSource;
  if (source?.kind === "approved-url") {
    return {
      workspaceId: input.workspaceId,
      origin: "url",
      text: null,
      truncated: false,
      url: source.url,
    };
  }
  // Kept in the record where the workspace has no files; the desktop's own applications never are.
  if (source?.kind === "stored-text") return jobText(input.workspaceId, "pasted-text", source.text);
  const origin = source === undefined ? "workspace-file" : source.kind;
  const path =
    source === undefined
      ? input.workspaceJobPath
      : source.kind === "pasted-text"
        ? source.storedPath
        : source.path;
  const unavailable: ApplicationJobResult = {
    workspaceId: input.workspaceId,
    origin: "unavailable",
    text: null,
    truncated: false,
    url: null,
  };
  if (path === undefined) return unavailable;
  let text: string;
  try {
    text = (await readFile(resolve(input.root, path), "utf8")).trim();
  } catch {
    return unavailable;
  }
  if (text === "") return unavailable;
  return jobText(input.workspaceId, origin, text);
}

function jobText(
  workspaceId: string,
  origin: ApplicationJobResult["origin"],
  text: string,
): ApplicationJobResult {
  const truncated = text.length > maximumApplicationJobTextLength;
  return {
    workspaceId,
    origin,
    text: truncated ? text.slice(0, maximumApplicationJobTextLength) : text,
    truncated,
    url: null,
  };
}
