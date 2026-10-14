import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestUrl } from "@draft-loop/ingestion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

describe("URL refresh across a backward wall-clock step", () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-url-refresh-clock-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(parent, { recursive: true, force: true });
  });

  it("stamps fetches with the service clock so a later unchanged refresh stays current", async () => {
    const storeRoot = join(parent, "store");
    const originalUrl = "https://example.com/candidate";
    let body = "First public evidence";
    const ids = ["store-id", "ckb-id", "source-id", "version-1", "version-2", "unused-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl: (url, options) =>
        ingestUrl(url, {
          ...options,
          resolveHostname: async () => ["93.184.216.34"],
          fetcher: async () => new Response(body, { headers: { "content-type": "text/plain" } }),
        }),
    });
    const start = Date.parse("2026-10-14T09:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "ckb-id",
      url: originalUrl,
      approved: true,
    });

    body = "Changed public evidence";
    vi.setSystemTime(start + 10_000);
    const refreshed = await service.refreshKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "ckb-id",
      sourceId: "source-id",
      approved: true,
    });
    expect(refreshed).toMatchObject({ status: "refreshed", versionId: "version-2" });

    // WSL2 and NTP corrections can step the wall clock back by about a second.
    vi.setSystemTime(start + 10_000 - 1_200);
    const current = await service.refreshKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "ckb-id",
      sourceId: "source-id",
      approved: true,
    });
    expect(current).toEqual({
      sourceId: "source-id",
      status: "current",
      checkedAt: refreshed.checkedAt,
    });
  });
});
