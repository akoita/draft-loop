import type { ApiInput, ApiSchemas } from "./api-client.js";

export type Brief = ApiSchemas["Opportunity"]["brief"];
export type Requirement = Brief["requirements"][number];

/** The pasted job post's source id; one per brief, since each paste makes a new brief. */
export const jobPostingSourceId = "job-posting";

type CreateBody = ApiInput<"POST /v1/workspaces/{workspaceId}/opportunities">["body"];
type PatchBody = ApiInput<"PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}">["body"];

/** The create request for pasted job text, captured now. */
export function createBriefBody(text: string, capturedAt: Date): CreateBody {
  return {
    sources: [
      {
        id: jobPostingSourceId,
        kind: "pasted-content",
        classification: "job-posting",
        capturedAt: capturedAt.toISOString(),
        content: text.trim(),
      },
    ],
  };
}

/** The fields the owner edits; the rest of the brief keeps its values. */
export interface BriefEdit {
  readonly role: string;
  readonly employer: string;
  readonly requirements: readonly Requirement[];
}

export function briefEdit(brief: Brief): BriefEdit {
  return {
    role: brief.role?.value ?? "",
    employer: brief.employer?.value ?? "",
    requirements: brief.requirements,
  };
}

/** The sources a field the owner typed is attributed to: the brief's job posts. */
function editSourceIds(brief: Brief): string[] {
  const posts = brief.sources.filter((source) => source.classification === "job-posting");
  return (posts.length === 0 ? brief.sources : posts).map((source) => source.id);
}

/** The patch for an edit, sent against the version the owner saw. */
export function briefPatchBody(brief: Brief, edit: BriefEdit): PatchBody {
  const sourceIds = editSourceIds(brief);
  const field = (value: string, current: Brief["role"]) => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (current !== null && current.value === trimmed) return current;
    return { value: trimmed, sourceIds };
  };
  return {
    expectedVersion: brief.version,
    patch: {
      role: field(edit.role, brief.role),
      employer: field(edit.employer, brief.employer),
      requirements: edit.requirements.map((requirement) => ({
        ...requirement,
        text: requirement.text.trim(),
      })),
    },
  };
}
