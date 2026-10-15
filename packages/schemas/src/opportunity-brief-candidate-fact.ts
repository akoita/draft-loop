import { opportunityBriefSourceClassifications } from "@draft-loop/domain";
import type { z } from "zod";

/**
 * A fact the candidate typed in, such as the employer when the job posting names none. Its source
 * is a `candidate-input` source with this classification, so the value is never attributed to the
 * job posting. It is separate from `candidate-instruction`, which steers the draft and is never a
 * fact about the opportunity.
 */
export const candidateProvidedFactClassification = "candidate-provided-fact" as const;

/** Every source classification a brief may record, including the candidate-provided fact. */
export const opportunityBriefSourceClassificationValues = [
  ...opportunityBriefSourceClassifications,
  candidateProvidedFactClassification,
] as const;

/** How a cited source is checked against the field that cites it. */
export type OpportunityBriefReferenceMode =
  | "any"
  | "extracted"
  | "candidate-instruction"
  | "candidate-provided";

interface ClassifiedSource {
  readonly id: string;
  readonly classification: string;
  readonly provenance: { readonly kind: string };
}

/** The reason a field in `mode` may not cite `source`, or `undefined` when it may. */
export function opportunityBriefReferenceViolation(
  mode: OpportunityBriefReferenceMode,
  source: Pick<ClassifiedSource, "classification">,
): string | undefined {
  const instruction = source.classification === "candidate-instruction";
  const provided = source.classification === candidateProvidedFactClassification;
  if (mode === "extracted" && instruction) {
    return "extracted opportunity facts must not cite candidate-instruction sources";
  }
  if (mode === "extracted" && provided) {
    return "extracted opportunity facts must not cite candidate-provided sources";
  }
  if (mode === "candidate-instruction" && !instruction) {
    return "candidate instruction fields must cite candidate-instruction sources";
  }
  if (mode === "candidate-provided" && !provided) {
    return "a candidate-provided employer must cite only candidate-provided sources";
  }
  return undefined;
}

/**
 * The employer is the one extracted fact the candidate may supply. It is candidate-provided as
 * soon as it cites a candidate-provided source, and then every source it cites must be one.
 */
export function employerReferenceMode(
  employer: { readonly sourceIds: readonly string[] },
  sourcesById: ReadonlyMap<string, Pick<ClassifiedSource, "classification">>,
): "extracted" | "candidate-provided" {
  return employer.sourceIds.some(
    (id) => sourcesById.get(id)?.classification === candidateProvidedFactClassification,
  )
    ? "candidate-provided"
    : "extracted";
}

/** The reason a source may not use the candidate-provided classification, if any. */
export function candidateProvidedSourceViolation(
  source: Pick<ClassifiedSource, "classification" | "provenance">,
): string | undefined {
  return source.classification === candidateProvidedFactClassification &&
    source.provenance.kind !== "candidate-input"
    ? "candidate-provided sources must be candidate-input sources"
    : undefined;
}

/** Whether a sourced value is the candidate's own entry rather than something the posting says. */
export function isCandidateProvidedSourcedText(
  value: { readonly sourceIds: readonly string[] } | null,
  sources: readonly Pick<ClassifiedSource, "id" | "classification">[],
): boolean {
  if (value === null || value.sourceIds.length === 0) return false;
  return value.sourceIds.every(
    (id) =>
      sources.find((source) => source.id === id)?.classification ===
      candidateProvidedFactClassification,
  );
}

/** Adds an issue for each cited source id that is unknown or not allowed for `mode`. */
export function addOpportunityBriefSourceReferenceIssues(
  references: readonly string[],
  path: readonly PropertyKey[],
  sourcesById: ReadonlyMap<string, Pick<ClassifiedSource, "classification">>,
  context: z.RefinementCtx,
  mode: OpportunityBriefReferenceMode,
): void {
  for (const [index, sourceId] of references.entries()) {
    const source = sourcesById.get(sourceId);
    const referencePath = [...path, "sourceIds", index];
    const violation =
      source === undefined
        ? "sourceId must resolve to a source"
        : opportunityBriefReferenceViolation(mode, source);
    if (violation !== undefined) {
      context.addIssue({ code: "custom", path: referencePath, message: violation });
    }
  }
}
