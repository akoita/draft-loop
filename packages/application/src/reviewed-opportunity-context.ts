import type { JobRequirement } from "@draft-loop/schemas";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";

import { CliUserError } from "./cli-user-error.js";

/** The priority a responsibility carries when it is checked as a run requirement. */
export const responsibilityRequirementPriority = "medium" satisfies JobRequirement["priority"];

export interface ReviewedOpportunityContext {
  readonly jobDescription: string;
  readonly requirements: readonly JobRequirement[];
  readonly candidateInstructions: string;
  readonly opportunityBriefReference: {
    readonly briefId: string;
    readonly version: number;
    readonly checksum: string;
  };
}

/**
 * The run inputs a reviewed opportunity brief provides. The job's responsibilities are checked
 * like requirements, after the extracted requirements, so coverage and critique ask whether the
 * CV shows the candidate can do what the job says they will do. A responsibility whose id or text
 * repeats a requirement is left to that requirement.
 */
export function reviewedOpportunityContext(
  record: OpportunityBriefVersionRecord,
): ReviewedOpportunityContext {
  const brief = record.brief;
  if (brief.status !== "reviewed") {
    throw new CliUserError("The selected opportunity brief version is not reviewed.");
  }
  const sections = [
    `Role: ${brief.role?.value ?? ""}`,
    // A reviewed brief may have no employer; say so rather than leave the author a blank to fill.
    `Employer: ${brief.employer?.value ?? "not named in the job posting"}`,
    ...(brief.responsibilities.length === 0
      ? []
      : ["Responsibilities:", ...brief.responsibilities.map((item) => `- ${item.text}`)]),
    "Requirements:",
    ...brief.requirements.map((item) => `- [${item.priority}] ${item.text}`),
    ...(brief.priorities.length === 0
      ? []
      : ["Priorities:", ...brief.priorities.map((item) => `- ${item.text}`)]),
  ];
  const instructions = [
    ...(brief.candidateInstructions.tone === null
      ? []
      : [`Tone: ${brief.candidateInstructions.tone.value}`]),
    ...(brief.candidateInstructions.applicationGoal === null
      ? []
      : [`Application goal: ${brief.candidateInstructions.applicationGoal.value}`]),
    ...brief.candidateInstructions.forbiddenLanguage.map(
      (item) => `Forbidden language: ${item.value}`,
    ),
    ...brief.candidateInstructions.focusAreas.map((item) => `Focus area: ${item.value}`),
  ];
  const requirements: JobRequirement[] = brief.requirements.map(({ id, text, priority }) => ({
    id,
    text,
    priority,
  }));
  const seenIds = new Set(requirements.map(({ id }) => id));
  const seenTexts = new Set(requirements.map(({ text }) => comparableText(text)));
  for (const { id, text } of brief.responsibilities) {
    const comparable = comparableText(text);
    if (seenIds.has(id) || seenTexts.has(comparable)) continue;
    seenIds.add(id);
    seenTexts.add(comparable);
    requirements.push({ id, text, priority: responsibilityRequirementPriority });
  }
  return {
    jobDescription: sections.join("\n"),
    requirements,
    candidateInstructions: instructions.join("\n"),
    opportunityBriefReference: {
      briefId: brief.id,
      version: brief.version,
      checksum: record.checksum,
    },
  };
}

function comparableText(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}
