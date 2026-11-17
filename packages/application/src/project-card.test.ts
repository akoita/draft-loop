import { classifySourceSections } from "@draft-loop/domain/source-sensitivity";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import { describe, expect, it, vi } from "vitest";

import { excludedSensitivityTiersForConsent } from "./sensitive-knowledge-consent.js";
import { createWorkJournalService, type WorkJournalPublish } from "./work-journal.js";
import {
  createWorkJournalPublisher,
  renderWorkJournalMarkdown,
  workJournalSourceRules,
} from "./work-journal-source.js";

// A fictional repository and fictional links only.
const publicCard = {
  name: "Tidewater",
  purpose: "A command-line tool that plans tide-safe kayak trips",
  summary:
    "Tidewater reads public tide tables and proposes launch windows for a kayak route, with offline caching and a plain-text report.",
  role: "sole-author",
  visibility: "public",
  stack: ["TypeScript", "Node.js", "SQLite"],
  contribution: {
    own_commits: 412,
    total_commits: 430,
    first_commit: "2025-10-02",
    last_commit: "2026-11-10",
    merged_pull_requests: 37,
    other_contributors: 2,
  },
  scale: { releases: 9, continuous_integration: true, automated_tests: true },
  highlights: [{ text: "Caches tide tables for offline trips", source: "README.md" }],
  repository_url: "https://git.example.test/tidewater/tidewater",
  live_url: "https://tidewater.example.test",
};

const privateCard = {
  ...publicCard,
  name: "Harbour ledger",
  visibility: "private",
  repository_url: undefined,
  live_url: undefined,
};

function setup(publish?: WorkJournalPublish) {
  const store = createMemoryWorkJournalNoteStore();
  let sequence = 0;
  const journal = createWorkJournalService({
    store,
    tenantId: "tenant-1",
    now: () => "2026-11-17T10:00:00.000Z",
    newId: () => {
      sequence += 1;
      return `wjn_card${String(sequence).padStart(6, "0")}`;
    },
    ...(publish === undefined ? {} : { publish }),
  });
  return { journal, store };
}

function withoutUndefined(card: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(card).filter(([, value]) => value !== undefined));
}

describe("project cards", () => {
  it("lands pending and is not published until the candidate approves it", async () => {
    const publish = vi.fn<WorkJournalPublish>();
    const { journal, store } = setup(publish);
    await journal.setIntake("owner", true);
    const result = await journal.recordProject("owner", publicCard);
    expect(result.status).toBe("pending");
    const stored = await store.get("owner", result.note_id ?? "");
    expect(stored?.status).toBe("pending");
    expect(stored?.project_card?.contribution.own_commits).toBe(412);
    expect(stored?.content.links.map((link) => link.kind)).toEqual(["repository", "website"]);
    expect(publish).not.toHaveBeenCalled();
    expect((await journal.list("owner"))[0]?.kind).toBe("project");
  });

  it("refuses a card while the candidate has not turned intake on", async () => {
    const { journal } = setup();
    await expect(journal.recordProject("owner", publicCard)).rejects.toMatchObject({
      code: "not_consented",
    });
  });

  it("publishes an approved public card as a project source that carries its counted facts", async () => {
    const added: { bytes: Uint8Array; kind?: string }[] = [];
    const publisher = createWorkJournalPublisher({
      intake: {
        addFileSource: async ({ bytes, displayName }) => {
          added.push({ bytes });
          return {
            created: true,
            source: { id: "src-1", knowledgeBaseId: "kb-1", displayName },
            latestVersion: { id: "ver-1", mediaType: "text/markdown" },
          } as never;
        },
      },
      rules: { list: async () => ({ rules: [] }) as never, add: vi.fn() as never },
      setEvidenceKind: async (_base, _source, kind) => {
        if (added[0] !== undefined) added[0].kind = kind;
      },
    });
    const { journal } = setup(publisher);
    await journal.setIntake("owner", true);
    const { note_id: id } = await journal.recordProject("owner", publicCard);
    const approved = await journal.review("owner", id ?? "", {
      action: "approve",
      knowledge_base_id: "kb-1",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approval?.tier).toBe("normal");
    expect(added[0]?.kind).toBe("project");
    const markdown = new TextDecoder().decode(added[0]?.bytes);
    expect(markdown).toContain(`# Project: Tidewater: A command-line tool`);
    expect(markdown).toContain("- Own commits: 412 of 430 (96%)");
    expect(markdown).toContain("- Merged pull requests: 37");
    expect(markdown).toContain("- Caches tide tables for offline trips (source: README.md)");
    expect(markdown).toContain("- repository: <https://git.example.test/tidewater/tidewater>");
  });

  it("withholds a private card from the provider without the candidate's sensitive consent", async () => {
    const { journal, store } = setup();
    await journal.setIntake("owner", true);
    const { note_id: id } = await journal.recordProject("owner", withoutUndefined(privateCard));
    const note = await store.get("owner", id ?? "");
    if (note === undefined) throw new Error("card not stored");
    const markdown = renderWorkJournalMarkdown(note);
    const excluded = excludedSensitivityTiersForConsent(false);
    const sections = classifySourceSections(markdown, workJournalSourceRules(note, "sensitive"));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((section) => excluded.has(section.tier))).toBe(true);
  });

  it("refuses a private card that carries links", async () => {
    const { journal } = setup();
    await journal.setIntake("owner", true);
    await expect(
      journal.recordProject("owner", { ...publicCard, visibility: "private" }),
    ).rejects.toMatchObject({
      code: "private_card_with_links",
      fields: ["repository_url", "live_url"],
    });
  });

  it("refuses a card holding a secret pattern or a contributor's email", async () => {
    const { journal } = setup();
    await journal.setIntake("owner", true);
    await expect(
      journal.recordProject("owner", {
        ...publicCard,
        summary: `${publicCard.summary} Deploys with api_key=abcdef0123456789.`,
      }),
    ).rejects.toMatchObject({ code: "secret_like_content" });
    await expect(
      journal.recordProject("owner", {
        ...publicCard,
        highlights: [{ text: "Paired with a teammate on caching", source: "ana@example.test" }],
      }),
    ).rejects.toMatchObject({ code: "contributor_identity" });
  });

  it("refuses counts that do not add up", async () => {
    const { journal } = setup();
    await journal.setIntake("owner", true);
    await expect(
      journal.recordProject("owner", {
        ...publicCard,
        contribution: { ...publicCard.contribution, own_commits: 500 },
      }),
    ).rejects.toMatchObject({ code: "invalid_card", fields: ["contribution.own_commits"] });
  });

  it("never merges a card with a work note", async () => {
    const { journal } = setup();
    await journal.setIntake("owner", true);
    const card = await journal.recordProject("owner", publicCard);
    const note = await journal.record("owner", {
      title: "Offline cache for the Tidewater planner",
      summary:
        "Added an offline cache of tide tables so trips can be planned without a network connection.",
      period: { start: "2026-10-01" },
      project: { name: "Tidewater", visibility: "public" },
      technologies: ["TypeScript"],
      category: "feature",
      candidate_role: ["implemented"],
    });
    await expect(
      journal.review("owner", note.note_id ?? "", { action: "merge", into: card.note_id ?? "" }),
    ).rejects.toMatchObject({ code: "kinds_differ" });
  });
});
