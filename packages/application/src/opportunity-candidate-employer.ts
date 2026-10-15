import { createHash } from "node:crypto";
import type { OpportunityBrief } from "@draft-loop/schemas";
import { candidateProvidedFactClassification } from "@draft-loop/schemas";

/** The sources and employer a brief records once the candidate enters the employer. */
export interface CandidateEmployerFields {
  readonly sources: OpportunityBrief["sources"];
  readonly employer: NonNullable<OpportunityBrief["employer"]>;
}

/**
 * The fields that record an employer the candidate typed in. The value gets its own
 * `candidate-input` source classified as a candidate-provided fact, so it is never attributed to
 * the job posting. Only a brief with no employer takes one: an employer the posting names is not
 * overwritten here.
 */
export function candidateEmployerFields(
  base: OpportunityBrief,
  entered: unknown,
  version: number,
  capturedAt: string,
): CandidateEmployerFields {
  if (typeof entered !== "string" || entered.trim() === "") {
    throw new Error("The employer you enter must not be empty.");
  }
  if (base.employer !== null) {
    throw new Error("Only a brief that names no employer can take an employer you enter.");
  }
  const value = entered.trim();
  const id = `candidate-employer-v${version}`;
  return {
    sources: [
      ...base.sources,
      {
        id,
        classification: candidateProvidedFactClassification,
        status: "available",
        provenance: {
          kind: "candidate-input",
          capturedAt,
          checksum: createHash("sha256").update(value, "utf8").digest("hex"),
        },
      },
    ],
    employer: { value, sourceIds: [id] },
  };
}
