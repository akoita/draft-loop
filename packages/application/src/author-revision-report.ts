import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";

import { completeAuthorClaimCoverage } from "./author-claim-coverage-completion.js";
import { proposalIssueCode } from "./author-diagnostic-counts.js";
import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { extractProtectedValues, supportsProtectedValueInChunks } from "./author-grounding.js";
import { unsupportedSingleWordNames } from "./single-word-name-grounding.js";
import {
  blockCitedChunks,
  dateRangeTexts,
  ungroundedUncoveredWords,
  unsupportedDateRanges,
} from "./uncovered-text-grounding.js";

/** Maximum number of report items sent for one rejected proposal. */
export const maxAuthorRevisionReportItems = 16;

/** Maximum characters of offending proposal text quoted in one item. */
export const maxAuthorRevisionTextCharacters = 400;

const maxProblemsPerItem = 8;
const maxProblemCharacters = 400;
const maxListedValues = 12;

/**
 * One specific validation problem, located in the rejected proposal.
 *
 * The report quotes candidate content, so it is sent only to the author
 * provider and held only in process memory; it never enters run history.
 */
export interface AuthorRevisionReportItem {
  /** Dotted path of the issue in the validated proposal. */
  readonly path: string;
  readonly code: string;
  /** The offending claim or block text, truncated. */
  readonly text: string;
  /** Short, specific statements of what the validator could not support. */
  readonly problems: readonly string[];
}

export interface AuthorRevisionReportInputs {
  readonly proposal: unknown;
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
}

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];
type ProposalClaim = ProposalBlock["claims"][number];

function truncated(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function quoted(values: readonly string[]): string {
  const listed = values.slice(0, maxListedValues).map((value) => JSON.stringify(value));
  const more = values.length - listed.length;
  return `${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * The validator checks the proposal after local citation and coverage
 * completion, so issue paths index into the completed proposal. Replay that
 * completion here; fall back to the raw proposal when it does not parse.
 */
function validatedProposal(
  proposal: unknown,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): AuthorArtifactProposal | undefined {
  try {
    return completeAuthorClaimCoverage(
      completeAuthorEvidenceCitations(
        authorArtifactProposalSchema.parse(proposal),
        retrievedEvidence,
      ),
      retrievedEvidence,
    );
  } catch {
    return undefined;
  }
}

/**
 * The proposal the report's paths index into: the completed proposal the
 * validator checked, or the raw proposal when it does not parse. Send this one
 * to the author so each reported path points at the text it quotes.
 */
export function authorRevisionProposal(validationInputs: AuthorRevisionReportInputs): unknown {
  return (
    validatedProposal(validationInputs.proposal, validationInputs.retrievedEvidence ?? []) ??
    validationInputs.proposal
  );
}

function issuePath(issue: unknown): readonly (string | number)[] {
  if (typeof issue !== "object" || issue === null) return [];
  const path = (issue as { readonly path?: unknown }).path;
  if (!Array.isArray(path)) return [];
  return path.filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number",
  );
}

function issueMessage(issue: unknown): string | undefined {
  if (typeof issue !== "object" || issue === null) return undefined;
  const message = (issue as { readonly message?: unknown }).message;
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
}

/** The deepest object on the path that carries text, or a string at the path itself. */
function textAtPath(root: unknown, path: readonly (string | number)[]): string {
  let node = root;
  let text = "";
  for (const segment of [undefined, ...path]) {
    if (segment !== undefined) {
      if (typeof node !== "object" || node === null) return text;
      node = (node as Record<string | number, unknown>)[segment];
    }
    if (typeof node === "object" && node !== null) {
      const candidate = (node as { readonly text?: unknown }).text;
      if (typeof candidate === "string") text = candidate;
    }
  }
  return text === "" && typeof node === "string" ? node : text;
}

interface Located {
  readonly section?: ProposalSection;
  readonly block?: ProposalBlock;
  readonly claim?: ProposalClaim;
}

function locate(
  proposal: AuthorArtifactProposal | undefined,
  path: readonly (string | number)[],
): Located {
  if (proposal === undefined || path[0] !== "sections" || typeof path[1] !== "number") return {};
  const section = proposal.sections[path[1]];
  if (section === undefined || path[2] !== "blocks" || typeof path[3] !== "number") {
    return section === undefined ? {} : { section };
  }
  const block = section.blocks[path[3]];
  if (block === undefined) return { section };
  if (path[4] !== "claims" || typeof path[5] !== "number") return { section, block };
  const claim = block.claims[path[5]];
  return claim === undefined ? { section, block } : { section, block, claim };
}

function claimInvariantProblems(
  claim: ProposalClaim,
  evidenceById: ReadonlyMap<string, string>,
): readonly string[] {
  const cited = claim.evidenceChunkIds.map((id) => evidenceById.get(id) ?? "");
  return [
    ...distinct(
      extractProtectedValues(claim.text).filter(
        (value) => !supportsProtectedValueInChunks(cited, value),
      ),
    ).map((value) => `protected value ${JSON.stringify(value)} is not stated in cited evidence`),
    ...unsupportedSingleWordNames(claim.text, cited).map(
      (name) => `name ${JSON.stringify(name)} is not stated in cited evidence`,
    ),
  ];
}

function uncoveredTextProblems(
  section: ProposalSection,
  block: ProposalBlock,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): readonly string[] {
  const allChunks = retrievedEvidence.map((chunk) => chunk.text);
  const citedChunks = blockCitedChunks(block, retrievedEvidence);
  const words = ungroundedUncoveredWords(section, block, retrievedEvidence);
  const values = distinct(
    extractProtectedValues(block.text).filter(
      (value) => !supportsProtectedValueInChunks(citedChunks, value),
    ),
  );
  const names = unsupportedSingleWordNames(block.text, allChunks);
  const evidenceRanges = distinct(
    (citedChunks.length > 0 ? citedChunks : allChunks).flatMap(dateRangeTexts),
  );
  const evidenceLabel = citedChunks.length > 0 ? "cited evidence" : "retrieved evidence";
  const rangeSource =
    citedChunks.length > 0 ? "" : "; no claim in this block cites evidence for it";
  const statedRanges =
    evidenceRanges.length > 0
      ? `${evidenceLabel} states: ${quoted(evidenceRanges)}`
      : `${evidenceLabel} states no date range`;
  return [
    ...(words.length === 0
      ? []
      : [
          `text outside substantive claims uses words found in no retrieved evidence: ${quoted(words)}`,
        ]),
    ...values.map(
      (value) =>
        `protected value ${JSON.stringify(value)} is not stated in the evidence cited by this block's claims`,
    ),
    ...names.map((name) => `name ${JSON.stringify(name)} is not stated in any retrieved evidence`),
    ...distinct(unsupportedDateRanges(block.text, citedChunks)).map(
      (range) =>
        `date range ${JSON.stringify(range)} is not stated in cited evidence${rangeSource}; ${statedRanges}`,
    ),
  ];
}

function problemsFor(
  code: string,
  located: Located,
  issue: unknown,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  evidenceById: ReadonlyMap<string, string>,
): readonly string[] {
  const { section, block, claim } = located;
  switch (code) {
    case "missing_evidence":
      return ["this substantive claim cites no evidence"];
    case "unsupported_claim":
      return ["the cited evidence does not relate to this claim"];
    case "factual_invariant_violation": {
      const problems = claim === undefined ? [] : claimInvariantProblems(claim, evidenceById);
      if (problems.length > 0) return problems;
      break;
    }
    case "substantive_text_uncovered": {
      const problems =
        section === undefined || block === undefined
          ? []
          : uncoveredTextProblems(section, block, retrievedEvidence);
      if (problems.length > 0) return problems;
      break;
    }
    default:
      break;
  }
  const message = issueMessage(issue);
  return [`failed the ${JSON.stringify(code)} check${message === undefined ? "" : `: ${message}`}`];
}

/**
 * Build a bounded, specific validation report for a rejected author proposal:
 * each item locates one issue, quotes the offending text, and states the
 * unsupported values, words, names, or date ranges the validator found.
 */
export function buildAuthorRevisionReport(
  validationInputs: AuthorRevisionReportInputs,
  issues: readonly unknown[],
): readonly AuthorRevisionReportItem[] {
  const retrievedEvidence = validationInputs.retrievedEvidence ?? [];
  const evidenceById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk.text] as const));
  const proposal = validatedProposal(validationInputs.proposal, retrievedEvidence);
  return issues.slice(0, maxAuthorRevisionReportItems).map((issue) => {
    const path = issuePath(issue);
    const code = proposalIssueCode(issue) ?? "invalid_proposal";
    const text = textAtPath(proposal ?? validationInputs.proposal, path);
    return {
      path: path.join("."),
      code,
      text: truncated(text, maxAuthorRevisionTextCharacters),
      problems: problemsFor(code, locate(proposal, path), issue, retrievedEvidence, evidenceById)
        .slice(0, maxProblemsPerItem)
        .map((problem) => truncated(problem, maxProblemCharacters)),
    };
  });
}
