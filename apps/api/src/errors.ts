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
import {
  CandidateRecordAccessError,
  type CandidateRecordAccessErrorCode,
} from "@draft-loop/storage/candidate-records";
import { ConsentLedgerError } from "@draft-loop/storage/consent-ledger";
import {
  ContentScreeningStoreError,
  type ContentScreeningStoreErrorCode,
} from "@draft-loop/storage/content-screening";
import { RecordArchiveError } from "@draft-loop/storage/record-archive";
import {
  TenantDirectoryError,
  type TenantDirectoryErrorCode,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  MaterialQuarantinedError,
  MaterialUnscreenedError,
  quarantinedMaterialSchema,
  unscreenedMaterialSchema,
} from "./content-screening-views.js";
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
      quarantined: z
        .array(quarantinedMaterialSchema)
        .optional()
        .describe(
          "With material_quarantined, the stored screening results that hold the request; each resultId is what a release names.",
        ),
      unscreened: z
        .array(unscreenedMaterialSchema)
        .optional()
        .describe(
          "With material_unscreened, the material that has no stored screening result, by ids only.",
        ),
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

/** Which consent a refused request lacked; each is the API's error code. */
export type ConsentRequiredCode = "storage_consent_required" | "transmission_consent_required";

const consentRequiredMessages: Readonly<Record<ConsentRequiredCode, string>> = {
  storage_consent_required:
    "The candidate record has no current material storage consent; record one before uploading.",
  transmission_consent_required:
    "The candidate record's current provider transmission consent does not name every provider " +
    "the workspace's models use; record one that does before running.",
};

/** A request refused because the candidate record's current consent does not cover it (D7). */
export class ConsentRequiredError extends Error {
  readonly code: ConsentRequiredCode;

  constructor(code: ConsentRequiredCode) {
    super(consentRequiredMessages[code]);
    this.name = "ConsentRequiredError";
    this.code = code;
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

/** The screening store's refusals by HTTP status; the codes are the API's error codes too. */
const contentScreeningStatus: Readonly<Record<ContentScreeningStoreErrorCode, number>> = {
  invalid_input: 400,
  subject_not_found: 404,
  result_not_found: 404,
  result_superseded: 409,
  not_releasable: 409,
};

/** The tenant directory's refusals by HTTP status; the codes are the API's error codes too. */
const tenantDirectoryStatus: Readonly<Record<TenantDirectoryErrorCode, number>> = {
  invalid_input: 400,
  organisation_exists: 409,
  organisation_not_found: 404,
  member_exists: 409,
  member_not_found: 404,
  last_owner: 409,
  forbidden: 403,
};

/** Record access's refusals by HTTP status; the codes are the API's error codes too. */
const recordAccessStatus: Readonly<Record<CandidateRecordAccessErrorCode, number>> = {
  invalid_input: 400,
  member_not_found: 404,
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
  // Record access's messages are fixed and never quote an id, so they are safe to answer with.
  if (error instanceof CandidateRecordAccessError) {
    void reply.code(recordAccessStatus[error.code]).send(apiError(error.code, error.message));
    return;
  }
  // Quarantined material names its ids and verdicts only, so the answer can list it.
  if (error instanceof MaterialQuarantinedError) {
    void reply.code(409).send({
      error: {
        code: "material_quarantined",
        message: error.message,
        quarantined: [...error.quarantined],
      },
    } satisfies ApiError);
    return;
  }
  if (error instanceof MaterialUnscreenedError) {
    void reply.code(409).send({
      error: {
        code: "material_unscreened",
        message: error.message,
        unscreened: [...error.unscreened],
      },
    } satisfies ApiError);
    return;
  }
  // The store's messages are fixed and never quote the screened text, so they are safe to answer with.
  if (error instanceof ContentScreeningStoreError) {
    void reply
      .code(contentScreeningStatus[error.code])
      .send(apiError(error.code === "result_not_found" ? "not_found" : error.code, error.message));
    return;
  }
  if (error instanceof ConsentRequiredError) {
    void reply.code(409).send(apiError(error.code, error.message));
    return;
  }
  // The ledger's messages are fixed and never quote a note, so they are safe to answer with.
  if (error instanceof ConsentLedgerError) {
    void reply.code(400).send(apiError(error.code, error.message));
    return;
  }
  // An archive whose stored object is missing or changed; the message names no location.
  if (error instanceof RecordArchiveError) {
    void reply.code(409).send(apiError("archive_integrity", error.message));
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
  // A run the caller's tenant does not have answers the same whether it never existed or belongs
  // to another organisation; the CLI's message quotes the id, so a fixed one replaces it.
  if (error instanceof RunActionError && error.code === "run_not_found") {
    void reply.code(404).send(apiError("not_found", "No such run."));
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
