import { z } from "zod";

import { authorArtifactBlockProposalSchema } from "./author-proposal-block.js";
import { nonEmptyString } from "./schema-primitives.js";

/*
 * Targeted revisions (#1112): the author returns block-level edits to the current draft instead of
 * a whole new proposal. Edits are keyed to the block and section ids of the current artifact, which
 * the author receives in its revision input. Those ids are minted per execution, but a patch is only
 * ever applied to the exact artifact it was written against, so they are unambiguous for that one
 * application. The application turns them into positional keys (`sectionKind#n/bi`) for attribution.
 *
 * The edit is one flat object with nullable members rather than a union, because the structured
 * output schemas of both live providers accept that shape most reliably.
 */

export const authorRevisionEditOperations = ["replace", "insert", "delete"] as const;
export type AuthorRevisionEditOperation = (typeof authorRevisionEditOperations)[number];

/** The most edits one revision patch may carry. */
export const maximumAuthorRevisionEdits = 64;

export const authorRevisionEditSchema = z
  .strictObject({
    op: z.enum(authorRevisionEditOperations),
    /** The block of the current artifact to replace or delete; null for an insert. */
    blockId: nonEmptyString.nullable(),
    /** The section of the current artifact that receives an inserted block; null otherwise. */
    sectionId: nonEmptyString.nullable(),
    /** The block an inserted block follows; null inserts at the start of the section. */
    afterBlockId: nonEmptyString.nullable(),
    /** The new block of a replace or an insert; null for a delete. */
    block: authorArtifactBlockProposalSchema.nullable(),
    /** The accepted findings this edit addresses. */
    findingIds: z.array(nonEmptyString),
  })
  .superRefine((edit, context) => {
    const issue = (path: string, message: string): void =>
      context.addIssue({ code: "custom", path: [path], message });
    if (edit.op === "insert") {
      if (edit.blockId !== null) issue("blockId", "an insert names no block to change");
      if (edit.sectionId === null) issue("sectionId", "an insert names its section");
    } else {
      if (edit.blockId === null) issue("blockId", "this edit names the block it changes");
      if (edit.sectionId !== null) issue("sectionId", "only an insert names a section");
      if (edit.afterBlockId !== null) issue("afterBlockId", "only an insert names a position");
    }
    if (edit.op === "delete") {
      if (edit.block !== null) issue("block", "a delete carries no block");
    } else if (edit.block === null) {
      issue("block", "this edit carries the new block");
    }
  });

export type AuthorRevisionEdit = z.infer<typeof authorRevisionEditSchema>;

export const authorRevisionPatchSchema = z.strictObject({
  edits: z.array(authorRevisionEditSchema).min(1).max(maximumAuthorRevisionEdits),
});

export type AuthorRevisionPatch = z.infer<typeof authorRevisionPatchSchema>;

const { $schema: _authorRevisionPatchSchemaMetadata, ...authorRevisionPatchJsonSchemaValue } =
  z.toJSONSchema(authorRevisionPatchSchema, { target: "draft-7" });

export const authorRevisionPatchJsonSchema = authorRevisionPatchJsonSchemaValue;

/** Narrow every claim's evidence ids to the chunk ids included in this exact request. */
export function authorRevisionPatchJsonSchemaForEvidence(
  evidenceChunkIds: readonly string[],
): typeof authorRevisionPatchJsonSchema {
  const schema = structuredClone(authorRevisionPatchJsonSchema) as unknown;
  const allowedIds = [...new Set(evidenceChunkIds)];
  const narrow = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(narrow);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const properties = record.properties;
    if (typeof properties === "object" && properties !== null) {
      const ids = (properties as Record<string, unknown>).evidenceChunkIds;
      if (allowedIds.length > 0 && typeof ids === "object" && ids !== null) {
        (ids as Record<string, unknown>).items = { type: "string", enum: allowedIds };
      }
    }
    Object.values(record).forEach(narrow);
  };
  narrow(schema);
  return schema as typeof authorRevisionPatchJsonSchema;
}
