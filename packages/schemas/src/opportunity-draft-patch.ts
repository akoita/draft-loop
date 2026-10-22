import { opportunityBriefMaximumCollectionEntries } from "@draft-loop/domain";
import { z } from "zod";

import {
  opportunityBriefCandidateInstructionsSchema,
  opportunityBriefIssueSchema,
  opportunityBriefPrioritySchema,
  opportunityBriefRequirementSchema,
  opportunityBriefResponsibilitySchema,
  opportunityBriefSourcedTextSchema,
} from "./index.js";
import { opportunityBriefTextSchema } from "./opportunity-brief-fields.js";

const collection = <T extends z.ZodType>(schema: T) =>
  z.array(schema).max(opportunityBriefMaximumCollectionEntries);

/**
 * A person's edit to a draft job brief: the fields they may replace, each in its brief shape. The
 * application checks the edited brief as a whole, such as that every entry cites a known source.
 */
export const opportunityDraftPatchSchema = z
  .strictObject({
    role: opportunityBriefSourcedTextSchema.nullable().optional(),
    employer: opportunityBriefSourcedTextSchema.nullable().optional(),
    /** An employer typed in for a brief that names none; recorded as the candidate's own fact. */
    candidateEmployer: opportunityBriefTextSchema.optional(),
    responsibilities: collection(opportunityBriefResponsibilitySchema).optional(),
    requirements: collection(opportunityBriefRequirementSchema).optional(),
    priorities: collection(opportunityBriefPrioritySchema).optional(),
    candidateInstructions: opportunityBriefCandidateInstructionsSchema.optional(),
    issues: collection(opportunityBriefIssueSchema).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "must change at least one field",
  })
  .refine((patch) => patch.employer === undefined || patch.candidateEmployer === undefined, {
    message: "enter the employer or edit it, not both",
  });

export type OpportunityDraftPatchInput = z.infer<typeof opportunityDraftPatchSchema>;
