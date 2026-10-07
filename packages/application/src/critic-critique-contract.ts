import type { ContextSnapshot } from "@draft-loop/domain";
import type { Critique } from "@draft-loop/orchestrator";
import {
  type JsonObject,
  type JsonValue,
  type ModelResponse,
  ProviderAdapterError,
} from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";
import {
  type CoverageJudgement,
  type CoverageJudgementRequest,
  coverageJudgementVerdicts,
  maximumCoverageJudgementRequests,
} from "@draft-loop/validation";

import { CliUserError } from "./cli-user-error.js";
import {
  coverageJudgementInstructionsVersion,
  maximumCritiqueFindings,
  maximumCritiqueMessageCharacters,
  withCoverageJudgementInstructions,
} from "./critic-adjudication.js";

/** The most candidate blocks shown, and citable, for one coverage-judgement request. */
export const maximumCoverageJudgementCandidateBlocks = 3;

/**
 * A critique that records which coverage-judgement instructions the critic saw. The version is
 * present only when the instruction block was sent, so existing critiques are unchanged.
 */
export interface CriticCritique extends Critique {
  readonly coverageJudgementInstructionsVersion?: string;
}

export const critiqueOutputSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          category: {
            type: "string",
            enum: ["format", "factuality", "coverage", "evidence", "quality"],
          },
          severity: { type: "string", enum: ["error", "warning"] },
          message: { type: "string" },
        },
        required: ["id", "code", "category", "severity", "message"],
      },
    },
  },
  required: ["findings"],
};

/**
 * The critique schema plus `coverageJudgements`. Every property is required and objects are
 * closed so providers' strict structured-output modes accept it; an empty array is allowed.
 */
export const critiqueOutputSchemaWithCoverageJudgements: JsonObject = {
  ...critiqueOutputSchema,
  properties: {
    ...(critiqueOutputSchema.properties as JsonObject),
    coverageJudgements: {
      type: "array",
      maxItems: maximumCoverageJudgementRequests,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirementId: { type: "string" },
          verdict: { type: "string", enum: [...coverageJudgementVerdicts] },
          citedBlockIds: {
            type: "array",
            maxItems: maximumCoverageJudgementCandidateBlocks,
            items: { type: "string" },
          },
          rationale: { type: "string" },
        },
        required: ["requirementId", "verdict", "citedBlockIds", "rationale"],
      },
    },
  },
  required: ["findings", "coverageJudgements"],
};

export function invalidCritiqueError(response: ModelResponse<JsonObject>): ProviderAdapterError {
  return new ProviderAdapterError(
    response.provider,
    "invalid-response",
    "The critic returned invalid structured findings.",
    response.providerRequestId === null
      ? { retryable: true }
      : { retryable: true, requestId: response.providerRequestId },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape-only parsing; malformed entries are dropped one by one, and meaning is checked later. */
function parseCoverageJudgements(value: unknown): readonly CoverageJudgement[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const judgements: CoverageJudgement[] = [];
  for (const entry of (value as readonly unknown[]).slice(0, maximumCoverageJudgementRequests)) {
    if (
      isRecord(entry) &&
      typeof entry.requirementId === "string" &&
      typeof entry.verdict === "string" &&
      Array.isArray(entry.citedBlockIds) &&
      entry.citedBlockIds.length <= maximumCoverageJudgementCandidateBlocks &&
      entry.citedBlockIds.every((blockId: unknown) => typeof blockId === "string") &&
      typeof entry.rationale === "string"
    ) {
      judgements.push({
        requirementId: entry.requirementId,
        verdict: entry.verdict as CoverageJudgement["verdict"],
        citedBlockIds: entry.citedBlockIds as readonly string[],
        rationale: entry.rationale,
      });
    }
  }
  return judgements;
}

export function parseCritique(value: JsonObject, instructionsVersion?: string): CriticCritique {
  const findings = value.findings;
  if (!Array.isArray(findings))
    throw new CliUserError("The critic returned an invalid findings list.");
  if (findings.length > maximumCritiqueFindings) {
    throw new CliUserError("The critic returned too many findings.");
  }
  const coverageJudgements = parseCoverageJudgements(value.coverageJudgements);
  return {
    findings: findings.map((finding) => {
      if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
        throw new CliUserError("The critic returned an invalid finding.");
      }
      const item = finding as Record<string, unknown>;
      const required = ["id", "code", "category", "severity", "message"];
      if (
        required.some((key) => typeof item[key] !== "string" || (item[key] as string).trim() === "")
      ) {
        throw new CliUserError("The critic returned an incomplete finding.");
      }
      if ((item.message as string).length > maximumCritiqueMessageCharacters) {
        throw new CliUserError("The critic returned an excessively long finding message.");
      }
      return {
        id: item.id as string,
        code: item.code as string,
        category: item.category as Critique["findings"][number]["category"],
        severity: item.severity as Critique["findings"][number]["severity"],
        message: item.message as string,
        ...(typeof item.claimId === "string" ? { claimId: item.claimId } : {}),
        ...(typeof item.sectionId === "string" ? { sectionId: item.sectionId } : {}),
        ...(typeof item.requirementId === "string" ? { requirementId: item.requirementId } : {}),
      };
    }),
    ...(coverageJudgements === undefined ? {} : { coverageJudgements }),
    ...(instructionsVersion === undefined
      ? {}
      : { coverageJudgementInstructionsVersion: instructionsVersion }),
  };
}

/** What coverage-judgement requests add to a critic call; none leaves every part untouched. */
export interface CriticCoverageJudgementParts {
  /** Applies the fixed instruction block to the version-pinned prompt, or returns it as is. */
  readonly systemPrompt: (prompt: string) => string;
  /** Extra input properties; empty when nothing is requested. */
  readonly input: { readonly coverageJudgementRequests?: JsonValue };
  readonly outputSchema: JsonObject;
  /** Set only when the instruction block was sent. */
  readonly instructionsVersion?: string;
}

const noCoverageJudgementParts: CriticCoverageJudgementParts = Object.freeze({
  systemPrompt: (prompt: string) => prompt,
  input: Object.freeze({}),
  outputSchema: critiqueOutputSchema,
});

/**
 * Bounded requests with their resolved texts: at most `maximumCoverageJudgementRequests`
 * requirements and `maximumCoverageJudgementCandidateBlocks` blocks each. A request whose
 * requirement or blocks cannot be resolved is dropped.
 */
export function coverageJudgementPromptRequests(
  requests: readonly CoverageJudgementRequest[],
  context: Pick<ContextSnapshot, "requirements">,
  artifact: Pick<DraftArtifact, "sections">,
): readonly JsonObject[] {
  const requirements = new Map<string, string>(
    context.requirements.map(({ id, text }) => [id, text]),
  );
  const blocks = new Map(
    artifact.sections.flatMap((section) => section.blocks).map(({ id, text }) => [id, text]),
  );
  const resolved: JsonObject[] = [];
  for (const request of requests) {
    const requirement = requirements.get(request.requirementId);
    if (requirement === undefined) {
      continue;
    }
    const candidates: JsonObject[] = [];
    for (const blockId of new Set(request.candidateBlockIds)) {
      const text = blocks.get(blockId);
      if (text !== undefined && candidates.length < maximumCoverageJudgementCandidateBlocks) {
        candidates.push({ blockId, text });
      }
    }
    if (candidates.length > 0) {
      resolved.push({ requirementId: request.requirementId, requirement, candidates });
    }
  }
  return resolved.slice(0, maximumCoverageJudgementRequests);
}

/** Without usable requests the critic prompt, input, and schema stay exactly as before. */
export function criticCoverageJudgementParts(
  requests: readonly CoverageJudgementRequest[] | undefined,
  context: Pick<ContextSnapshot, "requirements">,
  artifact: Pick<DraftArtifact, "sections">,
): CriticCoverageJudgementParts {
  const promptRequests = coverageJudgementPromptRequests(requests ?? [], context, artifact);
  if (promptRequests.length === 0) {
    return noCoverageJudgementParts;
  }
  return {
    systemPrompt: withCoverageJudgementInstructions,
    input: { coverageJudgementRequests: promptRequests },
    outputSchema: critiqueOutputSchemaWithCoverageJudgements,
    instructionsVersion: coverageJudgementInstructionsVersion,
  };
}
