import { canonicalCandidateProfileGenerationCancelledMessage } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { createProfileAnswers, type ProfileCommand } from "./profile-bridge.js";

const workspaceId = "owner";
const profileId = "career";
const timestamp = "2026-10-25T10:00:00.000Z";

/** A fictional career profile in the API's view; no real candidate or employer. */
function profileView(
  version: number,
  status: "draft" | "reviewed" = "draft",
  id = profileId,
): ApiSchemas["CareerProfile"] {
  return {
    workspaceId,
    checksum: "b".repeat(64),
    profile: {
      schemaVersion: 1,
      id,
      version,
      parentVersion: version === 1 ? null : version - 1,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(status === "reviewed" ? { reviewedAt: timestamp } : {}),
      candidateKnowledgeSelection: { capturedAt: timestamp, entries: [] },
      facts: [
        {
          id: "fact-1",
          category: "role",
          field: "title",
          value: "Platform Engineer",
          provenance: [
            {
              storeId: "store-1",
              knowledgeBaseId: "knowledge-1",
              sourceId: "source-1",
              versionId: "version-1",
              kind: "candidate-provided",
              quote: "Platform Engineer, Example Ledger",
            },
          ],
        },
      ],
      issues: [],
    },
  } as unknown as ApiSchemas["CareerProfile"];
}

type Handler = (input: Record<string, unknown>) => unknown;

function answersOver(handlers: Readonly<Record<string, Handler>>) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  const waits: number[] = [];
  const answer = createProfileAnswers(client, {
    pollMs: 5,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { answer, calls, waits };
}

const derivationPath = "/v1/workspaces/{workspaceId}/profiles/{profileId}/derivation";
const derive: ProfileCommand = {
  type: "profile.derive",
  input: { workspaceId, profileId, providerTransmissionApproved: true },
};

/** Answers each derivation read with the next state, holding the last. */
function derivationStates(...states: ApiSchemas["CareerProfileDerivation"][]): Handler {
  return () => (states.length > 1 ? states.shift() : states[0]);
}

describe("career profile commands over HTTP", () => {
  it("queues a derivation with the person's approval and waits for the version it saved", async () => {
    const { answer, calls, waits } = answersOver({
      [`POST ${derivationPath}`]: () => ({ status: "pending" }),
      [`GET ${derivationPath}`]: derivationStates(
        { status: "pending" },
        { status: "pending", completedCalls: 1, plannedCalls: 2 },
        { status: "derived", version: 3 },
      ),
      "GET /v1/workspaces/{workspaceId}/profiles/{profileId}": () => profileView(3),
    });

    const derived = await answer(derive);

    expect(derived).toMatchObject({ workspaceId, profileId, version: 3, status: "draft" });
    expect(calls[0]?.input).toEqual({
      path: { workspaceId, profileId },
      body: { providerDataApproved: true },
    });
    expect(calls.at(-1)?.input).toEqual({
      path: { workspaceId, profileId },
      query: { version: 3 },
    });
    expect(waits).toEqual([5, 5]);
  });

  it("asks for every source again only when the person chose it", async () => {
    const { answer, calls } = answersOver({
      [`POST ${derivationPath}`]: () => ({ status: "pending" }),
      [`GET ${derivationPath}`]: () => ({ status: "derived", version: 1 }),
      "GET /v1/workspaces/{workspaceId}/profiles/{profileId}": () => profileView(1),
    });

    await answer({
      type: "profile.derive",
      input: { workspaceId, profileId, fullExtraction: true },
    });

    expect(calls[0]?.input).toMatchObject({
      body: { providerDataApproved: false, fullExtraction: true },
    });
  });

  it("ends a cancelled or failed derivation with the desktop's words", async () => {
    const outcomes: [ApiSchemas["CareerProfileDerivation"], string][] = [
      [{ status: "cancelled" }, canonicalCandidateProfileGenerationCancelledMessage],
      [
        { status: "failed", reason: "consent-required" },
        "The candidate's consent does not cover sending this evidence to the workspace's providers.",
      ],
      [{ status: "failed", reason: "record-erased" }, "This candidate record was erased."],
      [
        { status: "failed", reason: "failed", message: "Select career evidence first." },
        "Select career evidence first.",
      ],
    ];
    for (const [state, message] of outcomes) {
      const { answer } = answersOver({
        [`POST ${derivationPath}`]: () => ({ status: "pending" }),
        [`GET ${derivationPath}`]: () => state,
      });

      await expect(answer(derive)).rejects.toThrow(message);
    }
  });

  it("reads progress while a derivation runs, and nothing active before or after", async () => {
    const { answer } = answersOver({
      [`GET ${derivationPath}`]: derivationStates(
        { status: "pending", completedCalls: 2, plannedCalls: 5 },
        { status: "pending" },
        { status: "derived", version: 1 },
      ),
    });
    const missing = answersOver({
      [`GET ${derivationPath}`]: () => {
        throw new ApiRequestError(404, "not_found", "No derivation of this profile.");
      },
    });
    const progress: ProfileCommand = {
      type: "profile.progress",
      input: { workspaceId, profileId },
    };

    expect(await answer(progress)).toEqual({ active: true, completedCalls: 2, plannedCalls: 5 });
    expect(await answer(progress)).toEqual({ active: true });
    expect(await answer(progress)).toEqual({ active: false });
    expect(await missing.answer(progress)).toEqual({ active: false });
  });

  it("cancels the running derivation", async () => {
    const { answer, calls } = answersOver({
      [`DELETE ${derivationPath}`]: () => ({ cancelled: true }),
    });

    expect(await answer({ type: "profile.cancel", input: { workspaceId, profileId } })).toEqual({
      cancelled: true,
    });
    expect(calls[0]?.input).toEqual({ path: { workspaceId, profileId } });
  });

  it("edits and reviews against the version the person saw", async () => {
    const { answer, calls } = answersOver({
      "PATCH /v1/workspaces/{workspaceId}/profiles/{profileId}": () => profileView(2),
      "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/review": () =>
        profileView(3, "reviewed"),
    });

    const edited = await answer({
      type: "profile.edit",
      input: { workspaceId, profileId, expectedVersion: 1, patch: { issues: [] } },
    });
    const reviewed = await answer({
      type: "profile.review",
      input: { workspaceId, profileId, expectedVersion: 2 },
    });

    expect(edited).toMatchObject({ version: 2, status: "draft" });
    expect(reviewed).toMatchObject({ version: 3, status: "reviewed" });
    expect(calls.map(({ input }) => input.body)).toEqual([
      { expectedVersion: 1, patch: { issues: [] } },
      { expectedVersion: 2 },
    ]);
  });

  it("builds the reviewed-profile catalog a run chooses from", async () => {
    const { answer } = answersOver({
      "GET /v1/workspaces/{workspaceId}/profiles": () => ({
        versions: [
          profileView(1, "reviewed"),
          profileView(2, "draft"),
          profileView(1, "draft", "other"),
        ],
      }),
    });

    const catalog = await answer({ type: "profile.catalog", input: { workspaceId } });

    expect(catalog).toEqual({
      workspaceId,
      profiles: [{ profileId, version: 1, reviewedAt: timestamp }],
    });
  });

  it("refuses a record that names another profile than the one asked for", async () => {
    const { answer } = answersOver({
      "GET /v1/workspaces/{workspaceId}/profiles/{profileId}": () =>
        profileView(1, "draft", "other"),
    });

    await expect(
      answer({ type: "profile.get", input: { workspaceId, profileId } }),
    ).rejects.toThrow();
  });
});
