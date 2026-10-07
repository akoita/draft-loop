import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  maximumOpportunityIntakeContentBytes,
  type OpportunitySourceInput,
} from "@draft-loop/application";

import type { OpportunityCreateWorkspaceJobDescriptionSource } from "../bridge.js";

export type WorkspaceJobDescriptionRefusalCode =
  | "permission-denied"
  | "not-found"
  | "operation-failed";

/** A fixed, path-free refusal the renderer can show as written. */
export interface WorkspaceJobDescriptionRefusal {
  readonly code: WorkspaceJobDescriptionRefusalCode;
  readonly message: string;
}

export type WorkspaceJobDescriptionResolution =
  | { readonly ok: true; readonly source: OpportunitySourceInput }
  | { readonly ok: false; readonly refusal: WorkspaceJobDescriptionRefusal };

function refuse(
  code: WorkspaceJobDescriptionRefusalCode,
  message: string,
): WorkspaceJobDescriptionResolution {
  return { ok: false, refusal: { code, message } };
}

/**
 * Turns the renderer's `workspace-job-description` source into an ordinary local-file source.
 *
 * The host alone resolves the workspace's configured job document, so no path crosses the bridge.
 * The document is only handed on after the person approved provider transmission, and an empty or
 * oversized document is refused here with a fixed message instead of reaching the model.
 */
export async function resolveWorkspaceJobDescriptionSource(input: {
  readonly root: string;
  readonly jobDescriptionPath: string;
  readonly source: OpportunityCreateWorkspaceJobDescriptionSource;
  readonly providerTransmissionApproved: boolean;
}): Promise<WorkspaceJobDescriptionResolution> {
  if (!input.providerTransmissionApproved) {
    return refuse(
      "permission-denied",
      "Approve sending the job description to the writing model before extracting requirements.",
    );
  }
  const path = resolve(input.root, input.jobDescriptionPath);
  const fromRoot = relative(resolve(input.root), path);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    return refuse("operation-failed", "The workspace job description is not inside the workspace.");
  }
  const missing = "This workspace has no job description to extract requirements from.";
  let text: string;
  try {
    const details = await stat(path);
    if (!details.isFile()) return refuse("not-found", missing);
    if (details.size > maximumOpportunityIntakeContentBytes) return oversized();
    text = await readFile(path, "utf8");
  } catch {
    return refuse("not-found", missing);
  }
  if (Buffer.byteLength(text, "utf8") > maximumOpportunityIntakeContentBytes) return oversized();
  if (text.trim() === "") return refuse("not-found", missing);
  const capturedAt =
    input.source.capturedAt === undefined ? {} : { capturedAt: input.source.capturedAt };
  return {
    ok: true,
    source: {
      id: input.source.id,
      kind: "local-file",
      classification: input.source.classification,
      path,
      ...capturedAt,
    },
  };
}

function oversized(): WorkspaceJobDescriptionResolution {
  return refuse(
    "operation-failed",
    "The job description is larger than the 64 KiB extraction limit. Shorten it to the role and its requirements, then try again.",
  );
}
