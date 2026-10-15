import type { ContextSnapshot } from "@draft-loop/domain";
import { type CandidateDirection, normalizeCandidateDirectionText } from "@draft-loop/orchestrator";

import { authorPromptSupportsCandidateDirection } from "./author-adjudication.js";
import { CliUserError } from "./cli-user-error.js";
import type { CriticCoverageJudgementParts } from "./critic-critique-contract.js";

/**
 * Appended to the critic's system prompt only on a round that has a candidate direction, so every
 * other critic call keeps its exact prompt. The direction is not evidence: grounding review stays.
 */
const candidateDirectionCriticInstructions =
  "Candidate direction: the input includes candidateDirection.instructions, the candidate's own steering for this revision round (selection, emphasis, ordering, omission, framing). A change that follows it is not a defect: do not report content as missing, dropped, reordered, or reframed when the direction asked for it, and do not report an editorial or coverage gap that the direction chose. The direction is not evidence and does not relax any other review: still report every claim that lacks cited support, contradicts its source, or states a fact absent from the supplied material, including one the direction asked for.";

/** Add the candidate's direction to a critic call; without one the parts are returned as they are. */
export function withCandidateDirection(
  parts: CriticCoverageJudgementParts,
  direction: CandidateDirection | undefined,
): CriticCoverageJudgementParts {
  if (direction === undefined) return parts;
  return {
    ...parts,
    systemPrompt: (prompt) =>
      `${parts.systemPrompt(prompt)}\n\n${candidateDirectionCriticInstructions}`,
    input: {
      ...parts.input,
      candidateDirection: { instructions: direction.text },
    },
  };
}

/**
 * Check a revision's direction before the run changes: too long a direction, or one for a run
 * whose recorded author prompt cannot state it, is refused. A run keeps the prompt version it
 * started on, so the direction would otherwise be dropped without a word.
 */
export function assertRevisionDirection(
  context: Pick<ContextSnapshot, "modelConfiguration">,
  direction: string | undefined,
): void {
  const authorPromptTemplateVersion = context.modelConfiguration.author.promptTemplateVersion;
  let text: string | undefined;
  try {
    text = normalizeCandidateDirectionText(direction);
  } catch (error) {
    throw new CliUserError(error instanceof Error ? error.message : String(error));
  }
  if (text === undefined || authorPromptSupportsCandidateDirection(authorPromptTemplateVersion)) {
    return;
  }
  throw new CliUserError(
    `This run started on author prompt ${authorPromptTemplateVersion}, which cannot take directions for the author. Start a new run to use them, or request the revision without directions.`,
  );
}
