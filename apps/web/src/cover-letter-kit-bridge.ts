import type { BridgeCommand } from "@draft-loop/ui/bridge";
import type {
  CoverLetterKitView,
  OwnCoverLetterView,
} from "@draft-loop/ui/cover-letter-kit-contract";
import { t } from "@lingui/core/macro";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  type ApplicationMaterialDraft,
  applicationMaterialFileName,
  applicationMaterialProblem,
} from "./application-material-model.js";
import { refuse } from "./bridge-refusal.js";
import type { DownloadFile } from "./review-actions.js";

/** The writing kit screen's commands the hosted service serves (#3279). */
export const hostedCoverLetterKitCapabilities = [
  "cover-letter-kit.load",
  "cover-letter-kit.prepare",
  "cover-letter-kit.save-letter",
  "cover-letter-kit.download-letter",
] as const;

type CoverLetterKitCommandType = (typeof hostedCoverLetterKitCapabilities)[number];
export type CoverLetterKitCommand = Extract<BridgeCommand, { type: CoverLetterKitCommandType }>;

export function isCoverLetterKitCommand(command: BridgeCommand): command is CoverLetterKitCommand {
  return (hostedCoverLetterKitCapabilities as readonly string[]).includes(command.type);
}

const kitRefusals = (): Readonly<Record<string, string>> => ({
  no_requirements: t`The job's brief lists no requirement yet, so there is nothing for a kit to answer. Extract the requirements first.`,
  invalid_kit: t`The kit broke its own rules twice, so it was refused. Try again.`,
  cost_cap_reached: t`This kit would pass the server's cost cap for one request.`,
});

/** The API's refusal in the person's words, keeping its status and code for the shell's panels. */
function worded(error: unknown): unknown {
  if (!(error instanceof ApiRequestError)) return error;
  const message = kitRefusals()[error.code] ?? applicationMaterialProblem(error);
  return new ApiRequestError(
    error.status,
    error.code,
    message,
    error.quarantined,
    error.details,
    error.params,
  );
}

function kitView(draft: ApplicationMaterialDraft): CoverLetterKitView {
  const { id, kit } = draft;
  if (id === undefined || kit === undefined) {
    return refuse(t`This server keeps no drafts, so it cannot keep a kit beside your letter.`);
  }
  return {
    id,
    createdAt: draft.created_at ?? new Date().toISOString(),
    model: draft.model.model,
    requirements: kit.requirements.map((requirement) => ({
      requirementId: requirement.requirement_id,
      text: requirement.text,
      facts: requirement.facts.map((fact) => ({ factId: fact.fact_id, text: fact.text })),
    })),
    angles: kit.angles.map((angle) => ({
      note: angle.note,
      factIds: angle.fact_ids,
      findingIds: angle.finding_ids,
    })),
    employerFacts: kit.employer_facts.map((fact) => ({
      findingId: fact.finding_id,
      text: fact.text,
      publishedOn: fact.published_on,
    })),
    outline: kit.outline.map((part) => ({
      paragraph: part.paragraph,
      purpose: part.purpose,
      requirementIds: part.requirement_ids,
      factIds: part.fact_ids,
      findingIds: part.finding_ids,
    })),
    avoid: kit.avoid,
  };
}

function letterView(draft: ApplicationMaterialDraft): OwnCoverLetterView {
  if (draft.id === undefined) {
    return refuse(t`This server keeps no drafts, so it cannot keep your letter.`);
  }
  return {
    id: draft.id,
    createdAt: draft.created_at ?? new Date().toISOString(),
    paragraphs: draft.items.map((item) => item.text),
  };
}

/** Answers the kit screen's commands over the material and writing kit routes. */
export function createCoverLetterKitAnswers(client: ApiClient, download: DownloadFile) {
  const list = async (
    workspaceId: string,
    applicationId: string,
    kind: "cover-letter" | "cover-letter-kit",
  ) => {
    try {
      const listed = await client.call(
        "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material",
        { path: { workspaceId, applicationId }, query: { kind } },
      );
      return listed.drafts;
    } catch (error) {
      // A server that keeps no drafts has none to list.
      if (error instanceof ApiRequestError && error.status === 404) return [];
      throw error;
    }
  };

  return async (command: CoverLetterKitCommand): Promise<unknown> => {
    const { workspaceId, applicationId } = command.input;
    try {
      switch (command.type) {
        case "cover-letter-kit.load": {
          const [kits, letters] = await Promise.all([
            list(workspaceId, applicationId, "cover-letter-kit"),
            list(workspaceId, applicationId, "cover-letter"),
          ]);
          // Drafts come newest first; only a letter the person wrote opens in the editor.
          const kit = kits.find((draft) => draft.id !== undefined && draft.kit !== undefined);
          const letter = letters.find((draft) => draft.written_by === "candidate");
          return {
            kit: kit === undefined ? null : kitView(kit),
            letter: letter === undefined ? null : letterView(letter),
          };
        }
        case "cover-letter-kit.prepare": {
          const prepared = await client.call(
            "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/cover-letter-kit",
            { path: { workspaceId, applicationId } },
          );
          return { kit: kitView(prepared) };
        }
        case "cover-letter-kit.save-letter": {
          const { basedOn, paragraphs } = command.input;
          const saved = await client.call(
            "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}/versions",
            {
              path: { workspaceId, applicationId, materialId: basedOn },
              body: { items: paragraphs.map((text) => ({ text })) },
            },
          );
          return { letter: letterView(saved) };
        }
        case "cover-letter-kit.download-letter": {
          const { letterId, format, template } = command.input;
          const bytes = await client.call(
            "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}/document",
            {
              path: { workspaceId, applicationId, materialId: letterId },
              query: { format, template },
            },
          );
          download(bytes as Blob, applicationMaterialFileName("cover-letter", format));
          return { letterId };
        }
      }
    } catch (error) {
      throw worded(error);
    }
  };
}
