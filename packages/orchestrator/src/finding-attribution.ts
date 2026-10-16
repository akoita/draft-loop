import type {
  AdjudicatedRevisionAttribution,
  AdjudicatedRevisionTrace,
  AuthorAdjudicationPlan,
  ClassifiedFinding,
  DraftArtifact,
  RevisionBlockAttribution,
  RevisionFindingClassification,
} from "@draft-loop/schemas";
import { revisionFindingClassificationSchemaVersion } from "@draft-loop/schemas";
import { type ValidationIssue, withoutJudgedUncoveredFindings } from "@draft-loop/validation";

import type { CritiqueFinding } from "./index.js";

/*
 * Finding attribution and classification (#1108).
 *
 * The author's structured output is a plain artifact proposal: it cannot name the finding ids a
 * block addresses. Attribution is therefore derived, not reported by the model: a block counts as
 * addressing the accepted findings that targeted it (a claim finding targets that claim's block, a
 * section finding every changed block of that section) when the block changed in the revision.
 *
 * Artifact, section, block and claim ids are minted per execution, so none survives a revision.
 * Blocks and findings are therefore matched by position, never by id. See `findingIdentity`.
 */

type AdjudicatedTarget = AuthorAdjudicationPlan["decisions"][number]["target"];

interface IdentifiableFinding {
  readonly code: string;
  readonly target: AdjudicatedTarget;
}

/** Lower-case the code and collapse every non-alphanumeric run, so `Weak_Bullet` equals `weak-bullet`. */
export function normalizeFindingCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function sectionKeys(artifact: DraftArtifact): ReadonlyMap<string, string> {
  const seenByKind = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const section of artifact.sections) {
    const occurrence = seenByKind.get(section.kind) ?? 0;
    seenByKind.set(section.kind, occurrence + 1);
    keys.set(section.id, `${section.kind}#${occurrence}`);
  }
  return keys;
}

interface IndexedBlock {
  readonly key: string;
  readonly id: string;
  readonly signature: string;
}

function indexBlocks(artifact: DraftArtifact): readonly IndexedBlock[] {
  const keys = sectionKeys(artifact);
  return artifact.sections.flatMap((section) =>
    section.blocks.map((block, index) => ({
      key: `${keys.get(section.id)}/b${index}`,
      id: block.id,
      signature: JSON.stringify([block.type, block.text]),
    })),
  );
}

function claimBlockKey(artifact: DraftArtifact, claimId: string): string | undefined {
  const claim = artifact.claims.find(({ id }) => id === claimId);
  if (claim === undefined) return undefined;
  return indexBlocks(artifact).find(({ id }) => id === claim.blockId)?.key;
}

function targetLocator(target: AdjudicatedTarget, artifact: DraftArtifact): string {
  switch (target.kind) {
    case "claim":
      return claimBlockKey(artifact, target.id) ?? `unresolved:${target.id}`;
    case "section":
      return sectionKeys(artifact).get(target.id) ?? `unresolved:${target.id}`;
    case "artifact":
      return "artifact";
    case "requirement":
    case "evidence":
    case "rubric":
      return target.id;
  }
}

/**
 * The deterministic key that matches one finding to its counterpart in another round:
 * `normalizedCode | targetKind | locator`.
 *
 * - `code` is the finding code, lower-cased with punctuation runs collapsed to `-`.
 * - `targetKind` is claim, section, requirement, evidence, rubric or artifact.
 * - `locator` is positional for blocks: a claim target becomes the key of its block
 *   (`<sectionKind>#<n>/b<i>`, the n-th section of that kind and the i-th block in it) and a
 *   section target becomes `<sectionKind>#<n>`. Requirement, evidence and rubric ids are stable
 *   context ids and stay as they are; an artifact target is just `artifact`.
 *
 * `artifact` is the artifact the finding was raised on, used to resolve claim and section ids.
 * Messages, ids and severity are deliberately not part of the key. Findings that share a key are
 * one finding: near-duplicates in one block collapse, and a critic that rewords its code or a
 * revision that moves a block makes a match fail.
 */
export function findingIdentity(finding: IdentifiableFinding, artifact: DraftArtifact): string {
  return [
    normalizeFindingCode(finding.code),
    finding.target.kind,
    targetLocator(finding.target, artifact),
  ].join("|");
}

/** Where a validation or critique finding points, with the same precedence the readiness report uses. */
export function targetOf(
  artifact: DraftArtifact,
  finding: {
    readonly claimId?: string | undefined;
    readonly sectionId?: string | undefined;
    readonly requirementId?: string | undefined;
  },
): AdjudicatedTarget {
  if (finding.claimId !== undefined) return { kind: "claim", id: finding.claimId };
  if (finding.sectionId !== undefined) return { kind: "section", id: finding.sectionId };
  if (finding.requirementId !== undefined)
    return { kind: "requirement", id: finding.requirementId };
  return { kind: "artifact", id: artifact.id };
}

/**
 * One edit of a targeted revision (#1112) as applied to the artifact, keyed by positional block
 * key. A replace and a delete name the block they changed in the source artifact; a replace and an
 * insert name the block they produced in the revised artifact.
 */
export interface AppliedRevisionEdit {
  readonly op: "replace" | "insert" | "delete";
  readonly sourceBlockKey?: string;
  readonly revisedBlockKey?: string;
  /** The accepted findings the author said this edit addresses. */
  readonly findingIds: readonly string[];
}

/**
 * Attribution from the author's own edits: exact, where `attributeRevision` has to infer it from
 * the diff. An edit whose resulting block no longer exists (grounding left it out) is dropped, and
 * the findings it named that no other edit covers are reported as unattributed.
 */
function attributeFromEdits(
  input: {
    readonly plan: AuthorAdjudicationPlan;
    readonly sourceArtifact: DraftArtifact;
    readonly revisedArtifact: DraftArtifact;
  },
  edits: readonly AppliedRevisionEdit[],
): AdjudicatedRevisionAttribution {
  const { plan, sourceArtifact, revisedArtifact } = input;
  const source = new Map(indexBlocks(sourceArtifact).map((block) => [block.key, block]));
  const revised = new Map(indexBlocks(revisedArtifact).map((block) => [block.key, block]));
  const accepted = plan.decisions
    .filter(({ disposition }) => disposition === "accept")
    .map(({ findingId }) => findingId);

  const entries = new Map<
    string,
    { blockId: string; change: RevisionBlockAttribution["change"]; findingIds: Set<string> }
  >();
  for (const edit of edits) {
    const key = edit.op === "delete" ? edit.sourceBlockKey : edit.revisedBlockKey;
    const block =
      key === undefined ? undefined : (edit.op === "delete" ? source : revised).get(key);
    if (key === undefined || block === undefined) continue;
    const change = edit.op === "delete" ? "removed" : edit.op === "insert" ? "added" : "changed";
    const findingIds = edit.findingIds.filter((id) => accepted.includes(id));
    const entry = entries.get(key);
    if (entry === undefined) {
      entries.set(key, { blockId: block.id, change, findingIds: new Set(findingIds) });
    } else {
      // A delete and an insert that land on one position read as one changed block.
      entries.set(key, {
        blockId: edit.op === "delete" ? entry.blockId : block.id,
        change: entry.change === change ? change : "changed",
        findingIds: new Set([...entry.findingIds, ...findingIds]),
      });
    }
  }

  const attributed = new Set([...entries.values()].flatMap(({ findingIds }) => [...findingIds]));
  return {
    source: "edits",
    findings: plan.decisions.map((decision) => ({
      findingId: decision.findingId,
      findingIdentity: findingIdentity(decision, sourceArtifact),
    })),
    blocks: [...entries].map(([blockKey, { blockId, change, findingIds }]) => ({
      blockKey,
      blockId,
      change,
      findingIds: [...findingIds],
    })),
    unattributedFindingIds: accepted.filter((id) => !attributed.has(id)),
  };
}

/**
 * List every changed block with the accepted findings that targeted it, and record every
 * adjudicated finding's identity. Accepted findings no changed block can be tied to are listed as unattributed.
 */
export function attributeRevision(input: {
  readonly plan: AuthorAdjudicationPlan;
  readonly sourceArtifact: DraftArtifact;
  readonly revisedArtifact: DraftArtifact;
  /** The edits a targeted revision applied; when present they replace the derived attribution. */
  readonly edits?: readonly AppliedRevisionEdit[];
}): AdjudicatedRevisionAttribution {
  const { plan, sourceArtifact, revisedArtifact } = input;
  if (input.edits !== undefined) return attributeFromEdits(input, input.edits);
  const source = new Map(indexBlocks(sourceArtifact).map((block) => [block.key, block]));
  const revised = indexBlocks(revisedArtifact);
  const revisedKeys = new Set(revised.map(({ key }) => key));

  const changed = new Map<string, Omit<RevisionBlockAttribution, "findingIds">>();
  for (const block of revised) {
    const before = source.get(block.key);
    if (before === undefined) {
      changed.set(block.key, { blockKey: block.key, blockId: block.id, change: "added" });
    } else if (before.signature !== block.signature) {
      changed.set(block.key, { blockKey: block.key, blockId: block.id, change: "changed" });
    }
  }
  for (const block of source.values()) {
    if (!revisedKeys.has(block.key)) {
      changed.set(block.key, { blockKey: block.key, blockId: block.id, change: "removed" });
    }
  }

  const findingIdsByBlock = new Map<string, string[]>();
  const unattributedFindingIds: string[] = [];
  const sourceSectionKeys = sectionKeys(sourceArtifact);
  for (const decision of plan.decisions) {
    if (decision.disposition !== "accept") continue;
    let keys: string[] = [];
    if (decision.target.kind === "claim") {
      const key = claimBlockKey(sourceArtifact, decision.target.id);
      keys = key !== undefined && changed.has(key) ? [key] : [];
    } else if (decision.target.kind === "section") {
      const section = sourceSectionKeys.get(decision.target.id);
      keys = [...changed.keys()].filter(
        (key) => section !== undefined && key.startsWith(`${section}/`),
      );
    }
    if (keys.length === 0) {
      unattributedFindingIds.push(decision.findingId);
    }
    for (const key of keys) {
      findingIdsByBlock.set(key, [...(findingIdsByBlock.get(key) ?? []), decision.findingId]);
    }
  }

  return {
    findings: plan.decisions.map((decision) => ({
      findingId: decision.findingId,
      findingIdentity: findingIdentity(decision, sourceArtifact),
    })),
    blocks: [...changed.values()].map((block) => ({
      ...block,
      findingIds: findingIdsByBlock.get(block.blockKey) ?? [],
    })),
    unattributedFindingIds,
  };
}

export interface ClassifyRevisionFindingsInput {
  /** The adjudicated revision trace the critic pass follows. */
  readonly trace: AdjudicatedRevisionTrace;
  /** The artifact the critic reviewed; it must be the trace's revised artifact. */
  readonly reviewedArtifact: DraftArtifact;
  /** Deterministic findings on the reviewed artifact. */
  readonly deterministicFindings: readonly ValidationIssue[];
  /** Findings from the critic pass. */
  readonly critiqueFindings: readonly CritiqueFinding[];
  /** Requirements the critic judged satisfied; they settle their coverage findings. */
  readonly judgedRequirementIds?: readonly string[];
}

/**
 * Classify the accepted findings of the trace after the next critic pass. An accepted finding is
 * `persisting` when a finding with the same identity is raised again, otherwise `resolved`. A
 * finding of this pass whose identity matches no adjudicated finding is `new`. A recurrence of a
 * rejected or nuanced finding is a preserved disagreement and is not classified. Returns undefined
 * for a trace without attribution or when the critic reviewed some other artifact.
 */
export function classifyRevisionFindings(
  input: ClassifyRevisionFindingsInput,
): RevisionFindingClassification | undefined {
  const { trace, reviewedArtifact } = input;
  if (
    trace.attribution === undefined ||
    reviewedArtifact.id !== trace.revisedArtifact.id ||
    reviewedArtifact.version !== trace.revisedArtifact.version
  ) {
    return undefined;
  }
  const identities = new Map(
    trace.attribution.findings.map(({ findingId, findingIdentity: key }) => [findingId, key]),
  );

  const raised = [
    ...input.deterministicFindings.map((finding, index) => ({
      id: `deterministic:${index}:${finding.code}`,
      finding,
    })),
    ...input.critiqueFindings.map((finding, index) => ({
      id: `critic:${index}:${finding.id}`,
      finding,
    })),
  ];
  const settled = new Set(
    withoutJudgedUncoveredFindings(
      raised.map(({ finding }) => finding),
      input.judgedRequirementIds ?? [],
    ),
  );
  const current = new Map<string, { id: string; severity: ClassifiedFinding["severity"] }>();
  for (const { id, finding } of raised) {
    if (!settled.has(finding)) continue;
    const key = findingIdentity(
      { code: finding.code, target: targetOf(reviewedArtifact, finding) },
      reviewedArtifact,
    );
    if (!current.has(key)) current.set(key, { id, severity: finding.severity });
  }

  const findings: ClassifiedFinding[] = [];
  for (const decision of trace.adjudication.decisions) {
    const key = identities.get(decision.findingId);
    if (decision.disposition !== "accept" || key === undefined) continue;
    const match = current.get(key);
    findings.push({
      status: match === undefined ? "resolved" : "persisting",
      findingId: decision.findingId,
      findingIdentity: key,
      severity: decision.severity,
      ...(match === undefined ? {} : { currentFindingId: match.id }),
    });
  }
  const adjudicated = new Set(identities.values());
  for (const [key, { id, severity }] of current) {
    if (!adjudicated.has(key)) {
      findings.push({ status: "new", findingId: id, findingIdentity: key, severity });
    }
  }

  const count = (status: ClassifiedFinding["status"]): number =>
    findings.filter((entry) => entry.status === status).length;
  return {
    schemaVersion: revisionFindingClassificationSchemaVersion,
    reviewedArtifact: { id: reviewedArtifact.id, version: reviewedArtifact.version },
    findings,
    summary: { resolved: count("resolved"), persisting: count("persisting"), new: count("new") },
  };
}
