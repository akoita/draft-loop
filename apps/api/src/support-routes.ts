import { randomUUID } from "node:crypto";
import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { prepareCallsPerCreditedApplication } from "@draft-loop/schemas/entitlements";
import {
  type FeedbackStore,
  maximumSupportTranscriptTurnCharacters,
  maximumSupportTranscriptTurns,
  supportTicketKeepDays,
} from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import {
  createSupportAssistant,
  type SupportAccountPort,
  type SupportAccountSummary,
  type SupportModel,
  type SupportRunStatus,
  type SupportUsageLedger,
  supportPromptVersion,
} from "@draft-loop/support";
import { helpSectionIds } from "@draft-loop/user-guide";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { TenantEntitlementsFor } from "./entitlement-gate.js";
import { apiError, apiErrorSchema } from "./errors.js";
import type { SupportSettings } from "./support-config.js";
import { createMemorySupportLedger } from "./support-ledger.js";
import { effectiveSupportSettings, type SupportLimitSource } from "./support-limits.js";

export { createMemorySupportLedger } from "./support-ledger.js";

/** The only model the assistant calls: the cheapest Claude, enough to answer from a guide. */
export const supportModelId = "claude-haiku-5-5";

export interface SupportRoutesOptions {
  readonly settings: SupportSettings;
  readonly service: Pick<ApplicationService, "listApplications" | "status">;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The deployment's Claude route, read per request; without it every reply is guide search. */
  readonly route: () => AnthropicRouteBuilder | undefined;
  /** Sign-in mode's plans and credits; owner-token mode has none. */
  readonly entitlementsFor?: TenantEntitlementsFor;
  readonly usage?: SupportUsageLedger;
  /** The operator's run-time overrides of `settings`; without it only the environment applies. */
  readonly limits?: SupportLimitSource;
  /** Where a handed-off conversation goes; without it the hand-off route answers 404. */
  readonly feedback?: Pick<FeedbackStore, "openSupportTicket">;
  readonly now?: () => Date;
}

const workspaceParams = z.strictObject({ workspaceId: z.string().min(1).max(256) });
const conversationParams = workspaceParams.extend({
  conversationId: z.string().regex(/^sup_[A-Za-z0-9-]{8,64}$/u),
});

const messageBody = z.strictObject({
  question: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe("The member's question, 1000 characters at most."),
  language: z.enum(["en", "fr"]).describe("The screen's language; the answer is in it."),
  history: z
    .array(
      z.strictObject({
        role: z.enum(["member", "assistant"]),
        text: z.string().max(2000),
      }),
    )
    .max(20)
    .default([])
    .describe(
      "Earlier turns, oldest first, as the screen shows them; the server keeps none and sends the last six.",
    ),
});

const handoffBody = z.strictObject({
  consent: z
    .literal(true)
    .describe("The member agreed to share this conversation with the people who run DraftLoop."),
  transcript: z
    .array(
      z.strictObject({
        role: z.enum(["member", "assistant"]),
        text: z.string().min(1).max(maximumSupportTranscriptTurnCharacters),
      }),
    )
    .min(1)
    .max(maximumSupportTranscriptTurns)
    .describe("The conversation as the screen shows it, oldest first."),
});

/** The ticket's one-paragraph summary: its size and the member's first question. */
function handoffSummary(transcript: readonly { role: string; text: string }[]): string {
  const first = transcript.find((turn) => turn.role === "member")?.text ?? "";
  const head = `Support conversation of ${transcript.length} turns, handed to a person. First question: `;
  const room = 800 - head.length;
  const question = first.length > room ? `${first.slice(0, room - 1)}…` : first;
  return `${head}${question}`;
}

const sectionIdSchema = z.enum(helpSectionIds);

/** The fallback reasons that are a limit, not a failure: each logs `support_limited`. */
const limitReasons: ReadonlySet<string> = new Set([
  "member_rate",
  "member_limit",
  "cost_cap",
  "question_too_long",
]);

const supportReplySchema = z
  .object({
    conversation_id: z.string(),
    mode: z
      .enum(["assistant", "guide_search"])
      .describe(
        "`assistant` when the model answered; `guide_search` when it could not, with `reason`.",
      ),
    outcome: z.enum(["answered", "refused", "needs_person"]).nullable(),
    reason: z
      .enum([
        "disabled",
        "member_rate",
        "member_limit",
        "cost_cap",
        "question_too_long",
        "model_failed",
        "no_answer",
      ])
      .nullable(),
    text: z.string().nullable().describe("The answer, as plain text; null for guide search."),
    sections: z
      .array(
        z.object({
          id: sectionIdSchema,
          title: z.string(),
          paragraphs: z
            .array(z.string())
            .describe("Empty for an answer; the section's text for guide search."),
        }),
      )
      .describe("The guide sections the answer used, or that match the question, best first."),
    ticket_id: z.string().nullable(),
  })
  .meta({ id: "SupportReply" });

/**
 * Support conversations (#2882): a member asks how DraftLoop works and the support assistant
 * answers from the user guide and their own account, or returns the matching guide sections when
 * it is off, over a limit, or fails. The server stores no conversation: the screen sends the
 * earlier turns with each question. Agents read the guide through `search_help` instead.
 */
export function registerSupportRoutes(
  parent: FastifyInstance,
  options: SupportRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const now = options.now ?? (() => new Date());
  const usage = options.usage ?? createMemorySupportLedger(now);
  const model = {
    company: "anthropic",
    modelId: supportModelId,
    role: "author",
    promptTemplateVersion: supportPromptVersion,
  } as const;
  const pricing = catalogModelPricing(model);
  const settingsNow = async (): Promise<SupportSettings> =>
    options.limits === undefined
      ? options.settings
      : effectiveSupportSettings(options.settings, await options.limits());

  const modelFor = (log: FastifyBaseLogger, conversationId: string): SupportModel | undefined => {
    const builder = options.route();
    if (builder === undefined) return undefined;
    const routed = builder({
      configuredModel: model,
      ...(pricing === undefined ? {} : { pricing }),
    });
    return async (request) => {
      const response = await routed.execute({
        contextSnapshotId: `support:${conversationId}`,
        model,
        systemPrompt: request.systemPrompt,
        input: request.input as never,
        // The guide is the whole system prompt and the same for every member in a language.
        promptCache: {
          systemPrompt: request.systemPrompt,
          callInstructions: "",
          stableInputMembers: 1,
          lifetime: "1h",
        },
        outputSchema: request.outputSchema as never,
        outputName: request.outputName,
        maxOutputTokens: request.maxOutputTokens,
        // The member's own question and account codes; no candidate material is sent.
        dataPolicy: {
          allowTransmission: true,
          allowedCompanies: ["anthropic"],
          sensitiveData: false,
          sensitiveDataAcknowledged: false,
        },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      log.info(
        {
          event: "support_model_call",
          conversationId,
          model: response.modelId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.cost.estimatedUsd ?? null,
        },
        "support model call",
      );
      return {
        output: response.output,
        modelId: response.modelId,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        estimatedUsd: response.cost.estimatedUsd ?? null,
      };
    };
  };

  const accountFor = (tenantId: string | undefined, workspaceId: string): SupportAccountPort => {
    const root = options.workspaceRoot(workspaceId);
    const runStatus = async (
      runId: string,
      applicationId: string,
    ): Promise<SupportRunStatus | null> => {
      const snapshot = await options.service.status({ root, runId });
      if (snapshot === undefined) return null;
      const resetsAt = snapshot.lastError?.usageLimitResetsAt;
      const wait =
        resetsAt === undefined || resetsAt === null
          ? null
          : Math.max(0, Math.round((Date.parse(resetsAt) - now().getTime()) / 1000));
      return {
        run_id: snapshot.runId,
        application_id: applicationId,
        state: snapshot.state,
        error_code: snapshot.lastError?.code ?? null,
        recoverable: snapshot.lastError === null ? null : snapshot.lastError.retryable,
        wait_seconds: Number.isFinite(wait) ? wait : null,
        updated_at: snapshot.updatedAt,
      };
    };
    const runs = async () =>
      (await options.service.listApplications({ root }))
        .flatMap((application) =>
          application.runs.map((run) => ({ applicationId: application.id, ...run })),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      accountSummary: async (): Promise<SupportAccountSummary> => {
        if (tenantId === undefined || options.entitlementsFor === undefined) {
          return { plan: "self-hosted", credits: null, counters: [] };
        }
        const tenant = options.entitlementsFor(tenantId);
        const [assignment, entitlements] = await Promise.all([
          tenant.assignment(),
          tenant.entitlements(),
        ]);
        if (assignment === undefined || entitlements === undefined) {
          return { plan: "none", credits: null, counters: [] };
        }
        const balance = await tenant.ledger.balance(now());
        return {
          plan: assignment.planId,
          credits: balance.unlimited ? null : balance.remaining,
          counters: [
            {
              name: "credits_this_period",
              used: balance.allowanceUsed,
              limit: balance.unlimited ? null : balance.allowance,
            },
            { name: "runs_per_day", used: null, limit: entitlements.runsPerDay },
            { name: "model_calls_per_day", used: null, limit: entitlements.modelCallsPerDay },
            {
              name: "prepare_calls_per_paid_application",
              used: null,
              limit: balance.unlimited ? null : prepareCallsPerCreditedApplication,
            },
          ],
        };
      },
      recentRuns: async (limit) => {
        const recent = (await runs()).slice(0, limit);
        const statuses = await Promise.all(
          recent.map((run) => runStatus(run.id, run.applicationId)),
        );
        return statuses.filter((status): status is SupportRunStatus => status !== null);
      },
      runStatus: async (runId) => {
        const run = (await runs()).find((candidate) => candidate.id === runId);
        return run === undefined ? null : runStatus(run.id, run.applicationId);
      },
      serviceStatus: async () => options.settings.serviceStatus,
    };
  };

  app.post(
    "/v1/workspaces/:workspaceId/support/conversations",
    {
      schema: {
        summary: "Start a support conversation",
        description:
          "Returns a new conversation id for the screen to send questions with. The server stores nothing until the member hands the conversation to a person. `assistant_available` is false when the server answers with guide search only.",
        params: workspaceParams,
        response: {
          201: z.object({ conversation_id: z.string(), assistant_available: z.boolean() }),
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      return reply.code(201).send({
        conversation_id: `sup_${randomUUID()}`,
        assistant_available: (await settingsNow()).enabled && options.route() !== undefined,
      });
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/support/conversations/:conversationId/messages",
    {
      bodyLimit: 64 * 1024,
      schema: {
        summary: "Ask the support assistant a question",
        description:
          "Answers from the user guide and the caller's own plan, credits and runs in this record, in `language`. Falls back to the matching guide sections, with `reason`, when the assistant is off, the member asks faster than the per-minute limit (`member_rate`), the member's daily questions (`member_limit`) or the server's daily cost cap (`cost_cap`) are spent, or the model fails. Questions do not count against the plan's model calls.",
        params: conversationParams,
        body: messageBody,
        response: {
          200: supportReplySchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      const { workspaceId, conversationId } = request.params;
      const memberId = caller.kind === "member" ? caller.memberId : "owner";
      const supportModel = modelFor(request.log, conversationId);
      const settings = await settingsNow();
      const organisationId = caller.kind === "member" ? caller.tenantId : undefined;
      const assistant = createSupportAssistant({
        model: supportModel ?? (async () => Promise.reject(new Error("no route"))),
        account: accountFor(caller.kind === "member" ? caller.tenantId : undefined, workspaceId),
        usage,
        limits: {
          enabled: settings.enabled && supportModel !== undefined,
          memberQuestionsPerMinute: settings.memberQuestionsPerMinute,
          memberDailyQuestions: settings.memberDailyQuestions,
          dailyCostCapUsd: settings.dailyCostCapUsd,
        },
        // One content-free line per tool call and per reply, and a warning when a limit refused
        // the model, naming whose limit, so the operator can see abuse and alert on the cap.
        onAudit: (event) => {
          request.log.info({ event: `support_${event.kind}`, ...event }, "support");
          if (event.kind === "reply" && limitReasons.has(event.result)) {
            request.log.warn(
              {
                event: "support_limited",
                reason: event.result,
                memberId,
                ...(organisationId === undefined ? {} : { organisationId }),
              },
              "support assistant limit reached",
            );
          }
        },
        now: () => now().toISOString(),
      });
      const answer = await assistant.answer({
        memberId,
        conversationId,
        language: request.body.language,
        question: request.body.question,
        history: request.body.history,
      });
      if (answer.mode === "assistant") {
        return {
          conversation_id: conversationId,
          mode: answer.mode,
          outcome: answer.outcome,
          reason: null,
          text: answer.text,
          sections: answer.sections.map((section) => ({ ...section, paragraphs: [] })),
          ticket_id: answer.ticketId,
        };
      }
      return {
        conversation_id: conversationId,
        mode: answer.mode,
        outcome: null,
        reason: answer.reason,
        text: null,
        sections: answer.sections.map(({ id, title, paragraphs }) => ({
          id,
          title,
          paragraphs: [...paragraphs],
        })),
        ticket_id: null,
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/support/conversations/:conversationId/handoff",
    {
      bodyLimit: 64 * 1024,
      schema: {
        summary: "Hand a support conversation to a person",
        description: `Members only, with \`consent\` true: stores the conversation as a support ticket the operator reads with feedback notes, kept ${supportTicketKeepDays} days and erased with the organisation. Owner-token mode has no organisation and answers 404.`,
        params: conversationParams,
        body: handoffBody,
        response: {
          201: z.object({ ticket_id: z.string() }),
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      if (caller.kind !== "member" || options.feedback === undefined) {
        return reply.code(404).send(apiError("not_found", "No such route."));
      }
      try {
        const ticket = await options.feedback.openSupportTicket({
          organisationId: caller.tenantId,
          memberId: caller.memberId,
          summary: handoffSummary(request.body.transcript),
          transcript: request.body.transcript,
          now: now(),
        });
        // The log names the ticket and its conversation, never their words.
        request.log.info(
          {
            event: "support_handoff",
            conversationId: request.params.conversationId,
            ticketId: ticket.noteId,
            turns: request.body.transcript.length,
          },
          "support conversation handed to a person",
        );
        return reply.code(201).send({ ticket_id: ticket.noteId });
      } catch (error) {
        if (!(error instanceof TenantDirectoryError)) throw error;
        return reply.code(400).send(apiError("invalid_input", error.message));
      }
    },
  );
}
