import type { BridgeCommand } from "@draft-loop/ui/bridge";

import { type ApiClient, ApiRequestError } from "./api-client.js";

/** The requirement evidence command the hosted service serves (#3011). */
export const hostedRunRequirementEvidenceCapabilities = ["run.requirement-evidence"] as const;

type RunRequirementEvidenceCommandType = (typeof hostedRunRequirementEvidenceCapabilities)[number];
export type RunRequirementEvidenceCommand = Extract<
  BridgeCommand,
  { type: RunRequirementEvidenceCommandType }
>;

export function isRunRequirementEvidenceCommand(
  command: BridgeCommand,
): command is RunRequirementEvidenceCommand {
  return (hostedRunRequirementEvidenceCapabilities as readonly string[]).includes(command.type);
}

/**
 * Answers the command over `/runs/{runId}/requirement-evidence`. The route answers 404 for a run
 * that recorded no map, which the screen shows as no section rather than an error.
 */
export function createRunRequirementEvidenceAnswers(client: ApiClient) {
  return async (command: RunRequirementEvidenceCommand): Promise<unknown> => {
    const { workspaceId, runId } = command.input;
    try {
      const evidence = await client.call(
        "GET /v1/workspaces/{workspaceId}/runs/{runId}/requirement-evidence",
        { path: { workspaceId, runId } },
      );
      return { workspaceId, runId, evidence };
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        return { workspaceId, runId, evidence: null };
      }
      throw error;
    }
  };
}
