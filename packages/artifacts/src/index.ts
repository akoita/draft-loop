import type { EvidenceReference } from "@draft-loop/evidence";
import {
  type ArtifactClaim,
  type ArtifactDecision,
  type ArtifactKind,
  type ArtifactSection,
  artifactSchemaVersion,
  type DraftArtifact,
  draftArtifactSchema,
} from "@draft-loop/schemas";

export type {
  ArtifactBlock,
  ArtifactClaim,
  ArtifactDecision,
  ArtifactKind,
  ArtifactSection,
  DraftArtifact,
} from "@draft-loop/schemas";

export interface NewArtifactInput {
  readonly id: string;
  readonly kind?: ArtifactKind;
  readonly createdAt: string;
  readonly language: string;
  readonly sections: readonly ArtifactSection[];
  readonly claims: readonly ArtifactClaim[];
  readonly decisions: readonly ArtifactDecision[];
}

export interface ArtifactValidationIssue {
  readonly code:
    | "duplicate-id"
    | "missing-section-reference"
    | "section-block-mismatch"
    | "missing-block-reference"
    | "missing-claim-reference"
    | "missing-decision-claim-reference"
    | "unbacked-claim";
  readonly message: string;
  readonly path: string;
  readonly claimId?: string;
}

export interface ArtifactDiff {
  readonly addedClaimIds: readonly string[];
  readonly removedClaimIds: readonly string[];
  readonly changedClaimIds: readonly string[];
  readonly changedEvidenceClaimIds: readonly string[];
  readonly changedSectionIds: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function parseAndFreeze(value: unknown): DraftArtifact {
  return deepFreeze(draftArtifactSchema.parse(value));
}

export function createArtifact(input: NewArtifactInput): DraftArtifact {
  return parseAndFreeze({
    ...input,
    schemaVersion: artifactSchemaVersion,
    version: 1,
    parentVersionId: null,
  });
}

export function createArtifactVersion(
  parent: DraftArtifact,
  next: NewArtifactInput,
): DraftArtifact {
  const parsedParent = draftArtifactSchema.parse(parent);
  if (parsedParent.version < 1 || parsedParent.id.trim() === "") {
    throw new Error("The parent artifact has invalid version metadata.");
  }

  return parseAndFreeze({
    ...next,
    schemaVersion: artifactSchemaVersion,
    version: parsedParent.version + 1,
    parentVersionId: parsedParent.id,
  });
}

export function getUnbackedClaims(artifact: DraftArtifact): readonly ArtifactClaim[] {
  return artifact.claims.filter((claim) => claim.substantive && claim.evidence.length === 0);
}

export const findUnsupportedClaims = getUnbackedClaims;

export function validateArtifactReferences(
  artifact: DraftArtifact,
): readonly ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const sections = new Map<string, number>();
  const blocks = new Map<string, number>();
  const blockSections = new Map<string, string>();
  const claims = new Map<string, number>();
  const addDuplicateIssues = (
    values: readonly { readonly id: string }[],
    kind: ArtifactValidationIssue["code"],
    pathPrefix: string,
  ): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value.id)) {
        issues.push({
          code: kind,
          message: `${kind.replaceAll("-", " ")} for ${value.id}`,
          path: `${pathPrefix}.${index}.id`,
        });
      }
      seen.add(value.id);
    });
  };

  artifact.sections.forEach((section, sectionIndex) => {
    if (sections.has(section.id)) {
      issues.push({
        code: "duplicate-id",
        message: `duplicate section id ${section.id}`,
        path: `sections.${sectionIndex}.id`,
      });
    }
    sections.set(section.id, sectionIndex);
    section.blocks.forEach((block, blockIndex) => {
      if (blocks.has(block.id)) {
        issues.push({
          code: "duplicate-id",
          message: `duplicate block id ${block.id}`,
          path: `sections.${sectionIndex}.blocks.${blockIndex}.id`,
        });
      }
      blocks.set(block.id, blockIndex);
      blockSections.set(block.id, section.id);
    });
  });
  artifact.claims.forEach((claim, index) => {
    claims.set(claim.id, index);
  });
  addDuplicateIssues(artifact.claims, "duplicate-id", "claims");
  addDuplicateIssues(artifact.decisions, "duplicate-id", "decisions");

  artifact.claims.forEach((claim, index) => {
    if (!sections.has(claim.sectionId)) {
      issues.push({
        code: "missing-section-reference",
        message: `claim ${claim.id} references a missing section`,
        path: `claims.${index}.sectionId`,
        claimId: claim.id,
      });
    }
    if (!blocks.has(claim.blockId)) {
      issues.push({
        code: "missing-block-reference",
        message: `claim ${claim.id} references a missing block`,
        path: `claims.${index}.blockId`,
        claimId: claim.id,
      });
    } else if (blockSections.get(claim.blockId) !== claim.sectionId) {
      issues.push({
        code: "section-block-mismatch",
        message: `claim ${claim.id} section does not contain its block`,
        path: `claims.${index}.sectionId`,
        claimId: claim.id,
      });
    }
    if (claim.substantive && claim.evidence.length === 0) {
      issues.push({
        code: "unbacked-claim",
        message: `substantive claim ${claim.id} has no evidence references`,
        path: `claims.${index}.evidence`,
        claimId: claim.id,
      });
    }
  });
  artifact.sections.forEach((section, sectionIndex) => {
    section.blocks.forEach((block, blockIndex) => {
      block.claimIds.forEach((claimId, claimIndex) => {
        if (!claims.has(claimId)) {
          issues.push({
            code: "missing-claim-reference",
            message: `block ${block.id} references a missing claim`,
            path: `sections.${sectionIndex}.blocks.${blockIndex}.claimIds.${claimIndex}`,
          });
        }
      });
    });
  });
  artifact.decisions.forEach((decision, index) => {
    if (decision.claimId !== undefined && !claims.has(decision.claimId)) {
      issues.push({
        code: "missing-decision-claim-reference",
        message: `decision ${decision.id} references a missing claim`,
        path: `decisions.${index}.claimId`,
      });
    }
  });
  return issues;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function serializableArtifact(artifact: DraftArtifact): object {
  return {
    schemaVersion: artifact.schemaVersion,
    id: artifact.id,
    version: artifact.version,
    parentVersionId: artifact.parentVersionId,
    createdAt: artifact.createdAt,
    language: artifact.language,
    sections: artifact.sections.map((section) => ({
      id: section.id,
      title: section.title,
      kind: section.kind,
      order: section.order,
      blocks: section.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        text: block.text,
        claimIds: block.claimIds,
      })),
    })),
    claims: artifact.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sectionId: claim.sectionId,
      blockId: claim.blockId,
      substantive: claim.substantive,
      status: claim.status,
      evidence: claim.evidence.map((reference) => ({
        sourcePath: reference.sourcePath,
        sourceChecksum: reference.sourceChecksum,
        locator: reference.locator,
        excerpt: reference.excerpt,
      })),
    })),
    decisions: artifact.decisions.map((decision) => ({
      id: decision.id,
      type: decision.type,
      rationale: decision.rationale,
      createdAt: decision.createdAt,
      claimId: decision.claimId,
    })),
  };
}

export function stableSerializeArtifact(artifact: DraftArtifact): string {
  return JSON.stringify(stableValue(serializableArtifact(artifact)));
}

function stableClaimWithoutEvidence(claim: ArtifactClaim): string {
  return JSON.stringify(
    stableValue({
      id: claim.id,
      text: claim.text,
      sectionId: claim.sectionId,
      blockId: claim.blockId,
      substantive: claim.substantive,
      status: claim.status,
    }),
  );
}

function stableEvidence(claim: ArtifactClaim): string {
  const references: readonly EvidenceReference[] = claim.evidence;
  return JSON.stringify(stableValue(references));
}

function changedIds<T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
  serialize: (value: T) => string,
): readonly string[] {
  const beforeById = new Map(before.map((value) => [value.id, value]));
  const afterById = new Map(after.map((value) => [value.id, value]));
  return [...afterById.keys()]
    .filter(
      (id) =>
        beforeById.has(id) &&
        serialize(beforeById.get(id) as T) !== serialize(afterById.get(id) as T),
    )
    .sort();
}

export function diffArtifacts(before: DraftArtifact, after: DraftArtifact): ArtifactDiff {
  const beforeClaimIds = new Set(before.claims.map((claim) => claim.id));
  const afterClaimIds = new Set(after.claims.map((claim) => claim.id));
  const beforeClaims = new Map(before.claims.map((claim) => [claim.id, claim]));
  const afterClaims = new Map(after.claims.map((claim) => [claim.id, claim]));

  return {
    addedClaimIds: [...afterClaimIds].filter((id) => !beforeClaimIds.has(id)).sort(),
    removedClaimIds: [...beforeClaimIds].filter((id) => !afterClaimIds.has(id)).sort(),
    changedClaimIds: changedIds(before.claims, after.claims, stableClaimWithoutEvidence),
    changedEvidenceClaimIds: [...afterClaimIds]
      .filter(
        (id) =>
          beforeClaims.has(id) &&
          stableEvidence(beforeClaims.get(id) as ArtifactClaim) !==
            stableEvidence(afterClaims.get(id) as ArtifactClaim),
      )
      .sort(),
    changedSectionIds: changedIds(before.sections, after.sections, (section) =>
      JSON.stringify(stableValue(section)),
    ),
  };
}
