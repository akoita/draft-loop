import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import { describe, expect, it } from "vitest";

import type { ContentScreener } from "./content-screening.js";
import {
  createWorkJournalService,
  mergeWorkJournalContent,
  type WorkJournalPublish,
  type WorkJournalService,
} from "./work-journal.js";

// Fictional project, repository and links only.
const note = {
  title: "Card payments for the Fernhill booking site",
  summary:
    "Added card payments to the booking flow with a hosted checkout page, webhook handling for paid and refunded bookings, and retries for failed deliveries.",
  period: { start: "2026-10-12", end: "2026-10-30" },
  project: { name: "Fernhill bookings", visibility: "private", repository: "fernhill/bookings" },
  technologies: ["TypeScript", "Stripe", "Postgres"],
  category: "payments",
  candidate_role: ["designed", "implemented"],
  links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
  metrics: [],
};

function setup(
  options: {
    readonly publish?: WorkJournalPublish;
    readonly screener?: ContentScreener;
    readonly perHour?: number;
    readonly pendingPerTenant?: number;
    readonly clock?: { value: string };
  } = {},
) {
  const store = createMemoryWorkJournalNoteStore();
  const clock = options.clock ?? { value: "2026-11-03T10:00:00.000Z" };
  let sequence = 0;
  const journal = createWorkJournalService({
    store,
    tenantId: "tenant-1",
    now: () => clock.value,
    newId: () => {
      sequence += 1;
      return `wjn_fixture${String(sequence).padStart(4, "0")}`;
    },
    ...(options.publish === undefined ? {} : { publish: options.publish }),
    ...(options.screener === undefined ? {} : { screener: options.screener }),
    limits: {
      ...(options.perHour === undefined ? {} : { perHour: options.perHour }),
      ...(options.pendingPerTenant === undefined
        ? {}
        : { pendingPerTenant: options.pendingPerTenant }),
    },
  });
  return { journal, store, clock };
}

async function enabled(journal: WorkJournalService) {
  await journal.setIntake("owner", true);
  return journal;
}

describe("work journal intake", () => {
  it("refuses every note until the candidate turns intake on", async () => {
    const { journal } = setup();
    await expect(journal.record("owner", note)).rejects.toMatchObject({ code: "not_consented" });
    await journal.setIntake("owner", true);
    await expect(journal.record("owner", note)).resolves.toMatchObject({
      status: "pending",
      note_id: "wjn_fixture0001",
      screening: "clear",
    });
  });

  it("refuses secret-like content and bad links with codes that carry no note text", async () => {
    const journal = await enabled(setup().journal);
    const secret = journal.record("owner", {
      ...note,
      summary: `${note.summary} ghp_${"A".repeat(36)}`,
    });
    await expect(secret).rejects.toMatchObject({ code: "secret_like_content" });
    const link = journal.record("owner", {
      ...note,
      links: [{ kind: "commit", url: "http://git.example.test/c/1" }],
    });
    await expect(link).rejects.toMatchObject({ code: "link_not_https", fields: ["links.0.url"] });
    expect(await journal.list("owner")).toEqual([]);
  });

  it("validates a dry run without storing it", async () => {
    const journal = await enabled(setup().journal);
    await expect(journal.record("owner", { ...note, dry_run: true })).resolves.toMatchObject({
      status: "validated",
    });
    expect(await journal.list("owner")).toEqual([]);
  });

  it("turning intake off deletes pending notes", async () => {
    const journal = await enabled(setup().journal);
    await journal.record("owner", note);
    await journal.setIntake("owner", false);
    expect(await journal.list("owner")).toEqual([]);
  });
});

describe("work journal dedupe", () => {
  it("answers duplicate for the same work and previously_discarded once discarded", async () => {
    const journal = await enabled(setup().journal);
    const first = await journal.record("owner", note);
    await expect(
      journal.record("owner", { ...note, title: "Another title for it" }),
    ).resolves.toMatchObject({
      status: "duplicate",
      duplicate_of: first.note_id,
    });
    await journal.review("owner", first.note_id ?? "", { action: "discard" });
    await expect(journal.record("owner", note)).resolves.toMatchObject({
      status: "previously_discarded",
      duplicate_of: first.note_id,
    });
  });

  it("still answers previously_discarded after the discarded text ages out", async () => {
    const clock = { value: "2026-11-03T10:00:00.000Z" };
    const journal = await enabled(setup({ clock }).journal);
    const first = await journal.record("owner", note);
    await journal.review("owner", first.note_id ?? "", { action: "discard" });
    clock.value = "2026-12-10T10:00:00.000Z";
    await expect(journal.record("owner", note)).resolves.toMatchObject({
      status: "previously_discarded",
      duplicate_of: first.note_id,
    });
    await expect(journal.get("owner", first.note_id ?? "")).rejects.toMatchObject({
      code: "note_not_found",
    });
  });

  it("marks a likely duplicate and merges it on review", async () => {
    const journal = await enabled(setup().journal);
    const first = await journal.record("owner", note);
    const second = await journal.record("owner", {
      ...note,
      title: "Refund webhooks for Fernhill",
      links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/43" }],
      technologies: ["Stripe", "Postgres", "Redis"],
      period: { start: "2026-10-20", end: "2026-11-02" },
    });
    expect(second.possible_duplicate_of).toEqual([first.note_id]);
    const merged = await journal.review("owner", second.note_id ?? "", {
      action: "merge",
      into: first.note_id ?? "",
    });
    expect(merged.content.period).toEqual({ start: "2026-10-12", end: "2026-11-02" });
    expect(merged.content.links).toHaveLength(2);
    expect(merged.content.technologies).toEqual(["TypeScript", "Stripe", "Postgres", "Redis"]);
    expect((await journal.get("owner", second.note_id ?? "")).status).toBe("merged");
  });

  it("amends a pending note and refuses to amend a discarded one", async () => {
    const journal = await enabled(setup().journal);
    const first = await journal.record("owner", note);
    await expect(
      journal.record("owner", {
        ...note,
        title: "Card payments, refunds included",
        amends: first.note_id,
      }),
    ).resolves.toMatchObject({ status: "amended", note_id: first.note_id });
    expect((await journal.get("owner", first.note_id ?? "")).content.title).toBe(
      "Card payments, refunds included",
    );
    await journal.review("owner", first.note_id ?? "", { action: "discard" });
    await expect(journal.record("owner", { ...note, amends: first.note_id })).rejects.toMatchObject(
      {
        code: "amend_not_pending",
      },
    );
  });
});

describe("work journal limits", () => {
  it("answers rate_limited past the hourly and pending limits", async () => {
    const journal = await enabled(setup({ perHour: 1 }).journal);
    await journal.record("owner", note);
    await expect(
      journal.record("owner", { ...note, links: [], title: "Second fixture note" }),
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
    const tenant = await enabled(setup({ pendingPerTenant: 1 }).journal);
    await tenant.record("owner", note);
    await expect(
      tenant.record("owner", { ...note, links: [], title: "Second fixture note" }),
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});

describe("work journal review", () => {
  const flagging: ContentScreener = {
    identity: { id: "fixture-flagger", version: "1" },
    screen: async () => ({
      verdict: "flagged",
      signals: ["instruction-override"],
      screeners: [{ id: "fixture-flagger", version: "1" }],
      screenedAt: "2026-11-03T10:00:00.000Z",
    }),
  };

  it("never approves a quarantined note", async () => {
    const publish: WorkJournalPublish = async () => ({ sourceId: "source-1", status: "created" });
    const journal = await enabled(setup({ screener: flagging, publish }).journal);
    const recorded = await journal.record("owner", note);
    expect(recorded.screening).toBe("flagged");
    await expect(
      journal.review("owner", recorded.note_id ?? "", {
        action: "approve",
        knowledge_base_id: "kb-1",
      }),
    ).rejects.toMatchObject({ code: "note_quarantined" });
  });

  it("approves with the visibility's default tier through publish", async () => {
    const calls: unknown[] = [];
    const publish: WorkJournalPublish = async (input) => {
      calls.push({ tier: input.tier, knowledgeBaseId: input.knowledgeBaseId });
      return { sourceId: "source-1", status: "created" };
    };
    const journal = await enabled(setup({ publish }).journal);
    const recorded = await journal.record("owner", note);
    const approved = await journal.review("owner", recorded.note_id ?? "", {
      action: "approve",
      knowledge_base_id: "kb-1",
    });
    expect(calls).toEqual([{ tier: "sensitive", knowledgeBaseId: "kb-1" }]);
    expect(approved).toMatchObject({
      status: "approved",
      approval: { knowledge_base_id: "kb-1", tier: "sensitive", source_id: "source-1" },
    });
    await expect(
      journal.review("owner", recorded.note_id ?? "", { action: "discard" }),
    ).rejects.toMatchObject({ code: "note_not_pending" });
  });

  it("answers approval_unavailable without a publisher and counts edits", async () => {
    const journal = await enabled(setup().journal);
    const recorded = await journal.record("owner", note);
    const edited = await journal.review("owner", recorded.note_id ?? "", {
      action: "edit",
      content: { ...note, title: "Card payments at Fernhill" },
    });
    expect(edited).toMatchObject({
      edit_count: 1,
      content: { title: "Card payments at Fernhill" },
    });
    await expect(
      journal.review("owner", recorded.note_id ?? "", {
        action: "approve",
        knowledge_base_id: "kb-1",
      }),
    ).rejects.toMatchObject({ code: "approval_unavailable" });
  });

  it("lists titles without summaries for agents", async () => {
    const journal = await enabled(setup().journal);
    await journal.record("owner", note);
    const [item] = await journal.list("owner");
    expect(item).toMatchObject({ title: note.title, project: "Fernhill bookings" });
    expect(JSON.stringify(item)).not.toContain("hosted checkout");
  });
});

describe("mergeWorkJournalContent", () => {
  it("keeps the source's summary when asked", () => {
    const base = { ...note, metrics: [], links: [] } as unknown as Parameters<
      typeof mergeWorkJournalContent
    >[0];
    const merged = mergeWorkJournalContent(base, { ...base, summary: "x".repeat(50) }, "this");
    expect(merged.summary).toBe("x".repeat(50));
  });
});

describe("work journal provenance", () => {
  it("keeps the filing agent token, adds amending ones and filters by either", async () => {
    const { journal, store } = setup();
    await enabled(journal);
    const filed = await journal.record("owner", note, { agentTokenId: "dlat_fixtureAAAA" });
    const id = filed.note_id as string;
    expect((await journal.get("owner", id)).agent_token_id).toBe("dlat_fixtureAAAA");

    await journal.record(
      "owner",
      { ...note, summary: `${note.summary} Amended.`, amends: id },
      { agentTokenId: "dlat_fixtureBBBB" },
    );
    const amended = await journal.get("owner", id);
    expect(amended.agent_token_id).toBe("dlat_fixtureAAAA");
    expect(amended.amended_by_agent_token_ids).toEqual(["dlat_fixtureBBBB"]);

    await journal.record("owner", { ...note, title: "Owner filed", links: [] });
    const byFiler = await journal.listFull("owner", { agentTokenId: "dlat_fixtureAAAA" });
    const byAmender = await journal.listFull("owner", { agentTokenId: "dlat_fixtureBBBB" });
    expect(byFiler.map((each) => each.id)).toEqual([id]);
    expect(byAmender.map((each) => each.id)).toEqual([id]);
    expect(await journal.listFull("owner", {})).toHaveLength(2);

    // A replace cannot rewrite who filed the note.
    await store.replace({ ...amended, agent_token_id: "dlat_fixtureCCCC" });
    expect((await journal.get("owner", id)).agent_token_id).toBe("dlat_fixtureAAAA");
    // Nor give an owner-filed note a filing token.
    const owners = (await journal.listFull("owner", {})).find((each) => each.id !== id);
    await store.replace({ ...(owners as typeof amended), agent_token_id: "dlat_fixtureCCCC" });
    expect((await journal.get("owner", owners?.id as string)).agent_token_id).toBeUndefined();
  });

  it("keeps the agent's title listing free of token ids", async () => {
    const { journal } = setup();
    await enabled(journal);
    await journal.record("owner", note, { agentTokenId: "dlat_fixtureAAAA" });
    expect(JSON.stringify(await journal.list("owner"))).not.toContain("dlat_");
  });
});
