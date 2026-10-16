import { z } from "zod";

import { nonEmptyString } from "./schema-primitives.js";

export const artifactBlockTypes = ["paragraph", "bullet"] as const;

const authorArtifactClaimProposalSchema = z.strictObject({
  text: nonEmptyString,
  substantive: z.boolean(),
  evidenceChunkIds: z.array(nonEmptyString).superRefine((ids, context) => {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "evidence chunk ids must be unique within a claim",
        });
      }
      seen.add(id);
    }
  }),
});

export const authorArtifactBlockProposalSchema = z.strictObject({
  type: z.enum(artifactBlockTypes),
  text: nonEmptyString,
  claims: z.array(authorArtifactClaimProposalSchema),
});
