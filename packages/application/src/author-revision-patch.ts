import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AppliedRevisionEdit } from "@draft-loop/orchestrator";
import {
  type AuthorArtifactProposal,
  type AuthorRevisionEdit,
  authorRevisionPatchSchema,
  type DraftArtifact,
  type EvidenceSource,
} from "@draft-loop/schemas";

/*
 * Applying a targeted revision patch (#1112) to the current artifact.
 *
 * The patch is expanded into a complete author proposal, so the existing citation completion,
 * grounding and validation run unchanged on the patched draft. Blocks no edit names are copied from
 * the current artifact exactly: same type, text, claims and evidence.
 */

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

/** Why a patch could not be applied; content-free, so it is safe to log. */
export type AuthorRevisionPatchRejection =
  | "malformed-patch"
  | "unmappable-evidence"
  | "unknown-block"
  | "unknown-section"
  | "unknown-finding"
  | "conflicting-edits"
  | "empty-section";

export type AuthorRevisionPatchOutcome =
  | {
      readonly ok: true;
      readonly proposal: AuthorArtifactProposal;
      readonly edits: readonly AppliedRevisionEdit[];
    }
  | { readonly ok: false; readonly reason: AuthorRevisionPatchRejection };

export interface ApplyAuthorRevisionPatchInput {
  /** The author's raw output, already mapped back from request-local evidence aliases. */
  readonly output: unknown;
  readonly currentArtifact: DraftArtifact;
  readonly retrievedEvidence: readonly ScoredEvidenceChunk[];
  readonly evidenceManifest: readonly Pick<EvidenceSource, "id" | "path" | "checksum">[];
  /** The accepted findings an edit may name; empty when the revision is not adjudicated. */
  readonly acceptedFindingIds: readonly string[];
}

/** Positional key of each section: `<kind>#<n>`, the n-th section of that kind. */
function sectionKeys(artifact: DraftArtifact): readonly string[] {
  const seen = new Map<string, number>();
  return artifact.sections.map((section) => {
    const occurrence = seen.get(section.kind) ?? 0;
    seen.set(section.kind, occurrence + 1);
    return `${section.kind}#${occurrence}`;
  });
}

/**
 * The chunk each claim's stored evidence reference was made from, matched on source, locator and
 * excerpt exactly as `buildAuthorArtifact` writes them. Undefined when a reference matches no
 * chunk of this request, because that claim could then not be grounded again.
 */
function evidenceChunkIdsOf(
  artifact: DraftArtifact,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  manifest: ApplyAuthorRevisionPatchInput["evidenceManifest"],
): ReadonlyMap<string, readonly string[]> | undefined {
  const sourcesById = new Map(manifest.map((source) => [source.id, source]));
  const chunkIdByReference = new Map<string, string>();
  for (const chunk of retrievedEvidence) {
    const source = sourcesById.get(chunk.sourceId);
    if (source === undefined) continue;
    const key = JSON.stringify([
      source.path,
      source.checksum,
      `line:${chunk.lineStart}-${chunk.lineEnd}`,
      chunk.text,
    ]);
    if (!chunkIdByReference.has(key)) chunkIdByReference.set(key, chunk.id);
  }
  const idsByClaim = new Map<string, readonly string[]>();
  for (const claim of artifact.claims) {
    const ids: string[] = [];
    for (const reference of claim.evidence) {
      const id = chunkIdByReference.get(
        JSON.stringify([
          reference.sourcePath,
          reference.sourceChecksum ?? null,
          reference.locator ?? null,
          reference.excerpt,
        ]),
      );
      if (id === undefined) return undefined;
      if (!ids.includes(id)) ids.push(id);
    }
    idsByClaim.set(claim.id, ids);
  }
  return idsByClaim;
}

interface Slot {
  readonly id: string;
  readonly sourceKey: string;
  block: ProposalBlock | undefined;
  replacedBy: number | undefined;
  readonly after: { readonly block: ProposalBlock; readonly editIndex: number }[];
}

/**
 * Apply a targeted revision patch. Every edit is checked against the current artifact before
 * anything is built: unknown block, section or finding ids, two edits to one block, and a section
 * left without blocks all reject the whole patch.
 */
export function applyAuthorRevisionPatch(
  input: ApplyAuthorRevisionPatchInput,
): AuthorRevisionPatchOutcome {
  const parsed = authorRevisionPatchSchema.safeParse(input.output);
  if (!parsed.success) return { ok: false, reason: "malformed-patch" };
  const { currentArtifact: artifact } = input;
  const idsByClaim = evidenceChunkIdsOf(artifact, input.retrievedEvidence, input.evidenceManifest);
  if (idsByClaim === undefined) return { ok: false, reason: "unmappable-evidence" };

  const claimsById = new Map(artifact.claims.map((claim) => [claim.id, claim]));
  const keys = sectionKeys(artifact);
  const sectionSlots = artifact.sections.map((section, sectionIndex) => ({
    headInserts: [] as { block: ProposalBlock; editIndex: number }[],
    slots: section.blocks.map(
      (block, blockIndex): Slot => ({
        id: block.id,
        sourceKey: `${keys[sectionIndex]}/b${blockIndex}`,
        block: {
          type: block.type,
          text: block.text,
          claims: block.claimIds.flatMap((claimId) => {
            const claim = claimsById.get(claimId);
            return claim === undefined
              ? []
              : [
                  {
                    text: claim.text,
                    substantive: claim.substantive,
                    evidenceChunkIds: [...(idsByClaim.get(claimId) ?? [])],
                  },
                ];
          }),
        },
        replacedBy: undefined,
        after: [],
      }),
    ),
  }));
  const slotById = new Map(
    sectionSlots.flatMap((section, sectionIndex) =>
      section.slots.map((slot) => [slot.id, { slot, sectionIndex }] as const),
    ),
  );
  const sectionIndexById = new Map(artifact.sections.map((section, index) => [section.id, index]));
  const accepted = new Set(input.acceptedFindingIds);

  const edits = parsed.data.edits;
  const changedIds = new Set<string>();
  for (const [editIndex, edit] of edits.entries()) {
    if (edit.findingIds.some((id) => !accepted.has(id))) {
      return { ok: false, reason: "unknown-finding" };
    }
    const newBlock = edit.block;
    if (edit.op === "insert") {
      const sectionIndex = sectionIndexById.get(edit.sectionId ?? "");
      if (sectionIndex === undefined || newBlock === null) {
        return { ok: false, reason: "unknown-section" };
      }
      const section = sectionSlots[sectionIndex];
      if (edit.afterBlockId === null) {
        section?.headInserts.push({ block: newBlock, editIndex });
        continue;
      }
      const anchor = slotById.get(edit.afterBlockId);
      if (anchor === undefined || anchor.sectionIndex !== sectionIndex) {
        return { ok: false, reason: "unknown-block" };
      }
      anchor.slot.after.push({ block: newBlock, editIndex });
      continue;
    }
    const target = slotById.get(edit.blockId ?? "");
    if (target === undefined) return { ok: false, reason: "unknown-block" };
    if (changedIds.has(target.slot.id)) return { ok: false, reason: "conflicting-edits" };
    changedIds.add(target.slot.id);
    target.slot.block = edit.op === "delete" ? undefined : (newBlock ?? undefined);
    target.slot.replacedBy = editIndex;
  }

  const applied: AppliedRevisionEdit[] = [];
  const findingIdsOf = (edit: AuthorRevisionEdit) => [...new Set(edit.findingIds)];
  const sections: ProposalSection[] = [];
  for (const [sectionIndex, section] of artifact.sections.entries()) {
    const entry = sectionSlots[sectionIndex];
    if (entry === undefined) continue;
    const blocks: ProposalBlock[] = [];
    const emit = (block: ProposalBlock, editIndex: number | undefined, sourceKey?: string) => {
      const edit = editIndex === undefined ? undefined : edits[editIndex];
      if (edit !== undefined) {
        applied.push({
          op: edit.op,
          ...(sourceKey === undefined ? {} : { sourceBlockKey: sourceKey }),
          revisedBlockKey: `${keys[sectionIndex]}/b${blocks.length}`,
          findingIds: findingIdsOf(edit),
        });
      }
      blocks.push(block);
    };
    for (const head of entry.headInserts) emit(head.block, head.editIndex);
    for (const slot of entry.slots) {
      if (slot.block !== undefined) {
        emit(
          slot.block,
          slot.replacedBy,
          slot.replacedBy === undefined ? undefined : slot.sourceKey,
        );
      } else if (slot.replacedBy !== undefined) {
        const edit = edits[slot.replacedBy];
        if (edit !== undefined) {
          applied.push({
            op: "delete",
            sourceBlockKey: slot.sourceKey,
            findingIds: findingIdsOf(edit),
          });
        }
      }
      for (const inserted of slot.after) emit(inserted.block, inserted.editIndex);
    }
    if (blocks.length === 0) return { ok: false, reason: "empty-section" };
    sections.push({ title: section.title, kind: section.kind, blocks });
  }
  return { ok: true, proposal: { sections }, edits: applied };
}
