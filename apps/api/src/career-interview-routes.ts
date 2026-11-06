import {
  type AddedHostedKnowledgeSource,
  type ApplicationService,
  catalogModelPricing,
  type HostedKnowledgeIntake,
  type HostedSensitivityRules,
} from "@draft-loop/application";
import { createCareerInterviewPublisher } from "@draft-loop/application/career-interview-evidence";
import {
  CareerInterviewError,
  type CareerInterviewErrorCode,
  type CareerInterviewRecord,
  createCareerInterviewService,
} from "@draft-loop/application/career-interview-service";
import type {
  CareerInterviewFact,
  CareerInterviewRequirement,
} from "@draft-loop/application/career-interview-topics";
import {
  careerInterviewDefaultModelId,
  careerInterviewPromptVersion,
  createModelCareerInterviewer,
} from "@draft-loop/application/career-interviewer-model";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { type CareerInterviewerPort, careerInterviewProposal } from "@draft-loop/orchestrator";
import {
  careerInterviewSessionIdSchema,
  careerInterviewSessionSchema,
  careerInterviewTurnMarks,
} from "@draft-loop/schemas/career-interview";
import type { CareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import {
  type ConsentLedger,
  type ConsentState,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
import "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { type LiveInterviewSpeech, runLiveInterview } from "./career-interview-live.js";
import { consentRecordId } from "./consent-routes.js";
import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiErrorSchema } from "./errors.js";
import type { SourceEvidenceKinds } from "./work-journal-routes.js";

/** What the guided career interview needs from a deployment (#1030, #2178). */
export interface CareerInterviewParts {
  readonly sessions: CareerInterviewSessionStore;
  /** The API's Claude route; without it, starting a topic answers 503. */
  readonly route?: AnthropicRouteBuilder | undefined;
  /** The deployment's ceiling on sending candidate material to a provider. */
  readonly allowProviderData: boolean;
}

export interface CareerInterviewRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly interview: CareerInterviewParts;
  readonly consents?: ConsentLedger;
  /** Where a confirmed summary is written; without all three, confirm answers 503. */
  readonly knowledge?: {
    readonly intake: HostedKnowledgeIntake;
    readonly rules: HostedSensitivityRules;
    readonly evidenceKinds: SourceEvidenceKinds;
  };
  readonly screening?: Pick<ContentScreeningHooks, "screenUpload">;
  /** Speech for the live conversation (#2361); without it the live route is not served. */
  readonly live?: LiveInterviewSpeech;
}

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});
const sessionParams = workspaceParams.extend({ sessionId: careerInterviewSessionIdSchema });
const topicKey = z.string().trim().min(1).max(400);

const actionBody = z
  .discriminatedUnion("action", [
    z.strictObject({ action: z.literal("accept"), topic_key: topicKey }),
    z.strictObject({ action: z.literal("decline"), topic_key: topicKey }),
    z.strictObject({
      action: z.literal("own_subject"),
      subject: z.string().trim().min(1).max(300),
    }),
    z.strictObject({
      action: z.literal("answer"),
      topic_key: topicKey,
      text: z.string().max(4_000).optional(),
      mark: z.enum(careerInterviewTurnMarks).optional(),
    }),
    z.strictObject({
      action: z.literal("confirm"),
      topic_key: topicKey,
      knowledge_base_id: z.string().trim().min(1).max(200),
      tier: z.enum(["normal", "sensitive", "never-share"]).optional(),
      summary: z.string().trim().min(1).max(4_000).optional(),
    }),
    z.strictObject({ action: z.literal("set_aside"), topic_key: topicKey }),
    z.strictObject({ action: z.literal("pause") }),
    z.strictObject({ action: z.literal("close") }),
  ])
  .meta({ id: "CareerInterviewAction" });

const sessionView = z
  .object({
    session: careerInterviewSessionSchema,
    proposal: z
      .string()
      .describe("The interviewer's opening offer of the proposed topics, worded without a model."),
    published_source_id: z.string().optional(),
    interviewer_available: z
      .boolean()
      .describe(
        "Whether this server has a model route for the interviewer and allows sending it career material. When false, accept, answer and own_subject answer 503 interview_model_unavailable.",
      ),
  })
  .meta({ id: "CareerInterviewSessionView" });

const conflictsView = z
  .object({
    conflicts: z.array(
      z.object({
        kind: z.literal("date"),
        summary_value: z.string(),
        fact_id: z.string(),
        fact_value: z.string(),
      }),
    ),
  })
  .meta({ id: "CareerInterviewConflicts" });

const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
  502: apiErrorSchema,
  503: apiErrorSchema,
} as const;

const errorStatus: Readonly<Record<CareerInterviewErrorCode, number>> = {
  session_not_found: 404,
  topic_not_found: 404,
  topic_not_open: 409,
  topic_not_summarised: 409,
  too_many_topics: 409,
  invalid_answer: 422,
};

/** Raised by the interviewer port when the deployment or the record cannot reach a model. */
class InterviewUnavailableError extends Error {
  readonly code: "consent_required" | "interview_model_unavailable";

  constructor(code: "consent_required" | "interview_model_unavailable", message: string) {
    super(message);
    this.code = code;
  }
}

/** Whether the record's consent lets material go to both companies, as one author/critic pair. */
function permitsCompanies(state: ConsentState, first: string, second: string): boolean {
  return permitsTransmission(state, {
    author: { company: first as never },
    critic: { company: second as never },
  });
}

function permitsAnthropic(state: ConsentState): boolean {
  return permitsTransmission(state, {
    author: { company: "anthropic" },
    critic: { company: "anthropic" },
  });
}

/** The interviewer never needs who the candidate is or how to reach them. */
const withheldCategories = new Set(["identity", "contact"]);

/**
 * The record the interview reads: the newest career profile's facts, and the requirements of the
 * five newest applications' briefs. Profile facts were extracted under the sensitivity tiers, so
 * they already passed that boundary; identity and contact facts are withheld all the same.
 */
async function loadRecord(
  service: ApplicationService,
  root: string,
): Promise<CareerInterviewRecord> {
  const profiles = await service.listCanonicalCandidateProfileVersions({ root });
  const newest = [...profiles].sort((left, right) =>
    right.profile.updatedAt.localeCompare(left.profile.updatedAt),
  )[0];
  const facts: CareerInterviewFact[] = (newest?.profile.facts ?? []).map((fact) => ({
    id: fact.id,
    category: fact.category,
    subjectId: fact.subjectId,
    field: fact.field,
    value: fact.value,
  }));
  const requirements: CareerInterviewRequirement[] = [];
  const applications = await service.listApplications({ root });
  for (const application of applications.slice(0, 5)) {
    const briefId = application.briefs.at(-1)?.briefId;
    if (briefId === undefined) continue;
    const record = await service.getOpportunity({ root, briefId });
    for (const requirement of record?.brief.requirements ?? []) {
      requirements.push({
        id: requirement.id,
        applicationId: application.id,
        text: requirement.text,
        priority: requirement.priority,
      });
    }
  }
  return { facts, requirements, mayTransmit: (fact) => !withheldCategories.has(fact.category) };
}

/**
 * The guided career interview (#1030): a session proposes topics from the career record, the
 * candidate talks them through with a coach-style interviewer, and confirmed summaries become
 * evidence. Logs carry ids, actions and statuses, never the conversation.
 */
export function registerCareerInterviewRoutes(
  parent: FastifyInstance,
  options: CareerInterviewRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, interview, consents, knowledge, screening } = options;
  const model = {
    company: "anthropic",
    modelId: careerInterviewDefaultModelId,
    role: "author",
    promptTemplateVersion: careerInterviewPromptVersion,
  } as const;
  const pricing = catalogModelPricing(model);

  const interviewerFor = (workspaceId: string, sessionId: string): CareerInterviewerPort => ({
    reply: async (request) => {
      if (interview.route === undefined || !interview.allowProviderData) {
        throw new InterviewUnavailableError(
          "interview_model_unavailable",
          "This server has no model route for the career interview.",
        );
      }
      const recordId = await consentRecordId(service, workspaceRoot, workspaceId);
      if (consents === undefined || !permitsAnthropic(await consents.current(recordId))) {
        throw new InterviewUnavailableError(
          "consent_required",
          "Allow sending career material to Anthropic in this record's consent to use the interview.",
        );
      }
      const executor = interview.route({
        configuredModel: model,
        ...(pricing === undefined ? {} : { pricing }),
      });
      return createModelCareerInterviewer({
        executor: executor as never,
        model,
        dataPolicy: {
          allowTransmission: true,
          allowedCompanies: ["anthropic"],
          sensitiveData: true,
          sensitiveDataAcknowledged: true,
        },
        sessionId,
        language: (await service.readWorkspace(workspaceRoot(workspaceId))).language,
      }).reply(request);
    },
  });

  const serviceFor = (workspaceId: string, request: FastifyRequest) => {
    const screen =
      screening === undefined
        ? undefined
        : async (added: AddedHostedKnowledgeSource, bytes: Uint8Array) => {
            await screening.screenUpload(request, {
              knowledgeBaseId: added.source.knowledgeBaseId,
              sourceId: added.source.id,
              sourceVersionId: added.latestVersion.id,
              name: added.source.displayName,
              mediaType: added.latestVersion.mediaType,
              bytes,
            });
          };
    return createCareerInterviewService({
      store: interview.sessions,
      loadRecord: () => loadRecord(service, workspaceRoot(workspaceId)),
      interviewer: interviewerFor,
      publish:
        knowledge === undefined
          ? async () => {
              throw new InterviewUnavailableError(
                "interview_model_unavailable",
                "This server cannot store interview evidence.",
              );
            }
          : createCareerInterviewPublisher({
              intake: knowledge.intake,
              rules: knowledge.rules,
              setEvidenceKind: async (knowledgeBaseId, sourceId, kind) => {
                await knowledge.evidenceKinds.appendCandidateKnowledgeSourceEvidenceKindOverride(
                  knowledgeBaseId,
                  sourceId,
                  { kind, createdAt: new Date().toISOString() },
                );
              },
              ...(screen === undefined ? {} : { screen }),
            }),
    });
  };

  const view = (session: z.infer<typeof careerInterviewSessionSchema>, published?: string) => ({
    session,
    proposal: careerInterviewProposal(
      session.topics.filter((topic) => topic.status === "proposed"),
    ),
    ...(published === undefined ? {} : { published_source_id: published }),
    interviewer_available: interview.route !== undefined && interview.allowProviderData,
  });

  const handled = async <T>(
    reply: FastifyReply,
    work: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CareerInterviewError) {
        reply
          .code(errorStatus[error.code])
          .send({ error: { code: error.code, message: error.message } });
        return undefined;
      }
      if (error instanceof InterviewUnavailableError) {
        void reply
          .code(error.code === "consent_required" ? 403 : 503)
          .send({ error: { code: error.code, message: error.message } });
        return undefined;
      }
      throw error;
    }
  };

  app.post(
    "/v1/workspaces/:workspaceId/career-interview/sessions",
    {
      schema: {
        summary: "Start or resume a guided career interview session",
        description:
          "Resumes the newest unfinished session, or starts one proposing up to two topics found in the career record and the candidate's applications. No model is called.",
        params: workspaceParams,
        response: { 200: sessionView, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await service.readWorkspace(workspaceRoot(workspaceId));
      const session = await serviceFor(workspaceId, request).start(workspaceId);
      request.log.info(
        { workspaceId, sessionId: session.id, topics: session.topics.length },
        "career interview session started",
      );
      return reply.send(view(session));
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId",
    {
      schema: {
        summary: "Read a guided career interview session",
        params: sessionParams,
        response: { 200: sessionView, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      await service.readWorkspace(workspaceRoot(workspaceId));
      const session = await handled(reply, () =>
        serviceFor(workspaceId, request).get(workspaceId, sessionId),
      );
      return session === undefined ? reply : reply.send(view(session));
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/conflicts",
    {
      schema: {
        summary: "List summary statements that disagree with the career record",
        params: sessionParams,
        querystring: z.strictObject({ topic_key: topicKey }),
        response: { 200: conflictsView, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      await service.readWorkspace(workspaceRoot(workspaceId));
      const conflicts = await handled(reply, () =>
        serviceFor(workspaceId, request).conflicts(workspaceId, sessionId, request.query.topic_key),
      );
      if (conflicts === undefined) return reply;
      return reply.send({
        conflicts: conflicts.map((conflict) => ({
          kind: conflict.kind,
          summary_value: conflict.summaryValue,
          fact_id: conflict.factId,
          fact_value: conflict.factValue,
        })),
      });
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/actions",
    {
      schema: {
        summary: "Act on a guided career interview session",
        description:
          "accept, answer and own_subject call the interviewer model and need the record's consent to send career material to Anthropic (403 consent_required) and a server model route (503). confirm writes the topic's confirmed summary as career evidence; nothing in the record is overwritten.",
        params: sessionParams,
        body: actionBody,
        response: { 200: sessionView, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params;
      await service.readWorkspace(workspaceRoot(workspaceId));
      const interviewService = serviceFor(workspaceId, request);
      const body = request.body;
      const result = await handled(reply, async () => {
        switch (body.action) {
          case "accept":
            return {
              session: await interviewService.accept(workspaceId, sessionId, body.topic_key),
            };
          case "decline":
            return {
              session: await interviewService.decline(workspaceId, sessionId, body.topic_key),
            };
          case "own_subject":
            return {
              session: await interviewService.ownSubject(workspaceId, sessionId, body.subject),
            };
          case "answer": {
            if ((body.text === undefined) === (body.mark === undefined)) {
              throw new CareerInterviewError("invalid_answer", "Send either text or a mark.");
            }
            const answer =
              body.mark === undefined ? { text: body.text ?? "" } : { mark: body.mark };
            return {
              session: await interviewService.answer(
                workspaceId,
                sessionId,
                body.topic_key,
                answer,
              ),
            };
          }
          case "confirm": {
            const confirmed = await interviewService.confirm(
              workspaceId,
              sessionId,
              body.topic_key,
              {
                knowledgeBaseId: body.knowledge_base_id,
                tier: body.tier ?? "normal",
                ...(body.summary === undefined ? {} : { summary: body.summary }),
              },
            );
            return { session: confirmed.session, published: confirmed.published.sourceId };
          }
          case "set_aside":
            return {
              session: await interviewService.setAside(workspaceId, sessionId, body.topic_key),
            };
          case "pause":
            return { session: await interviewService.pause(workspaceId, sessionId) };
          case "close":
            return { session: await interviewService.close(workspaceId, sessionId) };
        }
      });
      if (result === undefined) return reply;
      request.log.info(
        { workspaceId, sessionId, action: body.action, status: result.session.status },
        "career interview action",
      );
      return reply.send(view(result.session, "published" in result ? result.published : undefined));
    },
  );

  const live = options.live;
  if (live === undefined) return;
  app.get(
    "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/live",
    {
      websocket: true,
      schema: {
        hide: true,
        params: sessionParams,
        querystring: z.strictObject({
          topic_key: topicKey,
          language: z.enum(["fr", "en"]).optional(),
        }),
      },
    },
    async (socket, request) => {
      const { workspaceId, sessionId } = request.params as z.infer<typeof sessionParams>;
      const query = request.query as { topic_key: string; language?: "fr" | "en" };
      const refuse = (code: string, message: string) => {
        socket.send(JSON.stringify({ type: "error", code, message }));
        socket.close(1008, code);
      };
      await service.readWorkspace(workspaceRoot(workspaceId));
      if (interview.route === undefined || !interview.allowProviderData) {
        refuse(
          "interview_model_unavailable",
          "This server has no model route for the career interview.",
        );
        return;
      }
      const recordId = await consentRecordId(service, workspaceRoot, workspaceId);
      const consent = consents === undefined ? undefined : await consents.current(recordId);
      if (
        consent === undefined ||
        !permitsCompanies(consent, "anthropic", live.stt.identity.company)
      ) {
        refuse(
          "consent_required",
          `Allow sending career material to Anthropic and ${live.stt.identity.company} in this record's consent to talk live.`,
        );
        return;
      }
      const interviewService = serviceFor(workspaceId, request);
      request.log.info({ workspaceId, sessionId }, "live career interview started");
      await runLiveInterview({
        socket,
        speech: live,
        language: query.language,
        answer: async (text) => {
          const session = await interviewService.answer(workspaceId, sessionId, query.topic_key, {
            text,
          });
          const topic = session.topics.find((candidate) => candidate.key === query.topic_key);
          const last = topic?.turns.at(-1);
          const open = topic?.status === "open";
          return {
            view: view(session),
            question: open && last?.role === "interviewer" ? last.text : undefined,
            open,
          };
        },
        refusal: (error) => {
          if (error instanceof CareerInterviewError || error instanceof InterviewUnavailableError) {
            return { code: error.code, message: error.message };
          }
          request.log.error({ err: error, workspaceId, sessionId }, "live career interview failed");
          return { code: "live_failed", message: "The live conversation stopped. Try again." };
        },
        onEnd: (usage) =>
          request.log.info({ workspaceId, sessionId, ...usage }, "live career interview ended"),
      });
    },
  );
}
