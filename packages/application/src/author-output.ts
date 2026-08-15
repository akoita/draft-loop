import { createHash } from "node:crypto";

import {
  createArtifact,
  createArtifactVersion,
  type NewArtifactInput,
} from "@draft-loop/artifacts";
import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type ArtifactEvidenceReference,
  type AuthorArtifactProposal,
  authorArtifactProposalSchema,
  type DraftArtifact,
  type EvidenceSource,
} from "@draft-loop/schemas";
import { z } from "zod";

export interface AuthorArtifactBuildContext {
  readonly language: string;
  readonly evidenceManifest: readonly Pick<EvidenceSource, "id" | "path" | "checksum">[];
}

export interface BuildAuthorArtifactOptions {
  readonly proposal: unknown;
  readonly executionId: string;
  readonly context: AuthorArtifactBuildContext;
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
  readonly currentArtifact?: DraftArtifact | null;
  /** Injectable for deterministic tests; live runs use the current timestamp. */
  readonly createdAt?: string;
}

function validationError(path: PropertyKey[], message: string): z.ZodError {
  return new z.ZodError([{ code: "custom", path, message }]);
}

function executionDigest(executionId: string): string {
  return createHash("sha256").update(executionId, "utf8").digest("hex");
}

function artifactId(executionHash: string): string {
  return `artifact-${executionHash}`;
}

function sectionId(executionHash: string, sectionIndex: number): string {
  return `section-${executionHash}-${sectionIndex}`;
}

function blockId(executionHash: string, sectionIndex: number, blockIndex: number): string {
  return `block-${executionHash}-${sectionIndex}-${blockIndex}`;
}

function claimId(
  executionHash: string,
  sectionIndex: number,
  blockIndex: number,
  claimIndex: number,
): string {
  return `claim-${executionHash}-${sectionIndex}-${blockIndex}-${claimIndex}`;
}

function evidenceReference(
  chunk: ScoredEvidenceChunk,
  source: Pick<EvidenceSource, "path" | "checksum">,
): ArtifactEvidenceReference {
  return {
    sourcePath: source.path,
    sourceChecksum: source.checksum,
    locator: `line:${chunk.lineStart}-${chunk.lineEnd}`,
    excerpt: chunk.text,
  };
}

function normalizeEvidence(
  proposal: AuthorArtifactProposal,
  context: AuthorArtifactBuildContext,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): readonly (readonly ArtifactEvidenceReference[])[] {
  const chunksById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk] as const));
  const sourcesById = new Map(
    context.evidenceManifest.map((source) => [source.id, source] as const),
  );
  const evidenceByClaim: ArtifactEvidenceReference[][] = [];
  const issues: z.core.$ZodIssue[] = [];

  for (const [sectionIndex, section] of proposal.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      for (const [claimIndex, claim] of block.claims.entries()) {
        const references: ArtifactEvidenceReference[] = [];
        for (const [evidenceIndex, chunkId] of claim.evidenceChunkIds.entries()) {
          const chunk = chunksById.get(chunkId);
          const path = [
            "sections",
            sectionIndex,
            "blocks",
            blockIndex,
            "claims",
            claimIndex,
            "evidenceChunkIds",
            evidenceIndex,
          ];
          if (chunk === undefined) {
            issues.push({
              code: "custom",
              path,
              message: "evidence chunk reference is not available in retrieved context",
            });
            continue;
          }
          const source = sourcesById.get(chunk.sourceId);
          if (source === undefined) {
            issues.push({
              code: "custom",
              path,
              message: "evidence chunk source is not available in the evidence manifest",
            });
            continue;
          }
          references.push(evidenceReference(chunk, source));
        }
        evidenceByClaim.push(references);
      }
    }
  }

  if (issues.length > 0) {
    throw new z.ZodError(issues);
  }
  return evidenceByClaim;
}

/**
 * Validate a provider proposal and build the canonical artifact locally.
 * Provider output contributes only content and references to already retrieved
 * local chunks; IDs, timestamps, statuses, evidence excerpts, and version
 * metadata are all application-owned.
 */
export function buildAuthorArtifact(options: BuildAuthorArtifactOptions): DraftArtifact {
  if (options.executionId.trim() === "") {
    throw validationError(["executionId"], "execution id must not be empty");
  }

  const proposal = authorArtifactProposalSchema.parse(options.proposal);
  const retrievedEvidence = options.retrievedEvidence ?? [];
  const evidenceByClaim = normalizeEvidence(proposal, options.context, retrievedEvidence);
  const executionHash = executionDigest(options.executionId);
  const claimCount = proposal.sections.reduce(
    (total, section) =>
      total + section.blocks.reduce((sectionTotal, block) => sectionTotal + block.claims.length, 0),
    0,
  );

  const sections = proposal.sections.map((section, sectionIndex) => {
    const canonicalSectionId = sectionId(executionHash, sectionIndex);
    return {
      id: canonicalSectionId,
      title: section.title,
      kind: section.kind,
      order: sectionIndex,
      blocks: section.blocks.map((block, blockIndex) => {
        const canonicalBlockId = blockId(executionHash, sectionIndex, blockIndex);
        const claimIds = block.claims.map((_, claimIndex) =>
          claimId(executionHash, sectionIndex, blockIndex, claimIndex),
        );
        return {
          id: canonicalBlockId,
          type: block.type,
          text: block.text,
          claimIds,
        };
      }),
    };
  });

  const claims: Array<NewArtifactInput["claims"][number]> = [];
  let flattenedClaimIndex = 0;
  for (const [sectionIndex, section] of proposal.sections.entries()) {
    const canonicalSectionId = sectionId(executionHash, sectionIndex);
    for (const [blockIndex, block] of section.blocks.entries()) {
      const canonicalBlockId = blockId(executionHash, sectionIndex, blockIndex);
      for (const [blockClaimIndex, claim] of block.claims.entries()) {
        claims.push({
          id: claimId(executionHash, sectionIndex, blockIndex, blockClaimIndex),
          text: claim.text,
          sectionId: canonicalSectionId,
          blockId: canonicalBlockId,
          substantive: claim.substantive,
          status: "unverified",
          evidence: [...(evidenceByClaim[flattenedClaimIndex] ?? [])],
        });
        flattenedClaimIndex += 1;
      }
    }
  }

  // Keep the local indexing above explicit: this assertion prevents a future
  // shape change from silently dropping evidence during flattening.
  if (flattenedClaimIndex !== claimCount || evidenceByClaim.length !== claimCount) {
    throw validationError(["sections"], "author proposal claims could not be normalized");
  }

  const input: NewArtifactInput = {
    id: artifactId(executionHash),
    createdAt: options.createdAt ?? new Date().toISOString(),
    language: options.context.language,
    sections,
    claims,
    decisions: [],
  };

  return options.currentArtifact === null || options.currentArtifact === undefined
    ? createArtifact(input)
    : createArtifactVersion(options.currentArtifact, input);
}

/** Alias emphasizing that the function is the proposal normalization boundary. */
export const normalizeAuthorArtifactProposal = buildAuthorArtifact;
