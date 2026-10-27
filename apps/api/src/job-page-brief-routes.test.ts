import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import {
  type ApplicationService,
  type ApplicationView,
  createOpportunityDraft,
  type OpportunitySourceInput,
  type RecordApplicationJobPageCommand,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import {
  createPinnedUrlFetcher,
  type PinnedUrlFetcherOptions,
  type UrlFetcher,
} from "@draft-loop/ingestion";
import type { ApplicationJobSource } from "@draft-loop/schemas/application";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import type {
  ContentScreeningStore,
  StoredContentScreeningResult,
} from "@draft-loop/storage/content-screening";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { BriefExtractions } from "./brief-extraction.js";
import type { HostedContentScreening } from "./content-screening-service.js";
import { hostedJobPageFetcher } from "./page-fetcher-client.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-26T10:00:00.000Z";
const pageUrl = "https://jobs.example.test/platform-engineer";
const publicAddress = "93.184.215.14";

/** The fixture job page, fictional, as the test serves it. */
const fixturePage = `<!doctype html><html><head><title>Platform Engineer</title></head><body>
<h1>Platform Engineer at Example Ledger</h1>
<p>Example Ledger is a fictional company that keeps accounts for small cooperatives.</p>
<h2>What you will do</h2>
<ul><li>Build and run the ledger's TypeScript services on Kubernetes.</li>
<li>Own the deployment pipeline and its observability.</li>
<li>Review designs with the product team and write clear runbooks.</li></ul>
<h2>What you bring</h2>
<ul><li>Five years of backend engineering with Node.js and PostgreSQL.</li>
<li>Experience operating services on a managed Kubernetes platform.</li></ul>
</body></html>`;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Serves the fixture page for the job page's address, as `https.request` would. */
function fixtureServer(body = fixturePage) {
  const requests: URL[] = [];
  const request: NonNullable<PinnedUrlFetcherOptions["request"]> = (url, _options, onResponse) => {
    requests.push(url);
    const outgoing = new EventEmitter() as EventEmitter & { end(): void };
    outgoing.end = () => {
      const message = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
      message.statusCode = url.href === pageUrl ? 200 : 404;
      message.headers = { "content-type": "text/html; charset=utf-8" };
      onResponse(message);
    };
    return outgoing;
  };
  return { request, requests };
}

function scriptedScreening(): HostedContentScreening {
  return {
    mode: "rules",
    store: {} as ContentScreeningStore,
    screen: async (input): Promise<StoredContentScreeningResult> => ({
      id: "screening-1",
      subject: input.subject,
      result: {
        verdict: input.text?.includes("Example Ledger") === true ? "clear" : "flagged",
        signals: [],
        screeners: [{ id: "rules", version: "test" }],
        screenedAt: at,
      },
      recordedAt: at,
    }),
  };
}

async function api(
  options: { readonly addresses?: readonly string[]; readonly jobPageFetcher?: UrlFetcher } = {},
) {
  let jobSource: ApplicationJobSource = { kind: "approved-url", url: pageUrl, approved: true };
  const briefs = new Map<string, OpportunityBriefVersionRecord>();
  const order: string[] = [];
  const recordApplicationJobPage = vi.fn(async (command: RecordApplicationJobPageCommand) => {
    order.push("record");
    jobSource = { kind: "approved-url", url: pageUrl, approved: true, page: command.page };
  });
  const createApplication = vi.fn(async (command: { jobSource: ApplicationJobSource }) => {
    jobSource = command.jobSource;
    return application();
  });
  const application = () =>
    ({
      schemaVersion: 1,
      id: "app-1",
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
    }) as unknown as ApplicationView;
  const service = {
    readWorkspace: async () => ({ id: "history-1", fixtureMode: false }) as WorkspaceDescriptor,
    createApplication,
    getApplication: async (command: { applicationId: string }) =>
      command.applicationId === "app-1" ? application() : undefined,
    createOpportunity: async (command: {
      sources: readonly OpportunitySourceInput[];
      ingestUrl?: Parameters<typeof createOpportunityDraft>[1] extends infer Options
        ? Options extends { dependencies?: { ingestUrl?: infer Ingest } }
          ? Ingest
          : never
        : never;
    }) => {
      const brief = await createOpportunityDraft(
        { id: `brief-${briefs.size + 1}`, createdAt: at, sources: command.sources },
        {
          now: () => at,
          ...(command.ingestUrl === undefined
            ? {}
            : { dependencies: { ingestUrl: command.ingestUrl } }),
        },
      );
      const record = { workspaceId: "history-1", checksum: "a".repeat(64), brief };
      briefs.set(brief.id, record);
      return record;
    },
    recordApplicationJobPage,
  } as unknown as ApplicationService;
  const extractions = {
    queue: vi.fn<BriefExtractions["queue"]>(async () => {
      order.push("queue");
      return true;
    }),
    state: vi.fn<BriefExtractions["state"]>(async () => "pending"),
  };
  const server = fixtureServer();
  const resolveHostname = vi.fn(async () => options.addresses ?? [publicAddress]);
  app = await buildApi({
    ownerToken,
    application: {
      service,
      workspaceRoot: (workspaceId) => workspaceId,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      contentScreening: scriptedScreening(),
      briefExtractions: extractions,
      jobPageFetcher:
        options.jobPageFetcher ??
        createPinnedUrlFetcher({ resolveHostname, request: server.request }),
    },
  });
  const inject = app.inject.bind(app);
  const extract = async (url = pageUrl, applicationId = "app-1") => {
    const response = await inject({
      method: "POST",
      url: "/v1/workspaces/r1/opportunities",
      headers: { authorization },
      payload: {
        sources: [
          {
            id: "posting",
            kind: "approved-url",
            classification: "job-posting",
            url,
            approved: true,
          },
        ],
        applicationId,
      },
    });
    return { status: response.statusCode, body: response.json() };
  };
  return {
    inject,
    extract,
    createApplication,
    recordApplicationJobPage,
    extractions,
    requests: server.requests,
    order,
  };
}

describe("an application from an approved job page", () => {
  it("is created with the address and approval only when the person approved, fetching nothing", async () => {
    const { inject, createApplication, requests } = await api();
    const create = (payload: object) =>
      inject({
        method: "POST",
        url: "/v1/workspaces/r1/applications",
        headers: { authorization },
        payload: { name: "Example Ledger platform engineer", ...payload },
      });

    for (const payload of [
      { jobUrl: pageUrl },
      { jobUrl: pageUrl, jobUrlApproved: false },
      { jobUrl: "http://jobs.example.test/role", jobUrlApproved: true },
      { jobUrl: pageUrl, jobUrlApproved: true, jobText: "Role" },
      { jobText: "Role", jobUrlApproved: true },
    ]) {
      expect((await create(payload)).statusCode).toBe(400);
    }
    expect(createApplication).not.toHaveBeenCalled();

    const created = await create({ jobUrl: pageUrl, jobUrlApproved: true });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ jobSourceKind: "approved-url" });
    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        jobSource: { kind: "approved-url", url: pageUrl, approved: true },
      }),
    );
    expect(requests).toEqual([]);
  });

  it("fetches the page once at extraction, records where and when, keeps its text and screens it", async () => {
    const { extract, recordApplicationJobPage, extractions, requests, order } = await api();

    const created = await extract();

    expect(created.status).toBe(201);
    expect(requests.map((url) => url.href)).toEqual([pageUrl]);
    const [source] = created.body.brief.sources;
    expect(source).toMatchObject({
      id: "posting",
      classification: "job-posting",
      status: "available",
      provenance: { kind: "approved-url", originalUrl: pageUrl, capturedAt: expect.any(String) },
    });
    expect(recordApplicationJobPage).toHaveBeenCalledWith({
      root: "r1",
      applicationId: "app-1",
      page: {
        text: expect.stringContaining("Platform Engineer at Example Ledger"),
        finalUrl: pageUrl,
        fetchedAt: source.provenance.capturedAt,
      },
    });
    expect(created.body.screening).toMatchObject({
      verdict: "clear",
      sources: [{ sourceId: "posting", verdict: "clear" }],
    });
    expect(created.body.extraction).toBe("pending");
    expect(extractions.queue).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["record", "queue"]);
  });

  it("refuses a page the application was not created with, before any fetch", async () => {
    const { extract, requests, recordApplicationJobPage } = await api();

    expect((await extract("https://jobs.example.test/other")).status).toBe(422);
    expect((await extract(pageUrl, "app-missing")).status).toBe(422);
    expect(requests).toEqual([]);
    expect(recordApplicationJobPage).not.toHaveBeenCalled();
  });

  it("refuses a page whose host resolves to a private or metadata address, connecting nowhere", async () => {
    for (const address of ["10.0.0.7", "169.254.169.254"]) {
      const { extract, requests, recordApplicationJobPage, extractions } = await api({
        addresses: [address],
      });

      const refused = await extract();

      expect(refused.status).toBe(422);
      expect(requests).toEqual([]);
      expect(recordApplicationJobPage).not.toHaveBeenCalled();
      expect(extractions.queue).not.toHaveBeenCalled();
      await app?.close();
      app = undefined;
    }
  });

  it("fetches through the separate page fetcher with an identity token for its address", async () => {
    const calls: { url: string; authorization: string | null; body?: string }[] = [];
    const fetcherEndpoint = "https://page-fetcher.example.test";
    const stub: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.startsWith("http://metadata.google.internal/")) {
        expect(headers.get("Metadata-Flavor")).toBe("Google");
        calls.push({ url, authorization: null });
        return new Response("identity-token\n");
      }
      calls.push({
        url,
        authorization: headers.get("authorization"),
        body: String(init?.body),
      });
      return new Response(fixturePage, {
        headers: {
          "draft-loop-upstream-status": "200",
          "draft-loop-upstream-content-type": "text/html; charset=utf-8",
        },
      });
    };
    const { extract, recordApplicationJobPage, requests } = await api({
      jobPageFetcher: hostedJobPageFetcher({ endpoint: fetcherEndpoint, fetch: stub }),
    });

    const created = await extract();

    expect(created.status).toBe(201);
    expect(requests).toEqual([]);
    expect(calls).toEqual([
      {
        url: `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(fetcherEndpoint)}`,
        authorization: null,
      },
      {
        url: `${fetcherEndpoint}/v1/fetch`,
        authorization: "Bearer identity-token",
        body: JSON.stringify({ url: pageUrl }),
      },
    ]);
    expect(recordApplicationJobPage).toHaveBeenCalledWith(
      expect.objectContaining({
        page: expect.objectContaining({ text: expect.stringContaining("Example Ledger") }),
      }),
    );
  });

  it("refuses with the fetcher's reason when the page fetcher cannot read the page", async () => {
    const { extract, recordApplicationJobPage } = await api({
      jobPageFetcher: hostedJobPageFetcher({
        endpoint: "http://page-fetcher:8080",
        fetch: async (input) => {
          expect(String(input)).toBe("http://page-fetcher:8080/v1/fetch");
          return Response.json({ code: "unsafe-url" }, { status: 422 });
        },
      }),
    });

    const refused = await extract();

    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/only fetches public https pages/u);
    expect(recordApplicationJobPage).not.toHaveBeenCalled();
  });
});
