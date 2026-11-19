import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import {
  createMemoryFactSuggestionStore,
  type FactSuggestionStore,
} from "@draft-loop/storage/fact-suggestions";
import { fixtureFactSuggestion } from "@draft-loop/storage/fact-suggestions-conformance";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const base = "/v1/workspaces/owner/profiles/profile-1/suggestions";

// Fictional facts and quotes only.
const reference = {
  storeId: "store-1",
  knowledgeBaseId: "kb-1",
  sourceId: "cv",
  versionId: "cv-v1",
  kind: "candidate-provided",
};
function profileRecord(version: number, value: string, status = "reviewed") {
  return {
    checksum: `checksum-${version}`,
    profile: {
      id: "profile-1",
      version,
      status,
      facts: [
        {
          id: "fact-1",
          category: "achievement",
          field: "team size",
          value,
          provenance: [reference],
        },
      ],
      issues: [],
    },
  } as unknown as CanonicalCandidateProfileVersionRecord;
}

let app: FastifyInstance;

async function build(store: FactSuggestionStore) {
  let latest = profileRecord(3, "Led a team of 5");
  const added: string[] = [];
  const service = {
    getCanonicalCandidateProfile: async () => latest,
    editCanonicalCandidateProfile: async (command: {
      expectedVersion: number;
      patch: { facts: unknown[] };
    }) => {
      const fact = command.patch.facts[0] as { value: string };
      latest = profileRecord(command.expectedVersion + 1, fact.value, "draft");
      return latest;
    },
    reviewCanonicalCandidateProfile: async (command: { expectedVersion: number }) => {
      latest = profileRecord(command.expectedVersion + 1, latest.profile.facts[0]?.value ?? "");
      return latest;
    },
  } as unknown as ApplicationService;
  const intake = {
    ensureStore: async () => ({ id: "store-1" }),
    addFileSource: async (input: { knowledgeBaseId: string; displayName: string }) => {
      added.push(`${input.knowledgeBaseId}/${input.displayName}`);
      return {
        created: true,
        source: { id: "statement", knowledgeBaseId: input.knowledgeBaseId, displayName: "s" },
        latestVersion: { id: "statement-v1", mediaType: "text/markdown" },
      };
    },
  } as unknown as HostedKnowledgeIntake;
  app = await buildApi({
    ownerToken,
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      knowledgeIntake: intake,
      factSuggestions: store,
    },
  });
  return { added, latest: () => latest };
}

afterEach(async () => {
  await app.close();
});

describe("fact suggestion routes", () => {
  it("lists pending suggestions and accepts one into a reviewed version citing the statement", async () => {
    const store = createMemoryFactSuggestionStore();
    await store.insert("owner", fixtureFactSuggestion("fsg_route00001", "Led a team of 8"));
    const harness = await build(store);

    const listed = await app.inject({ method: "GET", url: base, headers: { authorization } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ pending: 1, suggestions: [{ id: "fsg_route00001" }] });

    const accepted = await app.inject({
      method: "POST",
      url: `${base}/accept`,
      headers: { authorization },
      payload: { items: [{ id: "fsg_route00001" }] },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      applied: ["fsg_route00001"],
      stale: [],
      profile: { version: 5, status: "reviewed" },
    });
    expect(harness.added).toEqual([expect.stringMatching(/^kb-1\/candidate-statement-/u)]);
    expect(harness.latest().profile.facts[0]?.value).toBe("Led a team of 8");
    expect(await store.get("owner", "fsg_route00001")).toMatchObject({
      status: "accepted",
      decision: { role: "candidate", memberId: "owner" },
    });

    const again = await app.inject({
      method: "POST",
      url: `${base}/accept`,
      headers: { authorization },
      payload: { items: [{ id: "fsg_route00001" }] },
    });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ error: { code: "suggestion_not_found" } });
  });

  it("rejects a suggestion and refuses an edit of another kind or a bad body", async () => {
    const store = createMemoryFactSuggestionStore();
    await store.insert("owner", fixtureFactSuggestion("fsg_route00002", "Led a team of 9"));
    await build(store);

    const wrongKind = await app.inject({
      method: "POST",
      url: `${base}/accept`,
      headers: { authorization },
      payload: { items: [{ id: "fsg_route00002", edit: { kind: "retire" } }] },
    });
    expect(wrongKind.statusCode).toBe(422);
    expect(wrongKind.json()).toMatchObject({ error: { code: "invalid_edit" } });

    const empty = await app.inject({
      method: "POST",
      url: `${base}/accept`,
      headers: { authorization },
      payload: { items: [] },
    });
    expect(empty.statusCode).toBe(400);

    const rejected = await app.inject({
      method: "POST",
      url: `${base}/fsg_route00002/reject`,
      headers: { authorization },
    });
    expect(rejected.statusCode).toBe(204);
    expect(await store.get("owner", "fsg_route00002")).toMatchObject({ status: "rejected" });
    const listed = await app.inject({
      method: "GET",
      url: `${base}?status=rejected`,
      headers: { authorization },
    });
    expect(listed.json()).toMatchObject({ pending: 0, suggestions: [{ status: "rejected" }] });
  });
});
