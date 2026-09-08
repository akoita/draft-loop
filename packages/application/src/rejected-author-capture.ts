import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type JsonObject, type ModelResponse, ProviderAdapterError } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";

import {
  type BuildAuthorArtifactOptions,
  buildAuthorArtifact,
  invalidAuthorProposalError,
} from "./author-output.js";

/** Opt-in local capture; the caller owns retention of sensitive replay inputs. */
export async function buildAuthorArtifactWithCapture(
  response: ModelResponse<JsonObject>,
  inputs: Omit<BuildAuthorArtifactOptions, "proposal">,
  captureDirectory?: string,
): Promise<DraftArtifact> {
  const validationInputs = { ...inputs, proposal: response.output };
  try {
    return buildAuthorArtifact(validationInputs);
  } catch (error) {
    const rejection = invalidAuthorProposalError(response, error);
    if (captureDirectory === undefined) throw rejection;
    let captureCode = "local_author_capture_saved";
    try {
      // An unpredictable private subdirectory prevents replacement of existing captures.
      // The explicitly selected parent must already exist; no workspace defaults apply.
      if (captureDirectory.trim() === "") throw new Error("Missing capture directory");
      const directory = await mkdtemp(join(captureDirectory, "rejected-author-"));
      await writeFile(
        join(directory, "replay.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            provider: response.provider,
            modelId: response.modelId,
            validationInputs,
            failureStage: rejection.failureStage,
            diagnostics: rejection.diagnostics,
          },
          null,
          2,
        )}\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      captureCode = "local_author_capture_failed";
    }
    throw new ProviderAdapterError(rejection.provider, rejection.code, rejection.message, {
      ...rejection.metadata,
      retryable: rejection.retryable,
      diagnostics: [...rejection.diagnostics, { code: captureCode, path: "" }],
    });
  }
}
