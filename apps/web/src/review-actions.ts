import type { BridgeCommand } from "@draft-loop/ui/bridge";
import { exportFileName } from "@draft-loop/ui/export-file-name";
import { defaultExportTemplate } from "@draft-loop/ui/export-template";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { refuse } from "./bridge-refusal.js";

type ReviewDispatch = Extract<BridgeCommand, { type: "review.dispatch" }>["input"];
type ReviewAction = Exclude<ReviewDispatch["action"], { type: "start" }>;

/** Hands an exported document to the browser as a file to save. */
export type DownloadFile = (bytes: Blob, fileName: string) => void;

/**
 * Carries out one of the shared review screen's actions on a run through the review routes
 * (ADR 0011, D9). The server decides each one as the desktop host does; the caller then reads the
 * review state again, so the screens see what the server recorded.
 */
export function createReviewActions(
  client: ApiClient,
  idempotencyKey: () => string,
  download: DownloadFile,
) {
  return async (workspaceId: string, runId: string, action: ReviewAction): Promise<void> => {
    if (runId === "pending") return refuse("Start a run first.");
    const path = { workspaceId, runId };
    switch (action.type) {
      case "finding-decision": {
        const { findingId, decision, rationale } = action;
        await client.call(
          "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision",
          {
            path: { ...path, findingId },
            body: { decision, ...(rationale === undefined ? {} : { rationale }) },
          },
        );
        return;
      }
      case "edit-block":
        await client.call("PUT /v1/workspaces/{workspaceId}/runs/{runId}/edits/{blockId}", {
          path: { ...path, blockId: action.blockId },
          body: { text: action.text },
        });
        return;
      case "approve": {
        const rationale = action.readinessOverrideRationale;
        try {
          await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
            path,
            body: rationale === undefined ? {} : { readinessOverrideRationale: rationale },
          });
        } catch (error) {
          // Failing final checks are recorded on the run; the screen shows them and asks for a
          // reason, as the desktop does after the same refusal.
          if (error instanceof ApiRequestError && error.code === "readiness_blocked") return;
          throw error;
        }
        return;
      }
      case "request-revision": {
        const direction = action.candidateDirection;
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/revision", {
          path,
          // Asking again queues the run again, so a retry must not ask twice.
          header: { "idempotency-key": idempotencyKey() },
          body: direction === undefined ? {} : { candidateDirection: direction },
        });
        return;
      }
      case "pause":
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/pause", { path });
        return;
      case "resume":
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
          path,
          header: { "idempotency-key": idempotencyKey() },
        });
        return;
      case "stop":
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/stop", { path });
        return;
      case "acknowledge-provider-transmission":
        // The server refuses a provider call without the candidate's recorded consent, so its
        // preflight already reads as acknowledged and there is nothing more to record.
        return;
      case "set-autopilot":
        return refuse("Autopilot is not available on the hosted service yet.");
      case "recover-to-review":
      case "recover-round-limit":
        return refuse(
          "This recovery is not available on the hosted service yet. Stop the run and start a new one.",
        );
      case "export": {
        // The desktop's save dialog becomes a download: the service renders and keeps the
        // document, then the browser saves its bytes under the name the screen shows.
        const format = action.format ?? "markdown";
        const exported = await client.call(
          "POST /v1/workspaces/{workspaceId}/runs/{runId}/exports",
          {
            path,
            header: { "idempotency-key": idempotencyKey() },
            body:
              format === "markdown"
                ? { format }
                : { format, templateId: action.template ?? defaultExportTemplate },
          },
        );
        const bytes = await client.call(
          "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content",
          { path: { ...path, exportId: exported.id } },
        );
        download(bytes, exportFileName(exported));
        return;
      }
    }
  };
}
