import { createHash } from "node:crypto";

import {
  createArtifact,
  createArtifactVersion,
  type NewArtifactInput,
} from "@draft-loop/artifacts";
import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type JsonObject,
  type ModelResponse,
  ProviderAdapterError,
  type ProviderFailureStage,
  type ProviderValidationDiagnostic,
} from "@draft-loop/providers";
import {
  type ArtifactEvidenceReference,
  type AuthorArtifactProposal,
  authorArtifactProposalSchema,
  type DraftArtifact,
  type EvidenceSource,
} from "@draft-loop/schemas";

import { z } from "zod";

import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { completeCvProposalIssues } from "./complete-cv.js";

function proposalFailureStage(error: unknown): ProviderFailureStage {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return "response-schema-validation";
  }
  const issues = (error as { readonly issues?: unknown }).issues;
  if (!Array.isArray(issues)) return "response-schema-validation";
  for (const issue of issues) {
    if (typeof issue === "object" && issue !== null) {
      const candidate = issue as { readonly params?: { readonly stage?: unknown } };
      if (candidate.params?.stage === "factual-invariant-rejection") {
        return "factual-invariant-rejection";
      }
      if (candidate.params?.stage === "artifact-schema-validation") {
        return "artifact-schema-validation";
      }
      const issueCandidate = issue as { readonly path?: unknown; readonly message?: unknown };
      if (
        Array.isArray(issueCandidate.path) &&
        issueCandidate.path.includes("evidenceChunkIds") &&
        typeof issueCandidate.message === "string" &&
        (issueCandidate.message.includes("not available in retrieved context") ||
          issueCandidate.message.includes("not available in the evidence manifest"))
      ) {
        return "artifact-schema-validation";
      }
    }
  }
  return "response-schema-validation";
}

export function proposalDiagnostics(error: unknown): readonly ProviderValidationDiagnostic[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) return [];
  const issues = (error as { readonly issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 8).flatMap((issue) => {
    if (typeof issue !== "object" || issue === null) return [];
    const candidate = issue as {
      readonly code?: unknown;
      readonly path?: unknown;
      readonly params?: { readonly invariantCode?: unknown };
    };
    const issueCode =
      typeof candidate.params?.invariantCode === "string"
        ? candidate.params.invariantCode
        : typeof candidate.code === "string"
          ? candidate.code
          : undefined;
    if (issueCode === undefined || !Array.isArray(candidate.path)) return [];
    const path = candidate.path
      .slice(0, 12)
      .filter(
        (segment): segment is string | number =>
          typeof segment === "number" ||
          (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(segment)),
      )
      .join(".");
    return [{ code: issueCode.slice(0, 64), path: path.slice(0, 160) }];
  });
}

export function invalidAuthorProposalError(
  response: ModelResponse<JsonObject>,
  error: unknown,
): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) {
    return error;
  }
  const failureStage = proposalFailureStage(error);
  return new ProviderAdapterError(
    response.provider,
    "invalid-response",
    "The author returned an invalid content proposal.",
    {
      retryable: failureStage !== "artifact-schema-validation",
      ...(response.providerRequestId === null ? {} : { requestId: response.providerRequestId }),
      failureStage,
      diagnostics: proposalDiagnostics(error),
    },
  );
}

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

function validationError(
  path: PropertyKey[],
  message: string,
  stage: ProviderFailureStage = "artifact-schema-validation",
  code = "custom",
): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      path,
      message,
      params: { stage, invariantCode: code },
    },
  ]);
}

function normalizeEvidence(
  proposal: AuthorArtifactProposal,
  context: AuthorArtifactBuildContext,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): ArtifactEvidenceReference[][] {
  const chunksById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk]));
  const sourcesById = new Map(
    context.evidenceManifest.map((source) => [source.id, source] as const),
  );
  const evidenceByClaim: ArtifactEvidenceReference[][] = [];
  const issues: Array<{
    readonly code: "custom";
    readonly path: PropertyKey[];
    readonly message: string;
    readonly params?: { readonly stage: ProviderFailureStage; readonly invariantCode: string };
  }> = [];

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

  const retrievedEvidence = options.retrievedEvidence ?? [];
  const proposal = completeAuthorEvidenceCitations(
    authorArtifactProposalSchema.parse(options.proposal),
    retrievedEvidence,
  );
  const evidenceByClaim = normalizeEvidence(proposal, options.context, retrievedEvidence);
  const groundingIssues = completeCvProposalIssues(proposal, retrievedEvidence);
  if (groundingIssues.length > 0) {
    throw new z.ZodError(
      groundingIssues.map((issue) => ({
        code: "custom",
        path: issue.path,
        message: issue.message,
        params: {
          stage: "factual-invariant-rejection",
          invariantCode: issue.code,
        },
      })),
    );
  }
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

  try {
    return options.currentArtifact === null || options.currentArtifact === undefined
      ? createArtifact(input)
      : createArtifactVersion(options.currentArtifact, input);
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["revisedArtifact"],
        message: "The revised artifact could not be created from the proposal.",
        params: {
          stage: "artifact-schema-validation",
          invariantCode: "invalid_artifact_version",
        },
      },
    ]);
  }
}

/** Alias emphasizing that the function is the proposal normalization boundary. */
export const normalizeAuthorArtifactProposal = buildAuthorArtifact;
