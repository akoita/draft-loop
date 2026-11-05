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
  maximumCoverageJudgementCitedBlocks,
  maximumCoverageJudgementRequests,
} from "@draft-loop/validation";

import { CliUserError } from "./cli-user-error.js";
import {
  coverageJudgementInstructionsVersion,
  criticReportsFindingTargets,
  maximumCritiqueFindings,
  maximumCritiqueMessageCharacters,
  withCoverageJudgementInstructions,
} from "./critic-adjudication.js";
import { normalizeEmphasisSeverity } from "./critic-emphasis.js";
import { capBlockingOmissions } from "./critic-omission.js";
import { keepWithinFindingLimit, truncateFindingMessage } from "./critique-repair.js";

/** The most candidate blocks shown as hints for one coverage-judgement request. */
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
 * The critique schema whose findings carry their target (#2232). Every target field is required
 * and an empty string means "none", so providers' strict modes accept the schema without nullable
 * types; the parser drops an empty or unknown id.
 */
const findingTargetFields = ["claimId", "sectionId", "requirementId"] as const;

export const targetedCritiqueOutputSchema: JsonObject = withFindingTargets(critiqueOutputSchema);

function withFindingTargets(schema: JsonObject): JsonObject {
  const properties = schema.properties as JsonObject;
  const findings = properties.findings as JsonObject;
  const items = findings.items as JsonObject;
  return {
    ...schema,
    properties: {
      ...properties,
      findings: {
        ...findings,
        items: {
          ...items,
          properties: {
            ...(items.properties as JsonObject),
            claimId: { type: "string" },
            sectionId: { type: "string" },
            requirementId: { type: "string" },
          },
          required: [...(items.required as readonly string[]), ...findingTargetFields],
        },
      },
    },
  };
}

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
            maxItems: maximumCoverageJudgementCitedBlocks,
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

/** The targeted critique schema plus `coverageJudgements`, for a version that reports targets. */
export const targetedCritiqueOutputSchemaWithCoverageJudgements: JsonObject = withFindingTargets(
  critiqueOutputSchemaWithCoverageJudgements,
);

/** The `draft_critique` output schema a critic prompt version asks for. */
export function critiqueOutputSchemaFor(templateVersion: string): JsonObject {
  return criticReportsFindingTargets(templateVersion)
    ? targetedCritiqueOutputSchemaWithCoverageJudgements
    : critiqueOutputSchemaWithCoverageJudgements;
}

/**
 * Keep only the finding targets the reviewed artifact and the job actually have. A target the
 * critic names but the artifact lacks would make the readiness report refuse the round, so it is
 * dropped and the finding falls back to the next target, or to the whole artifact.
 */
export function withResolvableFindingTargets<T extends Critique>(
  critique: T,
  artifact: Pick<DraftArtifact, "claims" | "sections">,
  context: Pick<ContextSnapshot, "requirements">,
): T {
  const targeted = critique.findings.some(
    ({ claimId, sectionId, requirementId }) =>
      claimId !== undefined || sectionId !== undefined || requirementId !== undefined,
  );
  if (!targeted) return critique;
  const claims = new Set<string>(artifact.claims.map(({ id }) => id));
  const sections = new Set<string>(artifact.sections.map(({ id }) => id));
  const requirements = new Set<string>(context.requirements.map(({ id }) => id));
  return {
    ...critique,
    findings: critique.findings.map((finding) => {
      const { claimId, sectionId, requirementId, ...rest } = finding;
      return {
        ...rest,
        ...(claimId !== undefined && claims.has(claimId) ? { claimId } : {}),
        ...(sectionId !== undefined && sections.has(sectionId) ? { sectionId } : {}),
        ...(requirementId !== undefined && requirements.has(requirementId)
          ? { requirementId }
          : {}),
      };
    }),
  };
}

export function invalidCritiqueError(response: ModelResponse<JsonObject>): ProviderAdapterError {
  return new ProviderAdapterError(
    response.provider,
    "invalid-response",
    "The critic returned invalid structured findings.",
    {
      retryable: true,
      ...(response.providerRequestId === null ? {} : { requestId: response.providerRequestId }),
      // The provider billed the response even though it is rejected here (#1967).
      billed: { usage: response.usage, cost: response.cost },
    },
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
      entry.citedBlockIds.length <= maximumCoverageJudgementCitedBlocks &&
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

/** A target id the critic gave, trimmed; an empty string is the schema's "none". */
function targetField<Key extends (typeof findingTargetFields)[number]>(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> {
  if (typeof value !== "string" || value.trim() === "") return {};
  return { [key]: value.trim() } as Partial<Record<Key, string>>;
}

export function parseCritique(value: JsonObject, instructionsVersion?: string): CriticCritique {
  const findings = value.findings;
  if (!Array.isArray(findings))
    throw new CliUserError("The critic returned an invalid findings list.");
  const coverageJudgements = parseCoverageJudgements(value.coverageJudgements);
  // One malformed finding is dropped and a long message is cut (#2234); a critique whose every
  // finding is malformed is refused, so a broken answer never reads as a clean draft.
  const parsed = findings.flatMap((finding) => {
    if (!isRecord(finding)) return [];
    if (
      requiredFindingFields.some(
        (key) => typeof finding[key] !== "string" || (finding[key] as string).trim() === "",
      )
    ) {
      return [];
    }
    return [
      normalizeEmphasisSeverity({
        id: finding.id as string,
        code: finding.code as string,
        category: finding.category as Critique["findings"][number]["category"],
        severity: finding.severity as Critique["findings"][number]["severity"],
        message: truncateFindingMessage(
          finding.message as string,
          maximumCritiqueMessageCharacters,
        ),
        ...targetField("claimId", finding.claimId),
        ...targetField("sectionId", finding.sectionId),
        ...targetField("requirementId", finding.requirementId),
      }),
    ];
  });
  if (findings.length > 0 && parsed.length === 0) {
    throw new CliUserError("The critic returned no valid finding.");
  }
  return {
    findings: capBlockingOmissions(keepWithinFindingLimit(parsed, maximumCritiqueFindings)),
    ...(coverageJudgements === undefined ? {} : { coverageJudgements }),
    ...(instructionsVersion === undefined
      ? {}
      : { coverageJudgementInstructionsVersion: instructionsVersion }),
  };
}

const requiredFindingFields = ["id", "code", "category", "severity", "message"] as const;

/** What coverage-judgement requests add to a critic call; none leaves every part untouched. */
export interface CriticCoverageJudgementParts {
  /** Applies the fixed instruction block to the version-pinned prompt, or returns it as is. */
  readonly systemPrompt: (prompt: string) => string;
  /** Extra input properties; empty when nothing is requested. */
  readonly input: {
    readonly coverageJudgementRequests?: JsonValue;
    readonly candidateDirection?: JsonValue;
    readonly applicationPlan?: JsonValue;
  };
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
 * requirements and `maximumCoverageJudgementCandidateBlocks` hint blocks each. A request whose
 * requirement cannot be resolved is dropped; one without resolvable candidates is kept with an
 * empty list, because the critic judges it against the whole draft.
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
    resolved.push({ requirementId: request.requirementId, requirement, candidates });
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
