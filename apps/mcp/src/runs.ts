import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkJournalApiError, type WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's run tools (#2600): price a CV run and start one on an application's
 * reviewed brief, within the agent token's monthly spend cap (`runs:start`, #2599). Approving
 * the draft, deciding findings and choosing the models stay with the candidate in DraftLoop.
 */

export interface AgentSpend {
  readonly monthly_cap_usd: number;
  readonly spent_this_month_usd: number;
  readonly remaining_usd: number;
  /** What one run reserves against the cap: the workspace's per-run cost limit. */
  readonly run_reserves_usd: number;
}

export interface AgentRunEstimate {
  readonly credits: number;
  readonly max_rounds: number;
  readonly author_tier: string;
  readonly critic_tier: string;
  readonly spend: AgentSpend | null;
  /** Whether what remains of the cap covers one more run. */
  readonly within_cap: boolean;
}

export interface AgentStartedRun {
  readonly application_id: string;
  readonly run_id: string;
  readonly state: string;
  readonly brief_id: string;
  readonly brief_version: number;
  readonly next_step: string;
}

export interface RunsApi {
  estimate(applicationId?: string): Promise<AgentRunEstimate>;
  start(applicationId: string): Promise<AgentStartedRun>;
}

interface EstimateBody {
  readonly credits: number;
  readonly maxRounds: number;
  readonly authorTier: string;
  readonly criticTier: string;
  readonly agentSpend?: {
    readonly monthlyCapUsd: number;
    readonly spentThisMonthUsd: number;
    readonly remainingUsd: number;
    readonly runReservesUsd: number;
  };
}

interface ApplicationBody {
  readonly id: string;
  readonly briefs: readonly {
    readonly briefId: string;
    readonly latestVersion: number;
    readonly status: string;
    readonly createdAt: string;
  }[];
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

function pathId(id: string): string {
  if (!idPattern.test(id)) {
    throw new WorkJournalApiError("invalid_id", "That is not a DraftLoop application id.", [
      "application_id",
    ]);
  }
  return encodeURIComponent(id);
}

/** A spent cap waits for next month, not a moment: the agent tells the candidate instead. */
function capFinal(error: unknown): never {
  if (error instanceof WorkJournalApiError && error.code === "agent_spend_cap_reached") {
    throw new WorkJournalApiError(error.code, error.message, error.fields, false);
  }
  throw error;
}

export function createRunsApi(call: WorkspaceApiCall): RunsApi {
  return {
    estimate: async (applicationId) => {
      const query = applicationId === undefined ? "" : `?applicationId=${pathId(applicationId)}`;
      const body = (await call(`/runs/estimate${query}`, { method: "GET" })) as EstimateBody;
      const spend = body.agentSpend;
      return {
        credits: body.credits,
        max_rounds: body.maxRounds,
        author_tier: body.authorTier,
        critic_tier: body.criticTier,
        spend:
          spend === undefined
            ? null
            : {
                monthly_cap_usd: spend.monthlyCapUsd,
                spent_this_month_usd: spend.spentThisMonthUsd,
                remaining_usd: spend.remainingUsd,
                run_reserves_usd: spend.runReservesUsd,
              },
        within_cap: spend !== undefined && spend.remainingUsd >= spend.runReservesUsd,
      };
    },
    start: async (applicationId) => {
      const application = (await call(`/applications/${pathId(applicationId)}`, {
        method: "GET",
      })) as ApplicationBody;
      // The newest brief the candidate reviewed, as DraftLoop's own start button picks it.
      const brief = application.briefs
        .filter(({ status }) => status === "reviewed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (brief === undefined) {
        throw new WorkJournalApiError(
          "brief_not_reviewed",
          "The candidate has not reviewed this job's requirements yet; they review them in DraftLoop before a run can start.",
        );
      }
      const run = (await call("/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
        body: JSON.stringify({
          applicationId: application.id,
          opportunityBrief: { briefId: brief.briefId, version: brief.latestVersion },
        }),
      }).catch(capFinal)) as { readonly runId: string; readonly state: string };
      return {
        application_id: application.id,
        run_id: run.runId,
        state: run.state,
        brief_id: brief.briefId,
        brief_version: brief.latestVersion,
        next_step:
          "The run drafts and critiques the CV on its own; follow it with get_run_status. The candidate approves the draft and decides findings in DraftLoop.",
      };
    },
  };
}

export const estimateRunDescription =
  "Price a CV run on the workspace's current settings before starting one: the most credits it can need, its round limit, and what remains of this agent token's monthly spend cap with what one run reserves against it. It starts nothing and costs nothing. Needs the runs:start scope.";

export const startCvRunDescription =
  "Start a CV run for one job application, on the job requirements the candidate reviewed, with the models they chose. It spends money: call estimate_run first, start a run only when the candidate asked for one, and never start the same run twice. It reserves the workspace's per-run cost limit against this token's monthly cap and is refused past it. The candidate approves the draft in DraftLoop. Needs the runs:start scope.";

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

function answer<T extends Record<string, unknown>>(structured: T) {
  return {
    structuredContent: structured,
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
  };
}

const applicationId = z.string().min(1).max(192);

const spendSchema = z.object({
  monthly_cap_usd: z.number(),
  spent_this_month_usd: z.number(),
  remaining_usd: z.number(),
  run_reserves_usd: z.number(),
});

/** Registers the run tools on the server. */
export function registerRunTools(server: McpServer, api: RunsApi, failure: Failure): void {
  server.registerTool(
    "estimate_run",
    {
      title: "Price a CV run",
      description: estimateRunDescription,
      inputSchema: z.object({
        application_id: applicationId
          .optional()
          .describe("Price with this application's own models, if it has a pair."),
      }),
      outputSchema: z.object({
        credits: z.number(),
        max_rounds: z.number(),
        author_tier: z.string(),
        critic_tier: z.string(),
        spend: spendSchema.nullable(),
        within_cap: z.boolean(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ application_id }) => {
      try {
        return answer({ ...(await api.estimate(application_id)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "start_cv_run",
    {
      title: "Start a CV run",
      description: startCvRunDescription,
      inputSchema: z.object({ application_id: applicationId }),
      outputSchema: z.object({
        application_id: z.string(),
        run_id: z.string(),
        state: z.string(),
        brief_id: z.string(),
        brief_version: z.number(),
        next_step: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ application_id }) => {
      try {
        return answer({ ...(await api.start(application_id)) });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
