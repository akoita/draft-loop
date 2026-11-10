import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkJournalApiError, type WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's read tools for what the candidate already approved (#2569): the CV they
 * exported as Markdown, and the cover letters and interview question sets they saved. They need
 * the `drafts:read` scope, which no token gets unless the candidate ticks it. A run's open draft,
 * its findings and the career evidence a draft cites never reach the agent through them.
 */

export interface AgentCv {
  readonly application_id: string;
  readonly run_id: string;
  readonly export_id: string;
  readonly exported_at: string;
  readonly markdown: string;
}

export interface AgentMaterialSummary {
  readonly material_id: string;
  readonly kind: string;
  readonly created_at: string | null;
  readonly edited: boolean;
  readonly based_on: string | null;
  readonly item_count: number;
}

export interface AgentMaterial extends AgentMaterialSummary {
  readonly items: readonly { readonly question: string; readonly text: string }[];
}

export interface DraftsApi {
  cv(applicationId: string): Promise<AgentCv>;
  materials(applicationId: string, kind?: string): Promise<readonly AgentMaterial[]>;
}

interface ApplicationBody {
  readonly chosenRunId: string | null;
  readonly runs: readonly { readonly id: string; readonly updatedAt: string }[];
}

interface ExportBody {
  readonly id: string;
  readonly format: string;
  readonly createdAt: string;
}

interface MaterialBody {
  readonly id?: string;
  readonly kind: string;
  readonly created_at?: string;
  readonly based_on?: string;
  readonly items: readonly {
    readonly question: string;
    readonly text: string;
    readonly edited?: boolean;
  }[];
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

function pathId(id: string, what: string): string {
  if (!idPattern.test(id)) {
    throw new WorkJournalApiError("invalid_id", `That is not a DraftLoop ${what} id.`, [what]);
  }
  return encodeURIComponent(id);
}

/** The run whose CV the application uses: the one the candidate chose, else the latest. */
function cvRunOf(application: ApplicationBody): string | undefined {
  if (application.chosenRunId !== null) return application.chosenRunId;
  return [...application.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id;
}

function materialOf(body: MaterialBody): AgentMaterial {
  return {
    material_id: body.id ?? "",
    kind: body.kind,
    created_at: body.created_at ?? null,
    edited: body.items.some((item) => item.edited === true),
    based_on: body.based_on ?? null,
    item_count: body.items.length,
    // Citations stay out: they are the career facts the draft relies on, not the draft.
    items: body.items.map((item) => ({ question: item.question, text: item.text })),
  };
}

export function createDraftsApi(call: WorkspaceApiCall): DraftsApi {
  return {
    cv: async (applicationId) => {
      const application = (await call(`/applications/${pathId(applicationId, "application")}`, {
        method: "GET",
      })) as ApplicationBody;
      const runId = cvRunOf(application);
      if (runId === undefined) {
        throw new WorkJournalApiError(
          "no_cv",
          "This application has no CV run yet; the candidate starts one in DraftLoop.",
        );
      }
      const { exports } = (await call(`/runs/${pathId(runId, "run")}/exports`, {
        method: "GET",
      })) as { readonly exports: readonly ExportBody[] };
      const markdown = exports
        .filter((entry) => entry.format === "markdown")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (markdown === undefined) {
        throw new WorkJournalApiError(
          "no_markdown_export",
          "This CV has no Markdown export; the candidate approves the draft and exports it as Markdown in DraftLoop.",
        );
      }
      const text = (await call(
        `/runs/${pathId(runId, "run")}/exports/${pathId(markdown.id, "export")}/content`,
        { method: "GET" },
        "text",
      )) as string;
      return {
        application_id: applicationId,
        run_id: runId,
        export_id: markdown.id,
        exported_at: markdown.createdAt,
        markdown: text,
      };
    },
    materials: async (applicationId, kind) => {
      const query = kind === undefined ? "" : `?kind=${encodeURIComponent(kind)}`;
      const { drafts } = (await call(
        `/applications/${pathId(applicationId, "application")}/material${query}`,
        { method: "GET" },
      )) as { readonly drafts: readonly MaterialBody[] };
      return drafts.map(materialOf);
    },
  };
}

export const getCvDescription =
  "Read the CV the candidate approved and exported as Markdown for one job application: the newest Markdown export of the run the application uses. Without one, the candidate exports it in DraftLoop; never write or change a CV here. Needs the drafts:read scope.";

export const listMaterialsDescription =
  "List the cover letters and interview question sets the candidate saved for one job application, newest first: id, kind, date and whether they edited it. It returns no text; call get_material for one. Needs the drafts:read scope.";

export const getMaterialDescription =
  "Read one saved cover letter or interview question set: its paragraphs, or each question with its talking point. Quote it as the candidate saved it. Needs the drafts:read scope.";

const kinds = ["cover-letter", "interview-questions"] as const;

const summarySchema = z.object({
  material_id: z.string(),
  kind: z.string(),
  created_at: z.string().nullable(),
  edited: z.boolean(),
  based_on: z.string().nullable(),
  item_count: z.number().int(),
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

const applicationId = z.string().min(1).max(192);

/** Registers the drafts read tools on the server. */
export function registerDraftTools(server: McpServer, api: DraftsApi, failure: Failure): void {
  server.registerTool(
    "get_cv",
    {
      title: "Read an exported CV",
      description: getCvDescription,
      inputSchema: z.object({ application_id: applicationId }),
      outputSchema: z.object({
        application_id: z.string(),
        run_id: z.string(),
        export_id: z.string(),
        exported_at: z.string(),
        markdown: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ application_id }) => {
      try {
        return answer({ ...(await api.cv(application_id)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_materials",
    {
      title: "List saved cover letters and interview questions",
      description: listMaterialsDescription,
      inputSchema: z.object({
        application_id: applicationId,
        kind: z.enum(kinds).optional().describe("Keep one kind; both by default."),
      }),
      outputSchema: z.object({ materials: z.array(summarySchema) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ application_id, kind }) => {
      try {
        const materials = (await api.materials(application_id, kind)).map(
          ({ items: _items, ...summary }) => summary,
        );
        return answer({ materials });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_material",
    {
      title: "Read a saved cover letter or interview questions",
      description: getMaterialDescription,
      inputSchema: z.object({ application_id: applicationId, material_id: applicationId }),
      outputSchema: summarySchema.extend({
        items: z.array(z.object({ question: z.string(), text: z.string() })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ application_id, material_id }) => {
      try {
        const found = (await api.materials(application_id)).find(
          (material) => material.material_id === material_id,
        );
        if (found === undefined) {
          throw new WorkJournalApiError(
            "not_found",
            "This application has no saved draft with that id; call list_materials.",
          );
        }
        return answer({ ...found, items: [...found.items] });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
