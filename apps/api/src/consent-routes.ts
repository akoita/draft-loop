import type { ApplicationService } from "@draft-loop/application";
import {
  type ConsentAction,
  type ConsentBasis,
  type ConsentEntry,
  type ConsentKind,
  type ConsentLedger,
  type ConsentRecorder,
  consentActions,
  consentKinds,
  currentConsents,
  maximumConsentNoteLength,
} from "@draft-loop/storage/consent-ledger";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface ConsentRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** Each candidate record's consent ledger (ADR 0011, D7). */
  readonly consents: ConsentLedger;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });

const kindSchema = z.enum(consentKinds as [ConsentKind, ...ConsentKind[]]);
const actionSchema = z.enum(consentActions as [ConsentAction, ...ConsentAction[]]);
const basisSchema = z.enum([
  "candidate-consent",
  "contract",
  "legitimate-interest",
] satisfies ConsentBasis[]);
/** The companies the model gateway routes, as workspaces name their models. */
const providerSchema = z.enum(["anthropic", "openai"]);

const recorderSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("owner") }),
    z.object({ kind: z.literal("member"), memberId: z.string() }),
  ])
  .describe("Who recorded the entry: the owner token or a signed-in member.");

const entrySchema = z
  .object({
    id: z.string(),
    kind: kindSchema,
    action: actionSchema,
    basis: basisSchema,
    recordedBy: recorderSchema,
    providers: z.array(z.string()).describe("The providers a transmission grant names."),
    note: z.string().optional(),
    recordedAt: z.string(),
  })
  .meta({ id: "ConsentEntry" });

const consentsSchema = z
  .object({
    current: z
      .object({
        "material-storage": entrySchema.nullable(),
        "provider-transmission": entrySchema.nullable(),
      })
      .describe("Each kind's latest entry, or null when none was recorded."),
    history: z.array(entrySchema).describe("Every entry, oldest first."),
  })
  .meta({ id: "Consents" });

const recordBody = z.strictObject({
  kind: kindSchema,
  action: actionSchema,
  basis: basisSchema.describe(
    "Material storage takes any basis; provider transmission only the candidate's consent.",
  ),
  providers: z
    .array(providerSchema)
    .max(8)
    .optional()
    .describe("Required on a provider transmission grant, and only there."),
  note: z.string().max(maximumConsentNoteLength).optional(),
});

/**
 * The id the consent ledger keys a workspace's entries by: its record id, which the API never
 * shows. An unknown workspace throws the service's not-found error.
 */
export async function consentRecordId(
  service: Pick<ApplicationService, "readWorkspace">,
  workspaceRoot: (workspaceId: string) => string,
  workspaceId: string,
): Promise<string> {
  return (await service.readWorkspace(workspaceRoot(workspaceId))).id;
}

/** Copies only the schema's fields: the record id the ledger keys by stays internal. */
function entryView(entry: ConsentEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    action: entry.action,
    basis: entry.basis,
    recordedBy: entry.recordedBy,
    providers: [...entry.providers],
    ...(entry.note === undefined ? {} : { note: entry.note }),
    recordedAt: entry.recordedAt,
  };
}

/** The caller as the ledger records them; never taken from the request body. */
function recorderOf(request: FastifyRequest): ConsentRecorder | undefined {
  const caller = request.caller;
  if (caller === undefined) return undefined;
  return caller.kind === "member" ? { kind: "member", memberId: caller.memberId } : caller;
}

/**
 * One content-free line per entry: ids, the kind and the action only, never the note. The
 * hash-chained audit trail needs the workspace's history record, which a workspace gets only once
 * it stores material, and consent comes first, so entries are mirrored in the structured log.
 */
function auditConsent(request: FastifyRequest, workspaceId: string, entry: ConsentEntry): void {
  request.log.info(
    {
      audit: {
        action: "consent_recorded",
        workspaceId,
        consentId: entry.id,
        kind: entry.kind,
        consentAction: entry.action,
        ...(entry.recordedBy.kind === "member" ? { memberId: entry.recordedBy.memberId } : {}),
      },
    },
    "consent recorded",
  );
}

/**
 * A candidate record's consent ledger (ADR 0011, D7): its current state and history, and new
 * grants and withdrawals. The ledger keys by the workspace's record id; an unknown workspace
 * answers 404 through the service's not-found error.
 */
export function registerConsentRoutes(
  parent: FastifyInstance,
  options: ConsentRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, consents } = options;
  const recordId = (workspaceId: string) => consentRecordId(service, workspaceRoot, workspaceId);
  const unauthorized = (reply: FastifyReply) =>
    reply.code(401).send(apiError("unauthorized", "A credential is required."));

  app.get(
    "/v1/workspaces/:workspaceId/consents",
    {
      schema: {
        summary: "Read a candidate record's consents: the current state and the history",
        params: workspaceParams,
        response: { 200: consentsSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => {
      const history = await consents.history(await recordId(request.params.workspaceId));
      const current = currentConsents(history);
      const latest = (kind: ConsentKind) => {
        const entry = current[kind];
        return entry === undefined ? null : entryView(entry);
      };
      return {
        current: {
          "material-storage": latest("material-storage"),
          "provider-transmission": latest("provider-transmission"),
        },
        history: history.map(entryView),
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/consents",
    {
      schema: {
        summary: "Record a consent grant or withdrawal for a candidate record",
        description:
          "Entries are append-only: a withdrawal is a new entry. The recording member is the " +
          "caller.",
        params: workspaceParams,
        body: recordBody,
        response: {
          201: entrySchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const recordedBy = recorderOf(request);
      if (recordedBy === undefined) return unauthorized(reply);
      const workspaceId = await recordId(request.params.workspaceId);
      const { kind, action, basis, providers, note } = request.body;
      const entry = await consents.record({
        workspaceId,
        kind,
        action,
        basis,
        recordedBy,
        ...(providers === undefined ? {} : { providers }),
        ...(note === undefined ? {} : { note }),
      });
      auditConsent(request, request.params.workspaceId, entry);
      return reply.code(201).send(entryView(entry));
    },
  );
}
