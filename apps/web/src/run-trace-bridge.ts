import type { BridgeCommand } from "@draft-loop/ui/bridge";

import type { ApiClient } from "./api-client.js";

/** The run trace command the hosted service serves (#2693). */
export const hostedRunTraceCapabilities = ["run.trace"] as const;

type RunTraceCommandType = (typeof hostedRunTraceCapabilities)[number];
export type RunTraceCommand = Extract<BridgeCommand, { type: RunTraceCommandType }>;

export function isRunTraceCommand(command: BridgeCommand): command is RunTraceCommand {
  return (hostedRunTraceCapabilities as readonly string[]).includes(command.type);
}

/** Answers the run trace command over `/runs/{runId}/trace` in the shared screens' shape. */
export function createRunTraceAnswers(client: ApiClient) {
  return async (command: RunTraceCommand): Promise<unknown> => {
    const { workspaceId, runId } = command.input;
    const { spans } = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/trace", {
      path: { workspaceId, runId },
    });
    return {
      workspaceId,
      runId,
      spans: spans.map((span) => ({
        spanId: span.span_id,
        parentSpanId: span.parent_span_id,
        name: span.name,
        startedAt: span.started_at,
        endedAt: span.ended_at,
        status: span.status,
        attributes: span.attributes,
      })),
    };
  };
}
