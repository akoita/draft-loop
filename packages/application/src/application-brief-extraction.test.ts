import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IngestionResult, ingestUrl } from "@draft-loop/ingestion";
import { type BlobStoragePort, openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedApplicationDriver } from "./hosted-driver.js";
import { type ApplicationService, createApplicationService } from "./index.js";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "./workspace-settings.js";

const silent = { write: () => undefined };
const root = "/tenants/tenant-a/workspaces/workspace-1";
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A synthetic posting; no real employer or candidate material. */
const jobText = "Example Systems seeks a Platform Engineer to build TypeScript services.";

function memorySettings(): WorkspaceSettingsPort {
  const documents = new Map<string, string>();
  const key = (reference: string, name: WorkspaceSettingName) => `${reference}#${name}`;
  return {
    read: async (reference, name) => documents.get(key(reference, name)),
    write: async (reference, name, content) => {
      documents.set(key(reference, name), content);
    },
    remove: async (reference, name) => documents.delete(key(reference, name)),
  };
}

/** Extracting a brief exports nothing. */
const noExports: BlobStoragePort = {
  put: async () => {
    throw new Error("Extracting a brief exports nothing.");
  },
  get: async () => undefined,
  exists: async () => false,
  delete: async () => false,
};

/** An OpenAI-compatible completion carrying the extraction proposal, as a local server answers. */
function extractionCompletion(sourceId: string): unknown {
  const proposal = {
    schemaVersion: 1,
    role: { value: "Platform Engineer", sourceIds: [sourceId] },
    employer: { value: "Example Systems", sourceIds: [sourceId] },
    responsibilities: [],
    requirements: [
      {
        text: "Build TypeScript services",
        priority: "critical",
        sourceIds: [sourceId],
        excerpt: "build TypeScript services",
      },
    ],
    priorities: [],
    contradictions: [],
  };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "brief-extraction-1",
      choices: [{ message: { content: JSON.stringify(proposal) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    }),
  };
}

/**
 * A live hosted workspace (no fixtures) whose provider is a scripted local endpoint, with one
 * application keeping `kept` and its brief saved from `pasted` without extraction, as the API
 * saves a live brief before screening.
 */
async function liveBrief(options: { readonly kept?: string; readonly pasted?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-brief-extraction-"));
  scratch.push(directory);
  let onCall: () => Promise<void> = async () => undefined;
  const transport = vi.fn(async (_url: string, _init: RequestInit) => {
    await onCall();
    return extractionCompletion("posting");
  });
  const service: ApplicationService = createApplicationService(
    createHostedApplicationDriver({
      settings: memorySettings(),
      storage: {
        open: async (reference) =>
          openSqliteStorage(
            join(directory, `${createHash("sha256").update(reference).digest("hex")}.sqlite`),
          ),
        exportBlobs: noExports,
      },
      openKnowledgeStore: async () => {
        throw new Error("No knowledge store is needed to extract a brief.");
      },
      local: {
        applicationPlan: false,
        providerClientFactories: {
          local: () => ({ fetch: transport as unknown as typeof fetch }),
        },
      },
    }),
  );
  await service.initialize(
    {
      root,
      jobDescription: "job.md",
      sources: "sources",
      authorCompany: "local",
      authorModel: "qwen-opportunity-extractor",
      criticCompany: "anthropic",
      criticModel: "claude-sonnet-4-5",
    },
    silent,
  );
  const application = await service.createApplication?.({
    root,
    id: "app-platform",
    name: "Platform engineer",
    jobSource: { kind: "pasted-text", text: options.kept ?? jobText },
  });
  if (application === undefined) throw new Error("The hosted driver creates applications.");
  const created = await service.createOpportunity({
    root,
    applicationId: "app-platform",
    sources: [
      {
        id: "posting",
        kind: "pasted-content",
        classification: "job-posting",
        content: options.pasted ?? jobText,
      },
    ],
  });
  const extract = (overrides: { readonly allowProviderData?: boolean } = {}) =>
    service.extractApplicationBrief?.({
      root,
      applicationId: "app-platform",
      briefId: created.brief.id,
      expectedVersion: created.brief.version,
      allowProviderData: true,
      ...overrides,
    });
  return {
    service,
    created,
    extract,
    transport,
    setOnCall: (next: () => Promise<void>) => {
      onCall = next;
    },
  };
}

describe("extracting a live hosted brief from its application's approved job page", () => {
  const pageUrl = "https://jobs.example.test/platform-engineer";

  /** An application created from an approved page, whose brief came from one fetch of it. */
  async function pageBrief() {
    const { service } = await liveBrief();
    await service.createApplication?.({
      root,
      id: "app-page",
      name: "Platform engineer by page",
      jobSource: { kind: "approved-url", url: pageUrl, approved: true },
    });
    let fetched: IngestionResult | undefined;
    const fetcher = vi.fn(
      async () => new Response(jobText, { headers: { "content-type": "text/plain" } }),
    );
    const created = await service.createOpportunity({
      root,
      applicationId: "app-page",
      sources: [
        {
          id: "posting",
          kind: "approved-url",
          classification: "job-posting",
          url: pageUrl,
          approved: true,
        },
      ],
      ingestUrl: async (url, options) => {
        fetched = await ingestUrl(url, { ...options, fetcher });
        return fetched;
      },
    });
    const provenance = fetched?.source?.url;
    if (provenance === undefined) throw new Error("The page was not fetched.");
    const extract = () =>
      service.extractApplicationBrief?.({
        root,
        applicationId: "app-page",
        briefId: created.brief.id,
        expectedVersion: created.brief.version,
        allowProviderData: true,
      });
    return { service, created, fetcher, provenance, extract };
  }

  it("extracts the text the page gave at that fetch, without fetching it again", async () => {
    const { service, fetcher, provenance, extract } = await pageBrief();
    await service.recordApplicationJobPage?.({
      root,
      applicationId: "app-page",
      page: { text: jobText, finalUrl: provenance.finalUrl, fetchedAt: provenance.fetchedAt },
    });

    expect((await extract())?.outcome).toBe("extracted");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("sends nothing before the page's text is kept, or for another fetch's text", async () => {
    const { service, provenance, extract } = await pageBrief();
    expect((await extract())?.outcome).toBe("job-text-changed");

    await service.recordApplicationJobPage?.({
      root,
      applicationId: "app-page",
      page: { text: jobText, finalUrl: provenance.finalUrl, fetchedAt: "2030-01-01T00:00:00.000Z" },
    });
    expect((await extract())?.outcome).toBe("job-text-changed");
  });
});

describe("extracting a live hosted brief from its application's job text", () => {
  it("saves the extracted facts as the brief's next draft version", async () => {
    const { service, created, extract, transport } = await liveBrief();
    expect(created.brief.role).toBeNull();

    const result = await extract();

    expect(result?.outcome).toBe("extracted");
    expect(transport).toHaveBeenCalledOnce();
    expect(String(transport.mock.calls[0]?.[1].body)).toContain("TypeScript services");
    const latest = await service.getOpportunity({ root, briefId: created.brief.id });
    expect(latest?.brief).toMatchObject({
      version: 2,
      priorVersion: 1,
      status: "draft",
      role: { value: "Platform Engineer", sourceIds: ["posting"] },
      employer: { value: "Example Systems", sourceIds: ["posting"] },
      sources: created.brief.sources,
    });
    expect(latest?.brief.requirements.map(({ text }) => text)).toEqual([
      "Build TypeScript services",
    ]);
    expect(result?.record).toEqual(latest);
  });

  it("keeps an edit the person saved first, without a provider call", async () => {
    const { service, created, extract, transport } = await liveBrief();
    await service.editOpportunity({
      root,
      briefId: created.brief.id,
      expectedVersion: 1,
      patch: { role: { value: "Staff Engineer", sourceIds: ["posting"] } },
    });

    expect(await extract()).toEqual({ outcome: "brief-moved" });
    expect(transport).not.toHaveBeenCalled();
    const latest = await service.getOpportunity({ root, briefId: created.brief.id });
    expect(latest?.brief.role?.value).toBe("Staff Engineer");
  });

  it("keeps an edit the person saved while the provider answered", async () => {
    const { service, created, extract, setOnCall } = await liveBrief();
    setOnCall(async () => {
      await service.editOpportunity({
        root,
        briefId: created.brief.id,
        expectedVersion: 1,
        patch: { role: { value: "Staff Engineer", sourceIds: ["posting"] } },
      });
    });

    expect(await extract()).toEqual({ outcome: "brief-moved" });
    const latest = await service.getOpportunity({ root, briefId: created.brief.id });
    expect(latest?.brief).toMatchObject({ version: 2, role: { value: "Staff Engineer" } });
  });

  it("sends nothing when the kept job text no longer matches the brief's source", async () => {
    const { extract, transport } = await liveBrief({
      pasted: "Example Systems seeks a Data Engineer.",
    });

    expect(await extract()).toEqual({ outcome: "job-text-changed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends nothing without a provider data approval", async () => {
    const { extract, transport } = await liveBrief();

    expect(await extract({ allowProviderData: false })).toEqual({
      outcome: "provider-data-refused",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("treats a brief of another application as missing", async () => {
    const { service, created, transport } = await liveBrief();

    const result = await service.extractApplicationBrief?.({
      root,
      applicationId: "default",
      briefId: created.brief.id,
      expectedVersion: 1,
      allowProviderData: true,
    });

    expect(result).toEqual({ outcome: "missing" });
    expect(transport).not.toHaveBeenCalled();
  });
});
