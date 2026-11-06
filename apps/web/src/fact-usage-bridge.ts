import type { BridgeCommand } from "@draft-loop/ui/bridge";

import type { ApiClient } from "./api-client.js";

/** The usage level commands the hosted service serves (#2259). */
export const hostedFactUsageCapabilities = ["fact-usage.get", "fact-usage.set"] as const;

type FactUsageCommandType = (typeof hostedFactUsageCapabilities)[number];
export type FactUsageCommand = Extract<BridgeCommand, { type: FactUsageCommandType }>;

export function isFactUsageCommand(command: BridgeCommand): command is FactUsageCommand {
  return (hostedFactUsageCapabilities as readonly string[]).includes(command.type);
}

/** Answers the usage level commands over `/fact-usage`. */
export function createFactUsageAnswers(client: ApiClient) {
  return async (command: FactUsageCommand): Promise<unknown> => {
    const { workspaceId } = command.input;
    if (command.type === "fact-usage.get") {
      const { usage } = await client.call("GET /v1/workspaces/{workspaceId}/fact-usage", {
        path: { workspaceId },
      });
      return { workspaceId, usage };
    }
    const { usage } = await client.call("PUT /v1/workspaces/{workspaceId}/fact-usage", {
      path: { workspaceId },
      body: command.input.change,
    });
    return { workspaceId, usage };
  };
}
