import { type ApiInput, ApiRequestError, type ApiSchemas } from "./api-client.js";

export type Brief = ApiSchemas["Opportunity"]["brief"];
export type Requirement = Brief["requirements"][number];
export type Priority = Requirement["priority"];
type Application = ApiSchemas["Application"];

export const priorities: readonly Priority[] = ["critical", "high", "medium", "low"];

/** The pasted job post's source id; one per brief, since each paste makes a new brief. */
export const jobPostingSourceId = "job-posting";

type CreateBody = ApiInput<"POST /v1/workspaces/{workspaceId}/opportunities">["body"];
type PatchBody = ApiInput<"PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}">["body"];

/** Why pasted job text cannot make a brief, or `undefined` when it can. */
export function jobTextProblem(text: string): string | undefined {
  if (text.trim().length === 0) return "Paste the job post first.";
  return undefined;
}

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

/** The application's newest brief, which the screen opens. */
export function latestBrief(application: Application): Application["briefs"][number] | undefined {
  return application.briefs.reduce<Application["briefs"][number] | undefined>(
    (latest, brief) =>
      latest === undefined || brief.createdAt > latest.createdAt ? brief : latest,
    undefined,
  );
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

/** A new, empty requirement with an id the brief does not use yet. */
export function newRequirement(brief: Brief, existing: readonly Requirement[]): Requirement {
  const used = new Set(existing.map((requirement) => requirement.id));
  let index = existing.length + 1;
  while (used.has(`owner-${index}`)) index += 1;
  return { id: `owner-${index}`, text: "", priority: "medium", sourceIds: editSourceIds(brief) };
}

/** What the owner must fix before saving the edit. */
export function briefEditProblems(edit: BriefEdit): string[] {
  const problems: string[] = [];
  if (edit.requirements.some((requirement) => requirement.text.trim() === ""))
    problems.push("Write each requirement, or remove the empty ones.");
  if (edit.requirements.length === 0) problems.push("Keep at least one requirement.");
  return problems;
}

/** A reviewed brief needs a requirement to draft against; the API refuses one without. */
export function canReview(brief: Brief): boolean {
  return brief.status === "draft" && brief.requirements.length > 0;
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

/** Whether a refusal means someone saved another version first (409). */
export function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

export const staleVersionMessage =
  "This brief changed since you opened it. Reload it to see the latest version, then edit again.";
