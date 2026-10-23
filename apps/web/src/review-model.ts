import type { ApiInput, ApiSchemas } from "./api-client.js";

export type RunReview = ApiSchemas["RunReview"];
export type ReviewDraft = ApiSchemas["ReviewDraft"];
export type Finding = ApiSchemas["ReviewFinding"];
export type Decision = Finding["decision"];
type Claim = ReviewDraft["claims"][number];
type Block = ReviewDraft["sections"][number]["blocks"][number];

/** A block with the claims it makes, each claim with its evidence. */
export interface BlockView {
  readonly block: Block;
  readonly claims: readonly Claim[];
}

/** A draft section with its blocks and the findings about it. */
export interface SectionView {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly BlockView[];
  readonly findings: readonly Finding[];
}

/**
 * The draft as the owner reviews it: each section with its blocks, their claims and evidence,
 * and the findings about the section or one of its claims. Findings about neither are general.
 */
export function reviewSections(
  draft: ReviewDraft,
  findings: readonly Finding[],
): { readonly sections: readonly SectionView[]; readonly general: readonly Finding[] } {
  const claims = new Map(draft.claims.map((claim) => [claim.id, claim]));
  const placed = new Set<string>();
  const sections = draft.sections.map((section) => {
    const claimIds = new Set(section.blocks.flatMap((block) => block.claimIds));
    const own = findings.filter(
      (finding) =>
        finding.sectionId === section.id ||
        (finding.claimId !== undefined && claimIds.has(finding.claimId)),
    );
    for (const finding of own) placed.add(finding.id);
    return {
      id: section.id,
      title: section.title,
      blocks: section.blocks.map((block) => ({
        block,
        claims: block.claimIds.flatMap((id) => {
          const claim = claims.get(id);
          return claim === undefined ? [] : [claim];
        }),
      })),
      findings: own,
    };
  });
  return { sections, general: findings.filter((finding) => !placed.has(finding.id)) };
}

/** The decisions the owner records, each with what it does. */
export const decisionChoices: readonly {
  readonly decision: Exclude<Decision, "pending">;
  readonly label: string;
  readonly effect: string;
}[] = [
  { decision: "accepted", label: "Accept", effect: "the next revision fixes it" },
  { decision: "rejected", label: "Reject", effect: "the finding is wrong" },
  { decision: "overridden", label: "Override", effect: "keep the draft as is, with a reason" },
  { decision: "deferred", label: "Decide later", effect: "an error still blocks approval" },
];

const decisionLabels: Readonly<Record<Decision, string>> = {
  pending: "Not decided",
  accepted: "Accepted",
  rejected: "Rejected",
  overridden: "Overridden",
  deferred: "Decided later",
};

export function decisionLabel(decision: Decision): string {
  return decisionLabels[decision];
}

type DecisionBody =
  ApiInput<"PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision">["body"];

/** The decision request, or why it cannot be sent: an override needs its reason. */
export function decisionRequest(
  decision: Exclude<Decision, "pending">,
  rationale: string,
): { readonly body: DecisionBody } | { readonly problem: string } {
  const reason = rationale.trim();
  if (decision === "overridden" && reason === "")
    return { problem: "Say why the draft stays as it is." };
  return { body: { decision, ...(reason === "" ? {} : { rationale: reason }) } };
}

/** The block-edit limit the API enforces. */
export const maximumBlockCharacters = 4_000;

/** Why an edited block cannot be saved, or `undefined` when it can. */
export function blockEditProblem(text: string): string | undefined {
  if (text.trim() === "") return "A block cannot be empty.";
  if (text.length > maximumBlockCharacters)
    return `Keep a block to ${maximumBlockCharacters} characters.`;
  return undefined;
}

/** Whether the review can still change: decisions and edits need a run awaiting approval. */
export function reviewOpen(review: RunReview): boolean {
  return review.run.state === "awaiting-approval" && review.draft !== null;
}

/** Findings still waiting for a decision. */
export function pendingCount(findings: readonly Finding[]): number {
  return findings.filter((finding) => finding.decision === "pending").length;
}
