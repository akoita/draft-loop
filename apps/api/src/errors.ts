import {
  CliUserError,
  HostedKnowledgeIntakeError,
  type HostedKnowledgeIntakeErrorCode,
  opportunityBriefNotFoundErrorMessage,
  opportunityBriefVersionStaleErrorMessage,
  RunActionError,
  type RunActionErrorCode,
  RunModelProfileError,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import { RunTransitionError } from "@draft-loop/orchestrator";
import { ConsentLedgerError } from "@draft-loop/storage/consent-ledger";
import {
  TenantDirectoryError,
  type TenantDirectoryErrorCode,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { z } from "zod";

import { IdempotencyConflictError, IdempotencyInProgressError } from "./idempotency.js";

/**
 * The one error shape every route answers with. It names what went wrong and never echoes the
 * request: bodies can hold candidate material, and headers can hold the owner's token.
 */
export const apiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe("Which fields failed validation, by path; values are never repeated."),
    }),
  })
  .meta({ id: "ApiError" });

export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/** The run was saved but not queued; a retry with the same Idempotency-Key queues it. */
export class RunQueueUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The run was saved but could not be queued. Retry with the same Idempotency-Key.",
      options,
    );
    this.name = "RunQueueUnavailableError";
  }
}

/** Intake's refusals by HTTP status; the codes are the API's error codes too. */
const intakeStatus: Readonly<Record<HostedKnowledgeIntakeErrorCode, number>> = {
  knowledge_base_not_found: 404,
  source_empty: 400,
  source_too_large: 413,
  unsupported_media_type: 415,
};

/** Refused run actions by HTTP status; the codes are the API's error codes too. */
const runActionStatus: Readonly<Record<RunActionErrorCode, number>> = {
  run_not_found: 404,
  review_closed: 409,
  review_target_not_found: 404,
  export_not_found: 404,
  export_integrity: 409,
};

/** The tenant directory's refusals by HTTP status; the codes are the API's error codes too. */
const tenantDirectoryStatus: Readonly<Record<TenantDirectoryErrorCode, number>> = {
  invalid_input: 400,
  organisation_exists: 409,
  organisation_not_found: 404,
  member_exists: 409,
  member_not_found: 404,
  last_owner: 409,
};

export function sendNotFound(_request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send(apiError("not_found", "No such route."));
}

export function sendError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (hasZodFastifySchemaValidationErrors(error)) {
    void reply.code(400).send({
      error: {
        code: "invalid_request",
        message: "The request does not match the route's schema.",
        issues: error.validation.map((issue) => ({
          path: issue.instancePath === "" ? "/" : issue.instancePath,
          message: issue.message ?? "Invalid value.",
        })),
      },
    } satisfies ApiError);
    return;
  }
  if (error instanceof IdempotencyConflictError) {
    void reply.code(409).send(apiError("idempotency_conflict", error.message));
    return;
  }
  if (error instanceof IdempotencyInProgressError) {
    void reply
      .code(409)
      .header("retry-after", "1")
      .send(apiError("idempotency_in_progress", error.message));
    return;
  }
  if (error instanceof RunQueueUnavailableError) {
    request.log.error(
      { err: { type: error.name, cause: (error.cause as Error | undefined)?.name } },
      "run queue unavailable",
    );
    void reply.code(503).send(apiError("queue_unavailable", error.message));
    return;
  }
  // A brief edited or reviewed since the client read it: reload and retry.
  if (error.message === opportunityBriefVersionStaleErrorMessage) {
    void reply
      .code(409)
      .send(apiError("brief_version_stale", "The job brief has a newer version; reload it."));
    return;
  }
  if (error.message === opportunityBriefNotFoundErrorMessage) {
    void reply.code(404).send(apiError("not_found", "No such job brief."));
    return;
  }
  // The directory's messages are fixed and never quote an email, so they are safe to answer with.
  if (error instanceof TenantDirectoryError) {
    void reply.code(tenantDirectoryStatus[error.code]).send(apiError(error.code, error.message));
    return;
  }
  // The ledger's messages are fixed and never quote a note, so they are safe to answer with.
  if (error instanceof ConsentLedgerError) {
    void reply.code(400).send(apiError(error.code, error.message));
    return;
  }
  if (error instanceof HostedKnowledgeIntakeError) {
    void reply.code(intakeStatus[error.code]).send(apiError(error.code, error.message));
    return;
  }
  // An action the run's state does not allow, such as approving a run that is still drafting.
  if (error instanceof RunTransitionError) {
    void reply.code(409).send(apiError(error.code, error.message));
    return;
  }
  if (error instanceof RunActionError) {
    void reply.code(runActionStatus[error.code]).send(apiError(error.code, error.message));
    return;
  }
  // A workspace not created yet; its message names a storage path, so a fixed one replaces it.
  if (error instanceof WorkspaceNotFoundError) {
    void reply.code(404).send(apiError("not_found", "No such workspace."));
    return;
  }
  // The application service's user errors are its stable, user-facing refusals, as is a run's
  // model profile pair that the registry or the workspace's models refuse.
  if (error instanceof CliUserError || error instanceof RunModelProfileError) {
    void reply.code(422).send(apiError("rejected", error.message));
    return;
  }
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    // Fastify's own client errors, such as a body over the size limit or malformed JSON. Their
    // codes are stable; their messages can quote the input, so a fixed one replaces them.
    void reply
      .code(status)
      .send(apiError(clientErrorCode(error), "The request could not be processed."));
    return;
  }
  request.log.error({ err: { type: error.name, code: error.code } }, "request failed");
  void reply.code(500).send(apiError("internal", "The server could not complete the request."));
}

function clientErrorCode(error: FastifyError): string {
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return "payload_too_large";
  if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return "unsupported_media_type";
  return "bad_request";
}
