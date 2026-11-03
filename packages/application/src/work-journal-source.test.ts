import { classifySourceSections } from "@draft-loop/domain/source-sensitivity";
import type { WorkJournalStoredNote } from "@draft-loop/schemas/work-journal";
import { describe, expect, it } from "vitest";

import type { AddedHostedKnowledgeSource } from "./hosted-knowledge-intake.js";
import {
  createWorkJournalPublisher,
  renderWorkJournalMarkdown,
  renderWorkJournalSource,
  workJournalSourceRules,
} from "./work-journal-source.js";

// Fictional project, repository and links only.
const note: WorkJournalStoredNote = {
  id: "wjn_fixture_0001",
  tenant_id: "tenant-1",
  workspace_id: "owner",
  status: "pending",
  content: {
    title: "Card payments for the *Fernhill* booking site",
    summary:
      "Added card payments to the booking flow.\n# Not a heading\nWebhooks handle paid and refunded bookings.",
    period: { start: "2026-10-12", end: "2026-10-30" },
    project: { name: "Fernhill bookings", visibility: "private", repository: "fernhill/bookings" },
    technologies: ["TypeScript", "Stripe"],
    category: "payments",
    candidate_role: ["designed", "implemented"],
    links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
    metrics: [{ description: "Checkout errors fell to 0.5%", how_measured: "payment dashboard" }],
  },
  dedupe_key: "pr:x",
  possible_duplicate_of: [],
  screening: { verdict: "clear", signals: [], screened_at: "2026-11-03T10:00:00.000Z" },
  edit_count: 0,
  created_at: "2026-11-03T10:00:00.000Z",
  updated_at: "2026-11-03T10:00:00.000Z",
};

describe("work journal source", () => {
  it("renders fixed headings, the PR link as a reference, and no heading from the agent's text", () => {
    const markdown = renderWorkJournalMarkdown(note);
    const headings = markdown.split("\n").filter((line) => line.startsWith("#"));
    expect(headings).toEqual([
      "# Work journal: Card payments for the Fernhill booking site (wjn_fixture_0001)",
      "## Summary",
      "## Technologies",
      "## Role",
      "## Period",
      "## Metrics",
      "## Project and links",
    ]);
    expect(markdown).toContain(
      "- pull-request: <https://git.example.test/fernhill/bookings/pull/42>",
    );
    expect(markdown).toContain("2026-10-12 to 2026-10-30");
  });

  it("renders the same bytes for the same note", () => {
    expect(renderWorkJournalSource(note).bytes).toEqual(renderWorkJournalSource({ ...note }).bytes);
  });

  it("withholds a private project's repository and links while the work stays usable", () => {
    const rules = workJournalSourceRules(note, "sensitive");
    const sections = classifySourceSections(renderWorkJournalMarkdown(note), rules);
    const links = sections.find((section) => section.headingPath.at(-1) === "Project and links");
    const summary = sections.find((section) => section.headingPath.at(-1) === "Summary");
    expect(links?.tier).toBe("never-share");
    expect(summary?.tier).toBe("sensitive");
    const markdown = renderWorkJournalMarkdown(note);
    const neverShare = sections
      .filter((section) => section.tier === "never-share")
      .map((section) => markdown.slice(section.start, section.end))
      .join("");
    expect(neverShare).toContain("fernhill/bookings");
    const shareable = sections
      .filter((section) => section.tier !== "never-share")
      .map((section) => markdown.slice(section.start, section.end))
      .join("");
    expect(shareable).not.toContain("fernhill/bookings");
  });

  it("adds no rule for a public project at the normal tier", () => {
    const publicNote = {
      ...note,
      content: { ...note.content, project: { name: "Open kit", visibility: "public" as const } },
    };
    expect(workJournalSourceRules(publicNote, "normal")).toEqual([]);
  });

  it("publishes rules, the source and its kind once, and finds it already present after", async () => {
    const rules: { id: string }[] = [];
    const kinds: string[] = [];
    const screened: string[] = [];
    const sources = new Map<string, AddedHostedKnowledgeSource>();
    const publish = createWorkJournalPublisher({
      rules: {
        list: async (knowledgeBaseId) =>
          ({
            knowledgeBaseId,
            version: rules.length,
            checksum: null,
            createdAt: null,
            rules,
          }) as never,
        add: async (_knowledgeBaseId, _rule, id) => {
          rules.push({ id: id ?? "" });
          return {} as never;
        },
      },
      intake: {
        addFileSource: async ({ knowledgeBaseId, bytes, displayName, mediaType }) => {
          const key = new TextDecoder().decode(bytes);
          const existing = sources.get(key);
          if (existing !== undefined) return { ...existing, created: false };
          const added = {
            source: { id: `source-${sources.size + 1}`, knowledgeBaseId, displayName },
            latestVersion: { id: "version-1", mediaType },
            created: true,
          } as unknown as AddedHostedKnowledgeSource;
          sources.set(key, added);
          return added;
        },
      },
      setEvidenceKind: async (_knowledgeBaseId, sourceId, kind) => {
        kinds.push(`${sourceId}:${kind}`);
      },
      screen: async (added) => {
        screened.push(added.source.id);
      },
    });
    const input = {
      workspaceId: "owner",
      note,
      knowledgeBaseId: "kb-1",
      tier: "sensitive" as const,
    };
    await expect(publish(input)).resolves.toEqual({ sourceId: "source-1", status: "created" });
    await expect(publish(input)).resolves.toEqual({
      sourceId: "source-1",
      status: "already-present",
    });
    expect(rules.map((rule) => rule.id)).toEqual([
      "wj-wjn_fixture_0001",
      "wj-wjn_fixture_0001-links",
    ]);
    expect(kinds).toEqual(["source-1:work-journal"]);
    expect(screened).toEqual(["source-1"]);
  });
});
