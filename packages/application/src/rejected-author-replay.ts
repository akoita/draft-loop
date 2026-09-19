import type {
  JsonObject,
  ModelResponse,
  ProviderFailureStage,
  ProviderValidationDiagnostic,
} from "@draft-loop/providers";
import { draftArtifactSchema } from "@draft-loop/schemas";
import { z } from "zod";

import {
  type BuildAuthorArtifactOptions,
  buildAuthorArtifact,
  invalidAuthorProposalError,
} from "./author-output.js";

const providerSchema = z.enum(["anthropic", "openai", "local"]);
const failureStageSchema = z.enum([
  "transport-parsing",
  "response-schema-validation",
  "artifact-schema-validation",
  "factual-invariant-rejection",
  "output-token-budget-exceeded",
]);
const diagnosticSchema = z.strictObject({
  code: z.string(),
  path: z.string(),
});
const evidenceSourceSchema = z.strictObject({
  id: z.string(),
  path: z.string(),
  checksum: z.string(),
});
const evidenceChunkSchema = z.strictObject({
  id: z.string(),
  workspaceId: z.string(),
  sourceId: z.string(),
  ordinal: z.number().finite().int().nonnegative(),
  lineStart: z.number().finite().int().nonnegative(),
  lineEnd: z.number().finite().int().nonnegative(),
  checksum: z.string(),
  text: z.string(),
  rank: z.number().finite(),
});
const validationInputsSchema = z.strictObject({
  proposal: z.record(z.string(), z.json()),
  executionId: z.string(),
  context: z.strictObject({
    language: z.string(),
    evidenceManifest: z.array(evidenceSourceSchema),
  }),
  retrievedEvidence: z.array(evidenceChunkSchema).optional(),
  requiredSections: z.array(z.string()).optional(),
  currentArtifact: draftArtifactSchema.nullish(),
  createdAt: z.string().optional(),
});

const rejectedAuthorReplayCaptureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  capturedAt: z.string(),
  provider: providerSchema,
  modelId: z.string(),
  validationInputs: validationInputsSchema,
  failureStage: failureStageSchema,
  diagnostics: z.array(diagnosticSchema),
});

export class RejectedAuthorReplayInputError extends Error {
  public constructor() {
    super("Rejected author replay input is invalid.");
    this.name = "RejectedAuthorReplayInputError";
  }
}

export type RejectedAuthorReplayResult =
  | { readonly status: "accepted" }
  | {
      readonly status: "rejected";
      readonly failureStage: ProviderFailureStage;
      readonly diagnostics: readonly ProviderValidationDiagnostic[];
    };

/** Replay one private capture through the live local validation boundary. */
export function replayRejectedAuthorCapture(captureInput: unknown): RejectedAuthorReplayResult {
  const parsed = rejectedAuthorReplayCaptureSchema.safeParse(captureInput);
  if (!parsed.success) throw new RejectedAuthorReplayInputError();

  const capture = parsed.data;
  const validationInputs = capture.validationInputs as BuildAuthorArtifactOptions;
  try {
    buildAuthorArtifact(validationInputs);
    return { status: "accepted" };
  } catch (error) {
    const response: ModelResponse<JsonObject> = {
      output: validationInputs.proposal as JsonObject,
      contextSnapshotId: "replay",
      provider: capture.provider,
      company: capture.provider,
      modelId: capture.modelId,
      providerRequestId: null,
      structuredOutputSha256: "0".repeat(64),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    };
    const rejection = invalidAuthorProposalError(response, error);
    return {
      status: "rejected",
      failureStage: rejection.failureStage ?? "response-schema-validation",
      diagnostics: rejection.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }
}
