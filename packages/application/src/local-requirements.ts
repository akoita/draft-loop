import { meaningfulRequirementTokenCount } from "@draft-loop/validation";

import { CliUserError } from "./cli-user-error.js";

/** A job description the local run cannot split into matchable requirements; fix it and retry. */
export class JobRequirementUserError extends CliUserError {
  constructor(message: string) {
    super(message);
    this.name = "JobRequirementUserError";
  }
}

/**
 * Longest requirement unit, in meaningful tokens, that readiness relevance can match: a block
 * must contain at least half of a requirement's tokens, so longer units can never be covered.
 */
export const maxLocalRequirementUnitTokens = 40;

/** Syntactic source units only; semantic selection and priority belong to reviewed briefs. */
export function localJobRequirements(jobDescription: string): readonly {
  readonly id: string;
  readonly text: string;
  readonly priority: "medium";
}[] {
  const reviewHint = "Use a reviewed opportunity brief to select requirements and priorities.";
  if (Buffer.byteLength(jobDescription) > 65_536)
    throw new JobRequirementUserError(`Local job document exceeds 64 KiB. ${reviewHint}`);
  const units: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    const text = pending.join(" ").trim();
    pending = [];
    if (!text) return;
    if (text.length > 2_000)
      throw new JobRequirementUserError(
        `Local requirement unit exceeds 2,000 characters. ${reviewHint}`,
      );
    if (meaningfulRequirementTokenCount(text) > maxLocalRequirementUnitTokens) {
      const words = text.split(/\s+/u);
      throw new JobRequirementUserError(
        `Requirement ${units.length + 1} in the job description has ${words.length} words, too long to match against individual CV lines ("${words.slice(0, 8).join(" ")}…"). List each requirement on its own bullet line in the job description and remove page navigation and boilerplate, or use a reviewed opportunity brief.`,
      );
    }
    units.push(text);
    if (units.length > 100)
      throw new JobRequirementUserError(
        `Local job document exceeds 100 requirement units. ${reviewHint}`,
      );
  };
  const lines = jobDescription.split(/\r?\n/u);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (/^(?:```|~~~)/u.test(line) || line.includes("|"))
      throw new JobRequirementUserError(
        `Code fences and tables require explicit requirement selection. ${reviewHint}`,
      );
    if (/^(?:#{1,6})(?:\s|$)/u.test(line) || /^(?:-+|\*{3,}|_{3,}|=+)$/u.test(line) || !line) {
      flush();
      continue;
    }
    // Setext heading text and its underline are both structural, not requirements.
    if (/^\s*(?:=+|-+)\s*$/u.test(lines[index + 1] ?? "")) {
      flush();
      continue;
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/u.exec(line);
    if (item) {
      flush();
      pending.push(item[1] ?? "");
    } else {
      pending.push(line);
    }
  }
  flush();
  if (!units.length)
    throw new JobRequirementUserError(
      `Local job document has no requirement content. ${reviewHint}`,
    );
  return units.map((text, index) => ({ id: `requirement-${index + 1}`, text, priority: "medium" }));
}
