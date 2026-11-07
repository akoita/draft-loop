import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkJournalApiError, type WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's application tools (ADR 0011 D17, #2440): list and read the candidate's job
 * applications, add one from pasted job text, and follow a run. Each returns only what was asked:
 * names, status and run state, never the draft, the career evidence or the job text itself. The
 * agent token's scopes decide what reaches the API: `applications:read` and `jobs:write`.
 */

/** An application as an agent sees it: what it is called and where it stands. */
export interface AgentApplication {
  readonly application_id: string;
  readonly name: string;
  readonly status: string;
  readonly archived: boolean;
  readonly folder_id: string | null;
  readonly updated_at: string;
  readonly chosen_run_id: string | null;
  readonly latest_run: { readonly run_id: string; readonly state: string } | null;
  readonly run_count: number;
  readonly export_count: number;
}

export interface AgentRunStatus {
  readonly run_id: string;
  readonly state: string;
  readonly round: number;
  readonly current_step: string | null;
  readonly approval: string;
  readonly finding_count: number;
  readonly has_draft: boolean;
  readonly updated_at: string;
  readonly last_error: string | null;
  readonly next_step: string;
}

export interface ApplicationsApi {
  list(): Promise<readonly AgentApplication[]>;
  get(applicationId: string): Promise<AgentApplication>;
  addJob(input: AddJobInput): Promise<AgentApplication>;
  runStatus(runId: string): Promise<AgentRunStatus>;
}

export interface AddJobInput {
  readonly name: string;
  readonly job_text: string;
  readonly language?: string | undefined;
}

interface ApplicationBody {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly archivedAt: string | null;
  readonly folderId: string | null;
  readonly updatedAt: string;
  readonly chosenRunId: string | null;
  readonly runs: readonly {
    readonly id: string;
    readonly state: string;
    readonly updatedAt: string;
  }[];
  readonly exportCount: number;
}

interface RunBody {
  readonly runId: string;
  readonly state: string;
  readonly round: number;
  readonly currentStep: string | null;
  readonly approval: string;
  readonly findingCount: number;
  readonly hasDraft: boolean;
  readonly updatedAt: string;
  readonly lastError?: { readonly message?: string } | null;
}

function applicationOf(body: ApplicationBody): AgentApplication {
  const latest = [...body.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    application_id: body.id,
    name: body.name,
    status: body.status,
    archived: body.archivedAt !== null,
    folder_id: body.folderId,
    updated_at: body.updatedAt,
    chosen_run_id: body.chosenRunId,
    latest_run: latest === undefined ? null : { run_id: latest.id, state: latest.state },
    run_count: body.runs.length,
    export_count: body.exportCount,
  };
}

/** What the candidate does next in DraftLoop, from a run's state; the agent never decides it. */
export function runNextStep(run: Pick<RunBody, "state" | "approval" | "hasDraft">): string {
  if (run.state === "exported") return "The candidate approved and exported this draft.";
  if (run.approval === "approved" || run.state === "approved") {
    return "The candidate approved this draft; they can export it in DraftLoop.";
  }
  if (run.state === "stopped" || run.state === "budget-exhausted") {
    return run.hasDraft
      ? "This run ended; its last draft can still be reviewed in DraftLoop."
      : "This run ended without a draft; the candidate can start another in DraftLoop.";
  }
  if (run.state === "awaiting-approval") {
    return "A draft waits for the candidate's review in DraftLoop; approval and finding decisions are theirs.";
  }
  if (run.state === "paused")
    return "The candidate paused this run; they can resume it in DraftLoop.";
  return "The run is still working; check again in a minute.";
}

function runOf(body: RunBody): AgentRunStatus {
  return {
    run_id: body.runId,
    state: body.state,
    round: body.round,
    current_step: body.currentStep,
    approval: body.approval,
    finding_count: body.findingCount,
    has_draft: body.hasDraft,
    updated_at: body.updatedAt,
    last_error: body.lastError?.message ?? null,
    next_step: runNextStep(body),
  };
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

function pathId(id: string, what: string): string {
  if (!idPattern.test(id)) {
    throw new WorkJournalApiError("invalid_id", `That is not a DraftLoop ${what} id.`, [what]);
  }
  return encodeURIComponent(id);
}

export function createApplicationsApi(call: WorkspaceApiCall): ApplicationsApi {
  return {
    list: async () => {
      const body = (await call("/applications", { method: "GET" })) as {
        readonly applications?: readonly ApplicationBody[];
      };
      return (body.applications ?? []).map(applicationOf);
    },
    get: async (applicationId) =>
      applicationOf(
        (await call(`/applications/${pathId(applicationId, "application")}`, {
          method: "GET",
        })) as ApplicationBody,
      ),
    addJob: async (input) =>
      applicationOf(
        (await call("/applications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            jobText: input.job_text,
            ...(input.language === undefined ? {} : { language: input.language }),
          }),
        })) as ApplicationBody,
      ),
    runStatus: async (runId) =>
      runOf((await call(`/runs/${pathId(runId, "run")}`, { method: "GET" })) as RunBody),
  };
}

export const listApplicationsDescription =
  "List the candidate's job applications in DraftLoop: name, status, folder, whether it is archived, and its latest run's state. It never returns drafts, career evidence or job text. Needs an agent token with the applications:read scope.";

export const getApplicationDescription =
  "Read one job application by id: name, status, folder, chosen run and latest run. Needs the applications:read scope.";

export const addJobDescription = `Add a job application to DraftLoop from a job description the candidate gave you, pasted as text. DraftLoop keeps the text and screens it like an upload; the candidate then extracts the requirements, reviews them and starts the CV run in DraftLoop.
Pass the job text exactly as the candidate gave it; never invent or summarise requirements. A job page address is refused: fetching a page needs the candidate's approval in DraftLoop. Needs the jobs:write scope.`;

export const getRunStatusDescription =
  "Read where a CV run stands: state, round, current step, approval, finding count, whether a draft exists, and the candidate's next step. It never returns the draft. Needs the applications:read scope.";

const applicationSchema = z.object({
  application_id: z.string(),
  name: z.string(),
  status: z.string(),
  archived: z.boolean(),
  folder_id: z.string().nullable(),
  updated_at: z.string(),
  chosen_run_id: z.string().nullable(),
  latest_run: z.object({ run_id: z.string(), state: z.string() }).nullable(),
  run_count: z.number().int(),
  export_count: z.number().int(),
});

const runStatusSchema = z.object({
  run_id: z.string(),
  state: z.string(),
  round: z.number().int(),
  current_step: z.string().nullable(),
  approval: z.string(),
  finding_count: z.number().int(),
  has_draft: z.boolean(),
  updated_at: z.string(),
  last_error: z.string().nullable(),
  next_step: z.string(),
});

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

/** Registers the application tools on the server. */
export function registerApplicationTools(
  server: McpServer,
  api: ApplicationsApi,
  failure: Failure,
): void {
  server.registerTool(
    "list_applications",
    {
      title: "List job applications",
      description: listApplicationsDescription,
      inputSchema: z.object({
        include_archived: z
          .boolean()
          .optional()
          .describe("Also list archived applications; false by default."),
      }),
      outputSchema: z.object({ applications: z.array(applicationSchema) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_archived }) => {
      try {
        const applications = (await api.list()).filter(
          (application) => include_archived === true || !application.archived,
        );
        return answer({ applications });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_application",
    {
      title: "Read a job application",
      description: getApplicationDescription,
      inputSchema: z.object({ application_id: z.string().min(1).max(192) }),
      outputSchema: applicationSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ application_id }) => {
      try {
        return answer({ ...(await api.get(application_id)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "add_job",
    {
      title: "Add a job application",
      description: addJobDescription,
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe("A short name, such as the role and employer."),
        job_text: z
          .string()
          .min(1)
          .max(200_000)
          .describe("The job description exactly as the candidate gave it."),
        language: z
          .string()
          .min(2)
          .max(16)
          .optional()
          .describe("The documents' language, such as en or fr; absent uses the workspace's."),
      }),
      outputSchema: applicationSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return answer({ ...(await api.addJob(input)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_run_status",
    {
      title: "Follow a CV run",
      description: getRunStatusDescription,
      inputSchema: z.object({ run_id: z.string().min(1).max(192) }),
      outputSchema: runStatusSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id }) => {
      try {
        return answer({ ...(await api.runStatus(run_id)) });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
