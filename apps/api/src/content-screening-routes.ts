import {
  type ApplicationService,
  type HostedKnowledgeIntake,
  HostedKnowledgeIntakeError,
  type OpportunitySourceInput,
  quarantinedRunMaterial,
  unscreenedRunMaterial,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import { ingestBytes } from "@draft-loop/ingestion";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import {
  type ConsentLedger,
  type ConsentState,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
import {
  type ContentScreeningSubject,
  maximumScreeningReleaseReasonLength,
} from "@draft-loop/storage/content-screening";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { logAccessRefusal } from "./access-refusal-log.js";
import { consentRecordId } from "./consent-routes.js";
import type { HostedContentScreening } from "./content-screening-service.js";
import {
  MaterialQuarantinedError,
  MaterialUnscreenedError,
  type OpportunityScreening,
  opportunityScreening,
  quarantinedMaterial,
  type ScreeningOutcome,
  screeningOutcome,
  screeningReleaseSchema,
  screeningReleaseView,
  screeningStatusListSchema,
  screeningStatusView,
  unscreenedMaterial,
} from "./content-screening-views.js";
import { apiError, apiErrorSchema } from "./errors.js";
import type { KnowledgeOwnersFor } from "./knowledge-access.js";
import { reachesEveryRecord } from "./record-access.js";
import { tenantIdOf } from "./tenant-context.js";

export interface ContentScreeningRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The caller's tenant's screening, bound to the request before these routes run. */
  readonly screening: HostedContentScreening;
  /** The candidate records' consent; without it a candidate source never reaches the model. */
  readonly consents?: ConsentLedger;
  /** The tenant's knowledge intake, for the latest version of each source a run would use. */
  readonly knowledgeIntake?: Pick<HostedKnowledgeIntake, "listSources" | "listKnowledgeBases">;
  /** Which record owns each knowledge base; without it every base is tenant-wide. */
  readonly knowledgeOwnersFor?: KnowledgeOwnersFor;
  /** The tenant the owner token acts in. */
  readonly ownerTenantId?: string;
  /**
   * In sign-in mode each knowledge base belongs to one record, and only that record releases its
   * sources. Owner-token mode keeps bases tenant-wide, so any record of the tenant may.
   */
  readonly authMode: "owner" | "oidc";
}

/** A candidate file just stored, with its bytes for screening. */
export interface ScreenedUpload {
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/** What the intake and run routes call; the release route is registered with it. */
export interface ContentScreeningHooks {
  /** Screens a created brief's sources; undefined when screening is off. */
  screenOpportunity(
    request: FastifyRequest,
    record: OpportunityBriefVersionRecord,
    sources: readonly OpportunitySourceInput[],
  ): Promise<OpportunityScreening | undefined>;
  /** Screens an uploaded file's text; undefined when screening is off and nothing was stored. */
  screenUpload(
    request: FastifyRequest,
    upload: ScreenedUpload,
  ): Promise<ScreeningOutcome | undefined>;
  /** Refuses with `MaterialQuarantinedError` when the run would use quarantined material. */
  assertRunMaterialClear(input: {
    /** The API's id for the record, which the driver's reference is built from. */
    readonly workspaceId: string;
    readonly workspace: WorkspaceDescriptor;
    readonly opportunityBrief?: { readonly briefId: string; readonly version: number } | undefined;
  }): Promise<void>;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const statusParams = z.strictObject({ workspaceId: identifierSchema });
const releaseParams = z.strictObject({ workspaceId: identifierSchema, resultId: identifierSchema });
const releaseBody = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(maximumScreeningReleaseReasonLength)
    .describe("Why the text is let through: a short note, never candidate material."),
});

const ownersAndAdminsOnly = apiError(
  "forbidden",
  "Only the organisation's owners and admins release quarantined material.",
);
const noSuchResult = apiError("not_found", "No such screening result.");

/** The member recorded for a release; the owner token has no member, as in the audit lines. */
const ownerTokenActor = "owner-token";

/** Whether the record's consent names Anthropic, the company the model screener calls. */
function permitsAnthropic(state: ConsentState): boolean {
  return permitsTransmission(state, {
    author: { company: "anthropic" },
    critic: { company: "anthropic" },
  });
}

/** The candidate's own words in a brief source, which a model would read as instructions. */
function candidateInputText(source: Extract<OpportunitySourceInput, { kind: "candidate-input" }>) {
  const { instructions } = source;
  return [
    source.content,
    instructions?.tone,
    instructions?.applicationGoal,
    ...(instructions?.forbiddenLanguage ?? []),
    ...(instructions?.focusAreas ?? []),
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

/** The text of an uploaded file as the run's extraction reads it; undefined when none is read. */
async function extractedText(upload: ScreenedUpload): Promise<string | undefined> {
  try {
    const result = await ingestBytes(
      { path: upload.name, mediaType: upload.mediaType },
      upload.bytes,
    );
    const text = result.source?.text;
    return text === undefined || text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * Injection screening at intake, the run gate and the release (ADR 0011, phase 2d). Job sources
 * and candidate uploads are screened after they are saved, so their ids exist; a screener that
 * fails leaves the text unscreened, which is quarantined, and never fails the request. A run
 * refuses quarantined material whatever the mode, so `off` only stops new results. With screening
 * on, a run also refuses material with no stored result (409 `material_unscreened`). A candidate
 * source reaches the model screener only when its record's consent names Anthropic. Owners and
 * admins release a result, once, with a reason; the store audits it.
 */
export function registerContentScreening(
  parent: FastifyInstance,
  options: ContentScreeningRoutesOptions,
): ContentScreeningHooks {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, screening, consents, knowledgeIntake, knowledgeOwnersFor } =
    options;

  /** The record that owns the base, in sign-in mode; none for a tenant-wide base. */
  const baseOwner = async (
    request: FastifyRequest,
    knowledgeBaseId: string,
  ): Promise<string | undefined> => {
    const tenantId = tenantIdOf(request.caller, options.ownerTenantId);
    if (tenantId === undefined || knowledgeOwnersFor === undefined) return undefined;
    return knowledgeOwnersFor(tenantId).ownerOf(knowledgeBaseId);
  };

  /**
   * Whether the record's ledger holds a current grant naming Anthropic. Any failure to find out
   * means no consent, which only narrows what the model reads.
   */
  const recordConsents = async (recordId: () => Promise<string | undefined>): Promise<boolean> => {
    if (screening.mode !== "rules+model" || consents === undefined) return false;
    try {
      const id = await recordId();
      return id !== undefined && permitsAnthropic(await consents.current(id));
    } catch {
      return false;
    }
  };

  const screenOpportunity: ContentScreeningHooks["screenOpportunity"] = async (
    request,
    record,
    sources,
  ) => {
    if (screening.mode === "off") return undefined;
    const candidateConsent = await recordConsents(async () => record.workspaceId);
    const screened = await Promise.all(
      sources.flatMap((source) => {
        if (source.kind !== "pasted-content" && source.kind !== "candidate-input") return [];
        const candidate = source.kind === "candidate-input";
        return [
          screening
            .screen({
              subject: {
                kind: "job-source",
                workspaceId: record.workspaceId,
                briefId: record.brief.id,
                sourceId: source.id,
              },
              text: candidate ? candidateInputText(source) : source.content,
              kind: candidate ? "candidate-source" : "job-source",
              candidateConsent,
              log: request.log,
            })
            .then((stored) => ({ sourceId: source.id, stored })),
        ];
      }),
    );
    const stored = screened.flatMap(({ sourceId, stored }) =>
      stored === undefined ? [] : [{ sourceId, stored }],
    );
    return stored.length === 0 ? undefined : opportunityScreening(stored);
  };

  const screenUpload: ContentScreeningHooks["screenUpload"] = async (request, upload) => {
    const subject: ContentScreeningSubject = {
      kind: "knowledge-source-version",
      knowledgeBaseId: upload.knowledgeBaseId,
      sourceId: upload.sourceId,
      sourceVersionId: upload.sourceVersionId,
    };
    // The same bytes again answer with the source's existing result, unless a screener was down
    // and no release has covered that result: screening it again is the retry.
    const existing = await screening.store.latestFor(subject);
    const retry = existing?.result.verdict === "unscreened" && existing.release === undefined;
    if (existing !== undefined && !(retry && screening.mode !== "off")) {
      return screeningOutcome(existing);
    }
    if (screening.mode === "off") return undefined;
    const candidateConsent = await recordConsents(async () => {
      const owner = await baseOwner(request, upload.knowledgeBaseId);
      return owner === undefined ? undefined : consentRecordId(service, workspaceRoot, owner);
    });
    const stored = await screening.screen({
      subject,
      text: await extractedText(upload),
      kind: "candidate-source",
      candidateConsent,
      log: request.log,
    });
    return stored === undefined ? undefined : screeningOutcome(stored);
  };

  const assertRunMaterialClear: ContentScreeningHooks["assertRunMaterialClear"] = async ({
    workspaceId,
    workspace,
    opportunityBrief,
  }) => {
    const brief =
      opportunityBrief === undefined
        ? undefined
        : await service.getOpportunity({
            root: workspaceRoot(workspaceId),
            briefId: opportunityBrief.briefId,
            version: opportunityBrief.version,
          });
    const material = {
      brief,
      knowledgeBaseIds: (workspace.candidateKnowledgeSelection ?? []).map(
        (entry) => entry.knowledgeBaseId,
      ),
    };
    const readers = { store: screening.store, listSources: knowledgeIntake?.listSources };
    const quarantined = await quarantinedRunMaterial(readers, material);
    if (quarantined.length > 0) {
      throw new MaterialQuarantinedError(quarantined.map(quarantinedMaterial));
    }
    // With screening on, no stored result is never clear. The brief's text and the uploaded
    // file's bytes are not at hand here, so the run is refused and the material is screened
    // again by saving the brief or uploading the file anew.
    if (screening.mode === "off") return;
    const unscreened = await unscreenedRunMaterial(readers, material);
    if (unscreened.length > 0) {
      throw new MaterialUnscreenedError(unscreened.map(unscreenedMaterial));
    }
  };

  /** Whether the base is the record's: it owns it, or in owner-token mode the base is tenant-wide. */
  const baseBelongsToRecord = async (
    request: FastifyRequest,
    record: { readonly workspaceId: string },
    knowledgeBaseId: string,
  ): Promise<boolean> => {
    const owner = await baseOwner(request, knowledgeBaseId);
    return owner === undefined ? options.authMode === "owner" : owner === record.workspaceId;
  };

  /** Whether the result belongs to this record: its job source, or a base the record owns. */
  const belongsToRecord = async (
    request: FastifyRequest,
    record: { readonly workspaceId: string; readonly historyId: string },
    subject: ContentScreeningSubject,
  ): Promise<boolean> => {
    if (subject.kind === "job-source") return subject.workspaceId === record.historyId;
    return baseBelongsToRecord(request, record, subject.knowledgeBaseId);
  };

  /**
   * The ids of the knowledge bases whose screening the record shows: those it owns or selects,
   * or in owner-token mode every base of the tenant.
   */
  const recordBases = async (
    request: FastifyRequest,
    record: { readonly workspaceId: string },
    selected: readonly string[],
  ): Promise<readonly string[]> => {
    const tenantId = tenantIdOf(request.caller, options.ownerTenantId);
    const owners =
      tenantId === undefined || knowledgeOwnersFor === undefined
        ? undefined
        : knowledgeOwnersFor(tenantId);
    const candidates = new Set(selected);
    if (owners !== undefined) {
      for (const id of await owners.basesOwnedBy([record.workspaceId])) candidates.add(id);
    }
    if (options.authMode === "owner") {
      for (const { id } of (await knowledgeIntake?.listKnowledgeBases()) ?? []) candidates.add(id);
    }
    const bases: string[] = [];
    for (const knowledgeBaseId of candidates) {
      if (await baseBelongsToRecord(request, record, knowledgeBaseId)) bases.push(knowledgeBaseId);
    }
    return bases;
  };

  /** A base's statuses for the versions a run would read; older versions are not shown. */
  const latestVersionStatuses = async (knowledgeBaseId: string) => {
    let latest: ReadonlyMap<string, string> | undefined;
    try {
      const views = await knowledgeIntake?.listSources(knowledgeBaseId);
      latest =
        views && new Map(views.map(({ source, latestVersion }) => [source.id, latestVersion.id]));
    } catch (error) {
      if (error instanceof HostedKnowledgeIntakeError) return [];
      throw error;
    }
    return (await screening.store.listForKnowledgeBase(knowledgeBaseId)).filter(
      (status) =>
        latest === undefined ||
        (status.subject.kind === "knowledge-source-version" &&
          latest.get(status.subject.sourceId) === status.subject.sourceVersionId),
    );
  };

  app.get(
    "/v1/workspaces/:workspaceId/screening",
    {
      schema: {
        summary: "Read the record's injection screening status",
        description:
          "The latest screening status of each job source of the record's briefs and of each current knowledge source version in the bases the record owns or selects: verdict, closed signal codes, the result id a release names, whether it is quarantined and who released it. Content-free, never a quote. The release reason is member-written, so it is shown to owners and admins only. Empty when nothing was screened.",
        params: statusParams,
        response: { 200: screeningStatusListSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => {
      const { caller } = request;
      const { workspaceId } = request.params;
      const workspace = await service.readWorkspace(workspaceRoot(workspaceId));
      const record = { workspaceId, historyId: workspace.id };
      const bases = await recordBases(
        request,
        record,
        (workspace.candidateKnowledgeSelection ?? []).map((entry) => entry.knowledgeBaseId),
      );
      const statuses = [
        ...(await screening.store.listForRecord(workspace.id)),
        ...(await Promise.all(bases.map(latestVersionStatuses))).flat(),
      ];
      const includeReason = caller !== undefined && reachesEveryRecord(caller);
      return { statuses: statuses.map((status) => screeningStatusView(status, { includeReason })) };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/screening/:resultId/release",
    {
      schema: {
        summary: "Release quarantined material so a run may use it",
        description:
          "Lets one screening result's text through despite its verdict, with a reason of 1 to 500 characters that is never candidate material. Owners and admins only, or the owner token. Only a record's own results are released (404 otherwise); a result that a newer one replaced answers 409 result_superseded, and a clear one 409 not_releasable. Releasing a result again returns its release. The release covers that result only: a later flagged or unscreened result quarantines the text again.",
        params: releaseParams,
        body: releaseBody,
        response: {
          200: screeningReleaseSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      const { workspaceId, resultId } = request.params;
      if (caller === undefined || !reachesEveryRecord(caller)) {
        logAccessRefusal(request, { resource: "record", reason: "role", resourceId: workspaceId });
        return reply.code(403).send(ownersAndAdminsOnly);
      }
      // The history id is the record's own, as the brief tables and the audit chain address it.
      const historyId = (await service.readWorkspace(workspaceRoot(workspaceId))).id;
      const found = await screening.store.resultById(resultId);
      if (
        found === undefined ||
        !(await belongsToRecord(request, { workspaceId, historyId }, found.subject))
      ) {
        return reply.code(404).send(noSuchResult);
      }
      const memberId = caller.kind === "member" ? caller.memberId : ownerTokenActor;
      const release = await screening.store.release({
        resultId,
        memberId,
        reason: request.body.reason,
        historyId,
      });
      // Content-free: ids and codes only, never the member's reason. The store has appended its
      // own audit event to the record's chain. A release is an owner's decision to let flagged
      // text through, so it is a WARNING the owner can alert on.
      request.log.warn(
        {
          audit: { action: "content_screening_released", workspaceId, resultId, memberId },
          screening: {
            tenantId: tenantIdOf(caller, options.ownerTenantId),
            resultId,
            subjectKind: found.subject.kind,
            signals: [...found.result.signals],
          },
        },
        "quarantined material released",
      );
      return screeningReleaseView(release);
    },
  );

  return { screenOpportunity, screenUpload, assertRunMaterialClear };
}
