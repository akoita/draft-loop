import {
  contentScreeningSignals,
  contentScreeningVerdicts,
} from "@draft-loop/schemas/content-screening";
import type {
  ContentScreeningRelease,
  StoredContentScreeningResult,
} from "@draft-loop/storage/content-screening";
import { z } from "zod";

/**
 * What the API shows of injection screening (ADR 0011, phase 2d). Every shape is content-free:
 * verdicts, closed signal codes and ids, never a quote of the screened text.
 */

const verdictSchema = z.enum(contentScreeningVerdicts);
const signalSchema = z.enum(contentScreeningSignals);

export const screeningOutcomeSchema = z
  .object({
    resultId: z.string().describe("The stored result; the id a release names."),
    verdict: verdictSchema.describe(
      "clear lets the text through. flagged and unscreened quarantine it until a release.",
    ),
    signals: z.array(signalSchema).describe("The closed codes the screeners reported."),
  })
  .meta({ id: "ScreeningOutcome" });

export type ScreeningOutcome = z.infer<typeof screeningOutcomeSchema>;

export const opportunityScreeningSchema = z
  .object({
    verdict: verdictSchema.describe("The worst verdict among the brief's sources."),
    signals: z.array(signalSchema),
    sources: z.array(screeningOutcomeSchema.extend({ sourceId: z.string() })),
  })
  .meta({ id: "OpportunityScreening" });

export type OpportunityScreening = z.infer<typeof opportunityScreeningSchema>;

/** A stored result as the API shows it. */
export function screeningOutcome(stored: StoredContentScreeningResult): ScreeningOutcome {
  return {
    resultId: stored.id,
    verdict: stored.result.verdict,
    signals: [...stored.result.signals],
  };
}

const verdictRank = { clear: 0, unscreened: 1, flagged: 2 } as const;

/** One summary of a brief's sources: the worst verdict and every signal found. */
export function opportunityScreening(
  sources: readonly { readonly sourceId: string; readonly stored: StoredContentScreeningResult }[],
): OpportunityScreening {
  const worst = sources.reduce<ScreeningOutcome["verdict"]>(
    (verdict, { stored }) =>
      verdictRank[stored.result.verdict] > verdictRank[verdict] ? stored.result.verdict : verdict,
    "clear",
  );
  return {
    verdict: worst,
    signals: [...new Set(sources.flatMap(({ stored }) => stored.result.signals))].sort(),
    sources: sources.map(({ sourceId, stored }) => ({ sourceId, ...screeningOutcome(stored) })),
  };
}

export const screeningReleaseSchema = z
  .object({
    resultId: z.string(),
    memberId: z.string().describe("The releasing member, or `owner-token` for the owner token."),
    reason: z.string(),
    releasedAt: z.string(),
  })
  .meta({ id: "ScreeningRelease" });

export function screeningReleaseView(release: ContentScreeningRelease) {
  return {
    resultId: release.resultId,
    memberId: release.memberId,
    reason: release.reason,
    releasedAt: release.releasedAt,
  };
}

/** One piece of quarantined material a run would use. */
export const quarantinedMaterialSchema = z
  .discriminatedUnion("kind", [
    screeningOutcomeSchema.extend({
      kind: z.literal("job-source"),
      briefId: z.string(),
      sourceId: z.string(),
    }),
    screeningOutcomeSchema.extend({
      kind: z.literal("knowledge-source-version"),
      knowledgeBaseId: z.string(),
      sourceId: z.string(),
      sourceVersionId: z.string(),
    }),
  ])
  .meta({ id: "QuarantinedMaterial" });

export type QuarantinedMaterial = z.infer<typeof quarantinedMaterialSchema>;

/** A run refused because material it would use is quarantined and not released. */
export class MaterialQuarantinedError extends Error {
  override readonly name = "MaterialQuarantinedError";
  readonly quarantined: readonly QuarantinedMaterial[];

  constructor(quarantined: readonly QuarantinedMaterial[]) {
    super(
      "Material this run would use is quarantined by injection screening. Release it, or replace it, before running.",
    );
    this.quarantined = quarantined;
  }
}
