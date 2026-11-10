import type { AgentTokenScope } from "@draft-loop/storage/agent-tokens";
import type { FastifyRequest } from "fastify";

/**
 * Which routes an agent token reaches, and with which scope (ADR 0011 D17, #2438). A route an
 * agent may use is in `agentRoutes`; every other route is in `humanOnlyRoutes`. A route in
 * neither is refused to agents, and the API's tests fail until someone classifies it.
 */
export interface AgentRouteRule {
  readonly scope: AgentTokenScope;
  /** A further check on the request, such as refusing a field only the person may set. */
  readonly allows?: (request: FastifyRequest) => boolean;
  /** Why `allows` refused, for the agent to read. */
  readonly refusal?: string;
  /** What a start reserves against the token's monthly spend cap (`agent-spend-gate.ts`). */
  readonly charge?: "run" | "draft";
}

const workspace = "/v1/workspaces/:workspaceId";

/** Each scope as the token form in Workspace settings > Agents names it, for a refusal (#2534). */
const agentScopeNames: Readonly<Record<AgentTokenScope, string>> = {
  journal: "Work journal",
  "applications:read": "Read applications",
  "jobs:write": "Add jobs",
  "drafts:read": "Read CVs and drafts",
  "runs:start": "Start runs and drafts",
};

/** Keys are `METHOD /route/:param`, as Fastify names a route. */
export const agentRoutes: Readonly<Record<string, AgentRouteRule>> = {
  [`POST ${workspace}/work-journal/notes`]: { scope: "journal" },
  // Whole notes stay with the candidate's review; an agent lists titles only.
  [`GET ${workspace}/work-journal/notes`]: {
    scope: "journal",
    allows: (request) => {
      const fields = (request.query as { readonly fields?: unknown } | undefined)?.fields;
      return fields === undefined || fields === "titles";
    },
    refusal: "An agent token lists work journal notes by title only.",
  },
  [`GET ${workspace}/applications`]: { scope: "applications:read" },
  [`GET ${workspace}/applications/:applicationId`]: { scope: "applications:read" },
  [`GET ${workspace}/applications/:applicationId/job`]: { scope: "applications:read" },
  [`GET ${workspace}/runs/:runId`]: { scope: "applications:read" },
  // What the candidate already exported or saved, never a run's open draft or findings (#2569).
  [`GET ${workspace}/runs/:runId/exports`]: { scope: "drafts:read" },
  [`GET ${workspace}/runs/:runId/exports/:exportId/content`]: { scope: "drafts:read" },
  [`GET ${workspace}/applications/:applicationId/material`]: { scope: "drafts:read" },
  // Runs within the token's monthly spend cap (#2599), on a brief the person reviewed; the
  // models, the career profile and every decision on the draft stay with the person.
  [`GET ${workspace}/runs/estimate`]: { scope: "runs:start" },
  [`POST ${workspace}/runs`]: {
    scope: "runs:start",
    charge: "run",
    allows: (request) => {
      const body = request.body as Record<string, unknown> | undefined;
      return (
        body !== undefined &&
        typeof body.applicationId === "string" &&
        body.opportunityBrief !== undefined &&
        body.modelProfiles === undefined &&
        body.candidateProfile === undefined
      );
    },
    refusal:
      "An agent token starts a run on an application's reviewed brief only (applicationId and opportunityBrief); the models and the career profile are the person's choice in DraftLoop.",
  },
  // A cover letter or interview questions within the same cap (#2601), on the default model.
  [`POST ${workspace}/applications/:applicationId/material`]: {
    scope: "runs:start",
    charge: "draft",
    allows: (request) => (request.body as Record<string, unknown> | undefined)?.model === undefined,
    refusal:
      "An agent token drafts with the default model only; choosing another model is the person's choice in DraftLoop.",
  },
  // Pasted job text only: approving a job page fetch stays with the person (D17).
  [`POST ${workspace}/applications`]: {
    scope: "jobs:write",
    allows: (request) => {
      const body = request.body as Record<string, unknown> | undefined;
      return (
        body !== undefined &&
        typeof body.jobText === "string" &&
        body.jobUrl === undefined &&
        body.jobUrlApproved === undefined
      );
    },
    refusal:
      "An agent token adds a job from pasted job text only; a job page address needs the person's approval in DraftLoop.",
  },
};

/** Routes only the person reaches: decisions, consent, settings, records and tokens (D17). */
export const humanOnlyRoutes: readonly string[] = [
  "DELETE /v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules/:ruleId",
  "DELETE /v1/operator/organisations/:organisationId",
  "DELETE /v1/organisation",
  "DELETE /v1/organisation/members/:memberId",
  "DELETE /v1/workspaces/:workspaceId",
  "DELETE /v1/workspaces/:workspaceId/agent-tokens/:tokenId",
  "DELETE /v1/workspaces/:workspaceId/application-folders/:folderId",
  "DELETE /v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId",
  "DELETE /v1/workspaces/:workspaceId/applications/:applicationId/research-briefs/:briefId",
  "DELETE /v1/workspaces/:workspaceId/members/:memberId",
  "DELETE /v1/workspaces/:workspaceId/profiles/:profileId/derivation",
  "GET /speech-models/manifest.json",
  "GET /v1/application-material/models",
  "GET /v1/auth/config",
  "GET /v1/health",
  "GET /v1/knowledge-bases",
  "GET /v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules",
  "GET /v1/knowledge-bases/:knowledgeBaseId/sources",
  "GET /v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId/file",
  "GET /v1/me",
  "GET /v1/me/screen-language",
  "GET /v1/model-catalog",
  "GET /v1/operator/organisations/:organisationId/credits",
  "GET /v1/organisation/credits",
  "GET /v1/organisation/members",
  "GET /v1/usage",
  "GET /v1/workspaces",
  "GET /v1/workspaces/:workspaceId",
  "GET /v1/workspaces/:workspaceId/agent-tokens",
  "GET /v1/workspaces/:workspaceId/application-folders",
  "GET /v1/workspaces/:workspaceId/archive",
  "GET /v1/workspaces/:workspaceId/career-interview/sessions/:sessionId",
  "GET /v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/conflicts",
  "GET /v1/workspaces/:workspaceId/consents",
  "GET /v1/workspaces/:workspaceId/fact-usage",
  "GET /v1/workspaces/:workspaceId/writing-samples",
  "GET /v1/workspaces/:workspaceId/members",
  "GET /v1/workspaces/:workspaceId/opportunities/:briefId",
  "GET /v1/workspaces/:workspaceId/opportunities/:briefId/versions",
  "GET /v1/workspaces/:workspaceId/preference-suggestions",
  "GET /v1/workspaces/:workspaceId/profiles",
  "GET /v1/workspaces/:workspaceId/profiles/:profileId",
  "GET /v1/workspaces/:workspaceId/profiles/:profileId/derivation",
  "GET /v1/workspaces/:workspaceId/profiles/:profileId/freshness",
  "GET /v1/workspaces/:workspaceId/profiles/:profileId/versions",
  "GET /v1/workspaces/:workspaceId/review-state",
  "GET /v1/workspaces/:workspaceId/runs/:runId/review",
  "GET /v1/workspaces/:workspaceId/runs/:runId/usage",
  "GET /v1/workspaces/:workspaceId/screening",
  "GET /v1/workspaces/:workspaceId/work-journal/intake",
  "GET /v1/workspaces/:workspaceId/work-journal/notes/:noteId",
  "GET /v1/workspaces/:workspaceId/writing-policy",
  "GET /v1/workspaces/:workspaceId/writing-policy/versions",
  "GET /v1/workspaces/:workspaceId/writing-policy/versions/:checksum",
  "GET /v1/writing-policy-template",
  "PATCH /v1/organisation/members/:memberId",
  "PATCH /v1/workspaces/:workspaceId/application-folders/:folderId",
  "PATCH /v1/workspaces/:workspaceId/applications/:applicationId",
  "PATCH /v1/workspaces/:workspaceId/models",
  "PATCH /v1/workspaces/:workspaceId/opportunities/:briefId",
  "PATCH /v1/workspaces/:workspaceId/profiles/:profileId",
  "POST /v1/auth/proof",
  "POST /v1/client-errors",
  "POST /v1/knowledge-bases",
  "POST /v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules",
  "POST /v1/knowledge-bases/:knowledgeBaseId/sources",
  "POST /v1/operator/organisations",
  "POST /v1/operator/organisations/:organisationId/credit-grants",
  "POST /v1/organisation/members",
  "POST /v1/workspaces/:workspaceId/agent-tokens",
  "POST /v1/workspaces/:workspaceId/application-folders",
  "POST /v1/workspaces/:workspaceId/application-imports",
  "GET /v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/document",
  // Research briefs reach agents only with the drafts' read tool, if ever.
  "GET /v1/workspaces/:workspaceId/applications/:applicationId/research-briefs",
  "GET /v1/workspaces/:workspaceId/applications/:applicationId/research-briefs/:briefId",
  // A research run searches the web, so only the person approves it (#2560).
  "GET /v1/workspaces/:workspaceId/applications/:applicationId/research",
  "POST /v1/workspaces/:workspaceId/applications/:applicationId/research",
  "POST /v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/versions",
  "POST /v1/workspaces/:workspaceId/applications/from-file",
  "POST /v1/workspaces/:workspaceId/career-interview/sessions",
  "POST /v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/actions",
  "POST /v1/workspaces/:workspaceId/consents",
  "POST /v1/workspaces/:workspaceId/opportunities",
  "POST /v1/workspaces/:workspaceId/opportunities/:briefId/review",
  "POST /v1/workspaces/:workspaceId/preference-suggestions/:suggestionId/accept",
  "POST /v1/workspaces/:workspaceId/preference-suggestions/:suggestionId/dismiss",
  "POST /v1/workspaces/:workspaceId/profiles/:profileId/derivation",
  "POST /v1/workspaces/:workspaceId/profiles/:profileId/review",
  "POST /v1/workspaces/:workspaceId/runs/:runId/approve",
  "POST /v1/workspaces/:workspaceId/runs/:runId/export-preview",
  "POST /v1/workspaces/:workspaceId/runs/:runId/exports",
  "POST /v1/workspaces/:workspaceId/runs/:runId/pause",
  "POST /v1/workspaces/:workspaceId/runs/:runId/resume",
  "POST /v1/workspaces/:workspaceId/runs/:runId/revision",
  "POST /v1/workspaces/:workspaceId/runs/:runId/stop",
  "POST /v1/workspaces/:workspaceId/screening/:resultId/release",
  "POST /v1/workspaces/:workspaceId/work-journal/notes/:noteId/review",
  "PUT /v1/me/screen-language",
  "PUT /v1/operator/organisations/:organisationId/plan",
  "PUT /v1/workspaces/:workspaceId",
  "PUT /v1/workspaces/:workspaceId/applications/:applicationId/chosen-run",
  "PUT /v1/workspaces/:workspaceId/applications/:applicationId/language",
  "PUT /v1/workspaces/:workspaceId/applications/:applicationId/models",
  "PUT /v1/workspaces/:workspaceId/autopilot",
  "PUT /v1/workspaces/:workspaceId/budget",
  "PUT /v1/workspaces/:workspaceId/fact-usage",
  "PUT /v1/workspaces/:workspaceId/writing-samples",
  "PUT /v1/workspaces/:workspaceId/knowledge-selection",
  "PUT /v1/workspaces/:workspaceId/members/:memberId",
  "PUT /v1/workspaces/:workspaceId/runs/:runId/edits/:blockId",
  "PUT /v1/workspaces/:workspaceId/runs/:runId/findings/:findingId/decision",
  "PUT /v1/workspaces/:workspaceId/work-journal/intake",
  "PUT /v1/workspaces/:workspaceId/writing-policy",
];

export function agentRouteKey(method: string, routeUrl: string | undefined): string {
  return `${method.toUpperCase()} ${routeUrl ?? ""}`;
}

export type AgentAdmission =
  | { readonly outcome: "allowed"; readonly scope: AgentTokenScope }
  | { readonly outcome: "refused"; readonly message: string };

/**
 * Whether an agent token with these scopes may make this request in its own workspace. The
 * body check runs in a later hook, once Fastify has parsed it, through `admitAgentBody`.
 */
export function admitAgentRoute(
  request: FastifyRequest,
  token: { readonly workspaceId: string; readonly scopes: readonly AgentTokenScope[] },
): AgentAdmission {
  const rule = agentRoutes[agentRouteKey(request.method, request.routeOptions.url)];
  if (rule === undefined) {
    return { outcome: "refused", message: "An agent token cannot reach this route." };
  }
  const params = request.params as { readonly workspaceId?: unknown } | undefined;
  if (params?.workspaceId !== token.workspaceId) {
    return { outcome: "refused", message: "An agent token reaches only its own workspace." };
  }
  if (!token.scopes.includes(rule.scope)) {
    return {
      outcome: "refused",
      message: `This agent token lacks the "${rule.scope}" scope (${agentScopeNames[rule.scope]} on the token form); create a token with it in Workspace settings > Agents.`,
    };
  }
  if (request.method === "GET" && rule.allows !== undefined && !rule.allows(request)) {
    return {
      outcome: "refused",
      message: rule.refusal ?? "An agent token cannot make this request.",
    };
  }
  return { outcome: "allowed", scope: rule.scope };
}

/** The body check of a route admitted above; true when the route has none or it passes. */
export function admitAgentBody(request: FastifyRequest): AgentAdmission | undefined {
  const rule = agentRoutes[agentRouteKey(request.method, request.routeOptions.url)];
  if (rule?.allows === undefined || request.method === "GET") return undefined;
  return rule.allows(request)
    ? { outcome: "allowed", scope: rule.scope }
    : { outcome: "refused", message: rule.refusal ?? "An agent token cannot make this request." };
}
