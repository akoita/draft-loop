import {
  type ApplicationService,
  createOpportunityDraft,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
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

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const at = "2026-10-25T10:00:00.000Z";
const authorization = `Bearer ${ownerToken}`;

/** Synthetic postings: one the scripted screener clears, one it flags. */
const cleanText = "Fictional Platform Engineer role at Example Ledger";
const flaggedText = "FLAG-ME Fictional posting text";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A screener that flags `FLAG-ME` and clears everything else, storing nothing beyond the call. */
function scriptedScreening(): HostedContentScreening {
  let count = 0;
  return {
    mode: "rules",
    store: {} as ContentScreeningStore,
    screen: async (input): Promise<StoredContentScreeningResult> => {
      count += 1;
      const flagged = input.text?.includes("FLAG-ME") === true;
      return {
        id: `screening-${count}`,
        subject: input.subject,
        result: {
          verdict: flagged ? "flagged" : "clear",
          signals: flagged ? ["instruction-override"] : [],
          screeners: [{ id: "rules", version: "test" }],
          screenedAt: at,
        },
        recordedAt: at,
      };
    },
  };
}

/** A service whose briefs are saved unextracted, as a live hosted workspace saves them. */
async function api(options: { readonly fixtureMode?: boolean } = {}) {
  const briefs = new Map<string, OpportunityBriefVersionRecord>();
  const service = {
    readWorkspace: async () =>
      ({ id: "history-1", fixtureMode: options.fixtureMode ?? false }) as WorkspaceDescriptor,
    createOpportunity: async (command: {
      sources: Parameters<typeof createOpportunityDraft>[0]["sources"];
    }) => {
      const brief = await createOpportunityDraft(
        { id: `brief-${briefs.size + 1}`, createdAt: at, sources: command.sources },
        { now: () => at },
      );
      const record = { workspaceId: "history-1", checksum: "a".repeat(64), brief };
      briefs.set(brief.id, record);
      return record;
    },
    getOpportunity: async (command: { briefId: string }) => briefs.get(command.briefId),
  } as unknown as ApplicationService;
  const extractions = {
    queue: vi.fn<BriefExtractions["queue"]>(async () => true),
    state: vi.fn<BriefExtractions["state"]>(async () => "pending"),
  };
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
    },
  });
  const server = app;
  /** `null` sends no application id. */
  const create = async (content: string, applicationId: string | null = "app-1") => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/workspaces/r1/opportunities",
      headers: { authorization },
      payload: {
        sources: [
          { id: "posting", kind: "pasted-content", classification: "job-posting", content },
        ],
        ...(applicationId === null ? {} : { applicationId }),
      },
    });
    return { status: response.statusCode, body: response.json() };
  };
  return { server, extractions, create };
}

describe("queueing a live brief's extraction", () => {
  it("queues a live brief once screening clears its job text, and says it is pending", async () => {
    const { server, extractions, create } = await api();

    const created = await create(cleanText);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ brief: { id: "brief-1", role: null } });
    expect(created.body.extraction).toBe("pending");
    expect(extractions.queue).toHaveBeenCalledWith({
      workspaceId: "r1",
      applicationId: "app-1",
      briefId: "brief-1",
      version: 1,
    });

    const read = await server.inject({
      method: "GET",
      url: "/v1/workspaces/r1/opportunities/brief-1",
      headers: { authorization },
    });
    expect(read.json().extraction).toBe("pending");
    expect(extractions.state).toHaveBeenCalledWith({
      workspaceId: "r1",
      briefId: "brief-1",
      version: 1,
    });
  });

  it("never queues a job text that screening flagged", async () => {
    const { extractions, create } = await api();

    const created = await create(flaggedText);

    expect(created.status).toBe(201);
    expect(created.body.screening.verdict).toBe("flagged");
    expect(created.body).not.toHaveProperty("extraction");
    expect(extractions.queue).not.toHaveBeenCalled();
  });

  it("leaves a fixture workspace's brief to the extraction it had when saved", async () => {
    const { extractions, create } = await api({ fixtureMode: true });

    const created = await create(cleanText);

    expect(created.body).not.toHaveProperty("extraction");
    expect(extractions.queue).not.toHaveBeenCalled();
  });

  it("queues nothing for a brief outside a named application, which keeps no job text", async () => {
    const { extractions, create } = await api();

    expect((await create(cleanText, null)).body).not.toHaveProperty("extraction");
    expect((await create(cleanText, "default")).body).not.toHaveProperty("extraction");
    expect(extractions.queue).not.toHaveBeenCalled();
  });

  it("saves the brief without a pending state when the queue is down", async () => {
    const { extractions, create } = await api();
    extractions.queue.mockRejectedValueOnce(new Error("queue unavailable"));

    const created = await create(cleanText);

    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("extraction");
  });
});
