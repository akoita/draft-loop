/**
 * The agent scope each tool needs (#3222), so the remote server can ask for a missing one before
 * the call runs. The MCP authorization spec's scope challenge answers `403` with
 * `error="insufficient_scope"` and the scopes to ask for; an assistant acting for a person then
 * asks them to grant it and retries. The API still decides every call; this table only lets the
 * server ask early. `null` marks a tool no agent scope opens: the operator's own tools, and the
 * service notice, which needs no sign-in.
 */
export const toolScopes: Readonly<Record<string, string | null>> = {
  record_work: "journal",
  list_work: "journal",
  send_feedback: "journal",
  search_help: "journal",
  list_applications: "applications:read",
  get_application: "applications:read",
  get_job_text: "applications:read",
  get_run_status: "applications:read",
  add_job: "jobs:write",
  get_cv: "drafts:read",
  list_materials: "drafts:read",
  get_material: "drafts:read",
  get_requirement_evidence: "drafts:read",
  estimate_run: "runs:start",
  start_cv_run: "runs:start",
  draft_cover_letter: "runs:start",
  draft_interview_prep: "runs:start",
  get_cover_letter_kit: "runs:start",
  check_cover_letter: "runs:start",
  add_project: "evidence:write",
  get_profile: "profile:suggest",
  suggest_profile_update: "profile:suggest",
  list_profile_suggestions: "profile:suggest",
  service_notice: null,
  list_feedback: null,
  triage_feedback: null,
};

/** How a scope is spelled in a sign-in token and a challenge. */
const tokenScope = (scope: string) => `draftloop:${scope}`;

function calledTools(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    const { method, params } = (message ?? {}) as { method?: unknown; params?: { name?: unknown } };
    return method === "tools/call" && typeof params?.name === "string" ? [params.name] : [];
  });
}

/**
 * The first scope, as a token spells it, that a tool called in this request needs and the
 * connection was not granted; none when every call is covered or no scope could cover it.
 */
export function missingToolScope(body: unknown, granted: readonly string[]): string | undefined {
  for (const tool of calledTools(body)) {
    const scope = toolScopes[tool];
    if (typeof scope === "string" && !granted.includes(tokenScope(scope))) return tokenScope(scope);
  }
  return undefined;
}
