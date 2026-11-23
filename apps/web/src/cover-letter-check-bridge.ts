import type { BridgeCommand, CoverLetterCheckView } from "@draft-loop/ui/bridge";

import type { ApiClient } from "./api-client.js";

/** Check my letter (#3280) over the hosted API. */
export const hostedCoverLetterCheckCapabilities = ["application.check-cover-letter"] as const;

type CoverLetterCheckCommandType = (typeof hostedCoverLetterCheckCapabilities)[number];
export type CoverLetterCheckCommand = Extract<BridgeCommand, { type: CoverLetterCheckCommandType }>;

export function isCoverLetterCheckCommand(
  command: BridgeCommand,
): command is CoverLetterCheckCommand {
  return (hostedCoverLetterCheckCapabilities as readonly string[]).includes(command.type);
}

type CheckBody = Awaited<ReturnType<typeof checkCoverLetter>>;

function checkCoverLetter(
  client: ApiClient,
  workspaceId: string,
  applicationId: string,
  text: string,
) {
  return client.call(
    "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/cover-letter-check",
    { path: { workspaceId, applicationId }, body: { text } },
  );
}

/** The API's answer in the shared screens' shape; the letter is not part of it. */
export function coverLetterCheckView(body: CheckBody): CoverLetterCheckView {
  return {
    claims: {
      status: body.claims.status,
      reason: body.claims.reason ?? null,
      checkedSentences: body.claims.checked_sentences,
      findings: body.claims.findings.map((finding) => ({
        paragraph: finding.paragraph,
        sentence: finding.sentence,
        about: finding.about,
        reason: finding.reason,
        numbers: finding.numbers ?? [],
        closestFact:
          finding.closest_fact === null
            ? null
            : { factId: finding.closest_fact.fact_id, text: finding.closest_fact.text },
      })),
    },
    requirements: {
      source: body.requirements.source,
      total: body.requirements.total,
      unanswered: body.requirements.unanswered.map((requirement) => ({
        requirementId: requirement.requirement_id,
        text: requirement.text,
        facts: requirement.facts.map((fact) => ({ factId: fact.fact_id, text: fact.text })),
      })),
    },
    wording: body.wording.map((finding) => ({
      code: finding.code,
      paragraph: finding.paragraph ?? null,
      sentence: finding.sentence ?? null,
      match: finding.match ?? null,
    })),
  };
}

/** Answers the check command over `/cover-letter-check`. */
export function createCoverLetterCheckAnswers(client: ApiClient) {
  return async (command: CoverLetterCheckCommand): Promise<unknown> => {
    const { workspaceId, applicationId, text } = command.input;
    const body = await checkCoverLetter(client, workspaceId, applicationId, text);
    return { workspaceId, applicationId, check: coverLetterCheckView(body) };
  };
}

/**
 * The check bound to one application, for a web screen that holds the API client directly:
 * `<CoverLetterCheckPanel text={letter} check={webCoverLetterCheck(client, workspaceId, id)} />`.
 */
export function webCoverLetterCheck(
  client: ApiClient,
  workspaceId: string,
  applicationId: string,
): (text: string) => Promise<CoverLetterCheckView> {
  return async (text) =>
    coverLetterCheckView(await checkCoverLetter(client, workspaceId, applicationId, text));
}
