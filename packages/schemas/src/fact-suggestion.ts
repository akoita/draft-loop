import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import {
  type FactSuggestion,
  factSuggestionDeciderRoles,
  factSuggestionDedupeKey,
  factSuggestionDedupeKeyPattern,
  factSuggestionLimits,
  factSuggestionOriginKinds,
  factSuggestionSchemaVersion,
  factSuggestionSpeakers,
  factSuggestionStatuses,
  isTargetedFactSuggestionKind,
} from "@draft-loop/domain/fact-suggestion";
import { z } from "zod";
import { factUsageKeySchema, factUsageLevelSchema } from "./fact-usage.js";
import { strictTimestampSchema } from "./schema-primitives.js";

/**
 * Fact suggestions (#3065): a proposed change to the career profile, stored per candidate record
 * until a person accepts, edits or rejects it. The quote and proposed values are candidate
 * content; the ids, kind, status, origin and dedupe key are not.
 */

export const factSuggestionIdSchema = z
  .string()
  .regex(/^fsg_[A-Za-z0-9_-]{8,64}$/u, "must be a fact suggestion id");

/** Whether a string holds a control character other than the allowed ones. */
function hasControlCharacter(value: string, allowed: readonly number[] = []): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}

function line(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !hasControlCharacter(value), "must be one line of plain text");
}

const identifier = line(factSuggestionLimits.idMax);

export const factSuggestionChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      category: z.enum(canonicalCandidateProfileFactCategories),
      subjectId: identifier.optional(),
      field: line(factSuggestionLimits.fieldMax),
      value: line(factSuggestionLimits.valueMax),
    })
    .strict(),
  z.object({ kind: z.literal("correct"), value: line(factSuggestionLimits.valueMax) }).strict(),
  z.object({ kind: z.literal("retire") }).strict(),
  z.object({ kind: z.literal("set-usage"), usage: factUsageLevelSchema }).strict(),
  z.object({ kind: z.literal("confirm") }).strict(),
]);

export const factSuggestionTargetSchema = z
  .object({ factId: identifier, factKey: factUsageKeySchema })
  .strict();

export const factSuggestionOriginSchema = z
  .object({
    kind: z.enum(factSuggestionOriginKinds),
    applicationId: identifier.optional(),
    runId: identifier.optional(),
    round: z.number().int().min(1).max(100).optional(),
    blockId: identifier.optional(),
    agentClientId: identifier.optional(),
    careerInterviewId: identifier.optional(),
  })
  .strict()
  .refine((origin) => origin.kind !== "agent" || origin.agentClientId !== undefined, {
    message: "an agent origin names its agent client",
    path: ["agentClientId"],
  })
  .refine(
    (origin) => origin.kind !== "career-interview" || origin.careerInterviewId !== undefined,
    {
      message: "a career interview origin names its interview",
      path: ["careerInterviewId"],
    },
  );

export const factSuggestionDecisionSchema = z
  .object({
    role: z.enum(factSuggestionDeciderRoles),
    memberId: identifier,
    decidedAt: strictTimestampSchema,
  })
  .strict();

/** A suggestion as stored and exchanged. Cross-field rules keep kind, target and status in step. */
export const factSuggestionSchema = z
  .object({
    schemaVersion: z.literal(factSuggestionSchemaVersion),
    id: factSuggestionIdSchema,
    profileId: identifier,
    baseVersionId: identifier,
    change: factSuggestionChangeSchema,
    target: factSuggestionTargetSchema.optional(),
    quote: z
      .string()
      .trim()
      .min(factSuggestionLimits.quoteMin)
      .max(factSuggestionLimits.quoteMax)
      .refine((value) => !hasControlCharacter(value, [0x09, 0x0a, 0x0d]), "must be plain text"),
    speaker: z.enum(factSuggestionSpeakers),
    origin: factSuggestionOriginSchema,
    dedupeKey: z.string().regex(factSuggestionDedupeKeyPattern, "must be a fact suggestion key"),
    status: z.enum(factSuggestionStatuses),
    createdAt: strictTimestampSchema,
    decision: factSuggestionDecisionSchema.optional(),
    appliedChange: factSuggestionChangeSchema.optional(),
  })
  .strict()
  .superRefine((suggestion, context) => {
    const targeted = isTargetedFactSuggestionKind(suggestion.change.kind);
    if (targeted !== (suggestion.target !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: targeted
          ? "a change to an existing fact names its target"
          : "an add has no target",
      });
    }
    if (suggestion.dedupeKey !== factSuggestionDedupeKey(suggestion.change, suggestion.target)) {
      context.addIssue({
        code: "custom",
        path: ["dedupeKey"],
        message: "must match the change and target",
      });
    }
    const decided = ["accepted", "edited", "rejected"].includes(suggestion.status);
    if (decided !== (suggestion.decision !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: decided
          ? "a decided suggestion records its decision"
          : "only a decided suggestion records a decision",
      });
    }
    const edited = suggestion.status === "edited";
    if (edited !== (suggestion.appliedChange !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["appliedChange"],
        message: edited
          ? "an edited suggestion records the applied change"
          : "only an edited suggestion records an applied change",
      });
    } else if (edited && suggestion.appliedChange?.kind !== suggestion.change.kind) {
      context.addIssue({
        code: "custom",
        path: ["appliedChange"],
        message: "an edit keeps the change's kind",
      });
    }
  });

export type FactSuggestionRecord = z.infer<typeof factSuggestionSchema>;

/** Compile-time check that the schema and the domain model describe the same shape. */
export const factSuggestionSchemaMatchesDomain: (record: FactSuggestionRecord) => FactSuggestion = (
  record,
) => record;
