import {
  type ServiceNoticeAnswer,
  serviceNoticeResponseSchema,
  serviceNoticeSchema,
} from "@draft-loop/schemas/service-notice";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { type WorkJournalApiConfig, WorkJournalApiError } from "./client.js";

/**
 * Planned maintenance for agents (#2967): the same notice the web banner shows, so an agent can
 * tell its candidate when changes are paused instead of retrying blindly. The route is public, so
 * the call carries no token and works before an agent has signed in.
 */

export interface ServiceNoticeApi {
  read(): Promise<ServiceNoticeAnswer>;
}

export function createServiceNoticeApi(config: WorkJournalApiConfig): ServiceNoticeApi {
  const fetcher = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/u, "")}/v1/service-notice`;
  return {
    read: async () => {
      let response: Response;
      try {
        response = await fetcher(url, { method: "GET" });
      } catch {
        throw new WorkJournalApiError(
          "server_unreachable",
          "The DraftLoop server did not answer.",
          [],
          true,
        );
      }
      if (response.status === 404) return { notice: null };
      if (!response.ok) {
        throw new WorkJournalApiError(
          `http_${response.status}`,
          "The DraftLoop server could not say whether maintenance is planned.",
          [],
          response.status >= 500,
        );
      }
      return serviceNoticeResponseSchema.parse(await response.json());
    },
  };
}

export const serviceNoticeDescription =
  "Check whether DraftLoop has planned maintenance: none, upcoming (with its window), ongoing or overrunning. While readOnly maintenance has started, DraftLoop refuses changes with service_maintenance and reads still work; tell the candidate when it ends instead of retrying, and wait until this tool returns no notice before trying again.";

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

/** Registers service_notice on the server. */
export function registerServiceNoticeTools(
  server: McpServer,
  api: ServiceNoticeApi,
  failure: Failure,
): void {
  server.registerTool(
    "service_notice",
    {
      title: "Check planned maintenance",
      description: serviceNoticeDescription,
      inputSchema: z.object({}),
      outputSchema: z.object({ notice: serviceNoticeSchema.nullable() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const answer = await api.read();
        return {
          structuredContent: answer,
          content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
