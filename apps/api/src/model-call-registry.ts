import type { FastifyRequest } from "fastify";

/**
 * Every path by which a member's request reaches a metered model (#3112), with the three
 * protections each must have: a per-member limit, a cost cap and a kill switch. The global model
 * call switch (`model-call-switch.ts`) refuses every route listed here, before any model call.
 *
 * `model-call-registry.test.ts` reads the source files that reach the model gateway and fails when
 * one of them is not named by an entry here, so a new model-calling feature is registered before
 * it ships. See `docs/engineering/model-call.md`.
 */
export interface ModelCallPath {
  /** A short id for logs and the guide. */
  readonly id: string;
  /** The routes that start it, by method and route pattern. */
  readonly routes: ReadonlyArray<{
    readonly method: "GET" | "POST";
    readonly url: string;
    /** When only some bodies call a model, which ones do. */
    readonly counts?: (body: unknown) => boolean;
  }>;
  /**
   * `refused`: while paused, the route answers 503 `model_calls_paused`. `skipped`: the route
   * still works and leaves the model's part undone, as a brief saved without reading the job ad.
   */
  readonly whilePaused: "refused" | "skipped";
  /** The per-member limit and where it is enforced. */
  readonly limit: string;
  /** What bounds the cost, per call or per day. */
  readonly costCap: string;
  /** The switch that stops this path alone, besides the global one. */
  readonly killSwitch: string;
  /**
   * The source files, relative to the repository root, that reach the model gateway for this
   * path. The registry test requires each gateway-reaching file to be named here.
   */
  readonly reaches: ReadonlyArray<string>;
}

const workspace = "/v1/workspaces/:workspaceId";
const application = `${workspace}/applications/:applicationId`;
const outputTokens = "each model call's output-token limit from its model profile";

export const modelCallPaths: ReadonlyArray<ModelCallPath> = [
  {
    id: "run",
    routes: [
      { method: "POST", url: `${workspace}/runs` },
      { method: "POST", url: `${workspace}/runs/:runId/revision` },
      { method: "POST", url: `${workspace}/runs/:runId/resume` },
    ],
    whilePaused: "refused",
    limit: "The plan's runs per day and credits (entitlement-gate.ts).",
    costCap:
      "The run's budget, at most the deployment's ceiling per run, reserved from the spend pool (entitlement-gate.ts, run-job-handler.ts). Claude's refusal fallback retries a declined call once, and both calls count in the run's cost at their own rates (claude-refusal-fallback.ts).",
    killSwitch:
      'An operator plan override with runsPerDay 0 for one organisation. The model call switch\'s "refusalFallback": "off" stops only the refusal fallback, read by the worker within a minute.',
    reaches: [
      "apps/api/src/application-routes.ts",
      "apps/api/src/review-routes.ts",
      "apps/worker/src/claude-refusal-fallback.ts",
      "apps/worker/src/run-job-handler.ts",
    ],
  },
  {
    id: "brief-extraction",
    routes: [{ method: "POST", url: `${workspace}/opportunities` }],
    whilePaused: "skipped",
    limit:
      "The plan's model calls per day, or the deployment's ceiling on unlimited plans (brief-extraction-allowance.ts).",
    costCap: `One call per brief, bounded by ${outputTokens}.`,
    killSwitch:
      "DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY, or a plan override of modelCallsPerDay for one organisation.",
    reaches: [
      "apps/api/src/application-routes.ts",
      "apps/api/src/brief-extraction.ts",
      "apps/worker/src/brief-extraction-handler.ts",
    ],
  },
  {
    id: "profile-derivation",
    routes: [{ method: "POST", url: `${workspace}/profiles/:profileId/derivation` }],
    whilePaused: "refused",
    limit: "The plan's model calls per day (model-call-gate.ts).",
    costCap: `The day's call count times ${outputTokens}.`,
    killSwitch: "A plan override of modelCallsPerDay for one organisation.",
    reaches: ["apps/api/src/profile-routes.ts", "apps/worker/src/profile-derivation-handler.ts"],
  },
  {
    id: "career-interview",
    routes: [
      {
        method: "POST",
        url: `${workspace}/career-interview/sessions/:sessionId/actions`,
        counts: (body) => {
          const action = (body as { action?: unknown } | undefined)?.action;
          return action === "accept" || action === "answer" || action === "own_subject";
        },
      },
      { method: "GET", url: `${workspace}/career-interview/sessions/:sessionId/live` },
    ],
    whilePaused: "refused",
    limit:
      "The plan's model calls per day (model-call-gate.ts); live voice also has each member's daily minutes (live-voice-allowance.ts).",
    costCap: `The day's call count times ${outputTokens}; live voice ends at its session length or the member's daily minutes, DRAFT_LOOP_LIVE_MINUTES_PER_DAY.`,
    killSwitch: "DRAFT_LOOP_SCREENING without model (the interviewer), DRAFT_LOOP_LIVE_SPEECH off.",
    reaches: [
      "apps/api/src/career-interview-routes.ts",
      "apps/api/src/career-interview-walk.ts",
      "apps/api/src/live-speech-config.ts",
    ],
  },
  {
    id: "application-material",
    routes: [{ method: "POST", url: `${application}/material` }],
    whilePaused: "refused",
    limit:
      "The application's fair-use limit when its run kept a credit, else the plan's model calls per day (model-call-gate.ts).",
    costCap: `The fair-use or daily count times ${outputTokens}, including the critic's review.`,
    killSwitch: "A plan override of modelCallsPerDay for one organisation.",
    reaches: [
      "apps/api/src/application-material-routes.ts",
      "apps/api/src/application-material-walk.ts",
      "apps/worker/src/material-review-handler.ts",
    ],
  },
  {
    id: "interview-guide",
    routes: [{ method: "POST", url: `${application}/interview-guide` }],
    whilePaused: "refused",
    limit:
      "The application's fair-use limit when its run kept a credit, else the plan's model calls per day (model-call-gate.ts).",
    costCap: `The fair-use or daily count times ${outputTokens}.`,
    killSwitch: "A plan override of modelCallsPerDay for one organisation.",
    reaches: ["apps/api/src/interview-guide-routes.ts", "apps/worker/src/research-handler.ts"],
  },
  {
    id: "cover-letter-kit",
    routes: [{ method: "POST", url: `${application}/cover-letter-kit` }],
    whilePaused: "refused",
    limit:
      "The application's fair-use limit when its run kept a credit, else the plan's model calls per day (model-call-gate.ts).",
    costCap: `The fair-use or daily count times ${outputTokens}; each kit also stops at US$0.10.`,
    killSwitch: "A plan override of modelCallsPerDay for one organisation.",
    reaches: ["apps/api/src/cover-letter-kit-routes.ts"],
  },
  {
    id: "cover-letter-check",
    routes: [{ method: "POST", url: `${application}/cover-letter-check` }],
    // The wording and requirement checks need no model, so they still answer while paused.
    whilePaused: "skipped",
    limit: "The plan's model calls per day (model-call-gate.ts); a paused check is not counted.",
    costCap: `The daily count times ${outputTokens}; each check also stops at US$0.05.`,
    killSwitch: "A plan override of modelCallsPerDay for one organisation.",
    reaches: ["apps/api/src/cover-letter-check-routes.ts"],
  },
  {
    id: "research",
    routes: [{ method: "POST", url: `${application}/research` }],
    whilePaused: "refused",
    limit:
      "The application's fair-use limit when its run kept a credit, else the plan's model calls per day (model-call-gate.ts).",
    costCap: `The fair-use or daily count times ${outputTokens} and the search's own limit.`,
    killSwitch: "DRAFT_LOOP_RESEARCH_SEARCH=off.",
    reaches: [
      "apps/api/src/research-brief-routes.ts",
      "apps/worker/src/research-handler.ts",
      "apps/worker/src/research-search-wiring.ts",
    ],
  },
  {
    id: "support",
    routes: [
      { method: "POST", url: `${workspace}/support/conversations` },
      { method: "POST", url: `${workspace}/support/conversations/:conversationId/messages` },
    ],
    whilePaused: "refused",
    limit: "Questions per minute and per day for each member (support-limits.ts).",
    costCap: "The assistant's daily cost cap in US dollars (support-limits.ts).",
    killSwitch: '{"assistant":"off"} in the support limits secret: guide search only.',
    reaches: ["apps/api/src/support-routes.ts"],
  },
  {
    id: "content-screening",
    // Runs inside intake routes, on text the person adds; no route of its own.
    routes: [],
    whilePaused: "skipped",
    limit: "Once per piece of text added, which the routes that add it already limit.",
    costCap:
      "Per-call Claude Haiku pricing; the screening shadow has its own daily dollar cap (DRAFT_LOOP_SCREENING_SHADOW_MAX_DAILY_USD).",
    killSwitch: "DRAFT_LOOP_SCREENING=rules, DRAFT_LOOP_SCREENING_SHADOW=off.",
    reaches: [
      "apps/api/src/content-screening-service.ts",
      "apps/api/src/content-screening-config.ts",
      "apps/api/src/screening-shadow-config.ts",
    ],
  },
];

type RouteRequest = Pick<FastifyRequest, "method" | "routeOptions" | "body">;

/** The registered path a request starts, if it starts one that calls a model. */
export function modelCallPathOf(request: RouteRequest): ModelCallPath | undefined {
  return modelCallPaths.find((path) =>
    path.routes.some(
      (route) =>
        route.method === request.method &&
        route.url === request.routeOptions.url &&
        (route.counts?.(request.body) ?? true),
    ),
  );
}
