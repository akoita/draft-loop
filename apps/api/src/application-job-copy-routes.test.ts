import type { ApplicationService, ApplicationView } from "@draft-loop/application";
import type { ApplicationJobPage, ApplicationJobSource } from "@draft-loop/schemas/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-25T00:00:00.000Z";
const url = "https://jobs.example.test/platform-engineer";
const copyUrl = "/v1/workspaces/workspace-1/applications/app-page/job/copy";
const jobText =
  "Platform Engineer at Example Ledger. Example Ledger is a fictional company that keeps accounts for small cooperatives. You will build and run the ledger's TypeScript services on Kubernetes, own the deployment pipeline and its observability, and review designs with the product team. You bring five years of backend engineering with Node.js and PostgreSQL.";

function view(jobSource: ApplicationJobSource): ApplicationView {
  return {
    schemaVersion: 1,
    id: "app-page",
    name: "Example Ledger platform engineer",
    jobSource,
    createdAt: at,
    updatedAt: at,
    status: "drafting",
    isDefault: false,
    briefs: [],
    runs: [],
    exports: [],
    archivedAt: null,
    nameChosen: true,
    suggestedName: null,
    modelProfiles: null,
    chosenRun: null,
  } as unknown as ApplicationView;
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

/** An application whose job is an approved page, keeping each copy recorded for it. */
async function build(options: {
  readonly jobSource?: ApplicationJobSource;
  readonly jobPageFetcher?: (input: string | URL | Request) => Promise<Response>;
}) {
  let source: ApplicationJobSource = options.jobSource ?? {
    kind: "approved-url",
    url,
    approved: true,
  };
  const recordApplicationJobPage = vi.fn(
    async ({ page }: { readonly page: ApplicationJobPage }) => {
      if (source.kind === "approved-url") source = { ...source, page };
    },
  );
  const service = {
    getApplication: async () => view(source),
    recordApplicationJobPage,
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      ...(options.jobPageFetcher === undefined
        ? {}
        : { jobPageFetcher: options.jobPageFetcher as never }),
    },
  });
  return { recordApplicationJobPage };
}

describe("saving a copy of a job page (#2593)", () => {
  it("keeps the description the person pasted, marked as pasted", async () => {
    const { recordApplicationJobPage } = await build({});

    const response = await app.inject({
      method: "POST",
      url: copyUrl,
      headers: { authorization },
      payload: { text: "  Platform Engineer, pasted  " },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(recordApplicationJobPage).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      applicationId: "app-page",
      page: expect.objectContaining({
        text: "Platform Engineer, pasted",
        finalUrl: url,
        pasted: true,
      }),
    });
    expect(response.json()).toMatchObject({
      origin: "url",
      text: "Platform Engineer, pasted",
      url,
      copySource: "pasted",
      earlier: null,
    });
  });

  it("reads the approved page once through the page fetcher and keeps its text", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(jobText, { headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
    const { recordApplicationJobPage } = await build({ jobPageFetcher: fetcher });

    const response = await app.inject({
      method: "POST",
      url: copyUrl,
      headers: { authorization },
      payload: {},
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[] | undefined)?.[0])).toBe(url);
    expect(recordApplicationJobPage).toHaveBeenCalledTimes(1);
    expect(response.json()).toMatchObject({ origin: "url", copySource: "page", url });
    expect(response.json().text).toContain("Platform Engineer at Example Ledger");
  });

  it("refuses with the fetcher's reason and keeps nothing when the page is gone", async () => {
    const { recordApplicationJobPage } = await build({
      jobPageFetcher: async () => new Response("", { status: 404 }),
    });

    const response = await app.inject({
      method: "POST",
      url: copyUrl,
      headers: { authorization },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toMatch(/paste the job text instead/iu);
    expect(recordApplicationJobPage).not.toHaveBeenCalled();
  });

  it("refuses an application whose job is not a page, and an empty paste", async () => {
    await build({ jobSource: { kind: "stored-text", text: "Platform Engineer" } });

    const notPage = await app.inject({
      method: "POST",
      url: copyUrl,
      headers: { authorization },
      payload: { text: "Platform Engineer" },
    });
    expect(notPage.statusCode).toBe(422);

    const empty = await app.inject({
      method: "POST",
      url: copyUrl,
      headers: { authorization },
      payload: { text: "   " },
    });
    expect(empty.statusCode).toBe(400);
  });
});
