import { describe, expect, it } from "vitest";
import {
  checkWorkJournalNoteContent,
  checkWorkJournalNoteInput,
  containsSecretLikeContent,
  isLikelyWorkJournalDuplicate,
  type WorkJournalNoteContent,
  type WorkJournalStoredNote,
  workJournalDedupeKey,
  workJournalNoteListItem,
  workJournalStoredNoteSchema,
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
  metrics: [
    {
      description: "Checkout errors fell from 4% to 0.5%",
      how_measured: "error rate on the payment dashboard over two weeks",
    },
  ],
} as const;

function parsed(input: unknown = note): WorkJournalNoteContent {
  const result = checkWorkJournalNoteContent(input);
  if (!result.ok) throw new Error(result.code);
  return result.note;
}

describe("work journal note contract", () => {
  it("parses a fixture note and defaults links and metrics", () => {
    const result = checkWorkJournalNoteInput({ ...note, dry_run: true, dedupe_key: "fernhill-42" });
    expect(result.ok).toBe(true);
    const minimal = checkWorkJournalNoteInput({ ...note, links: undefined, metrics: undefined });
    expect(minimal).toMatchObject({ ok: true, note: { links: [], metrics: [] } });
  });

  it.each([
    ["a provider key", { summary: `${note.summary} Key sk-ant-${"a".repeat(30)} used.` }],
    // Assembled at run time, so the repository's secret scanner does not flag the fixture.
    [
      "a private key block",
      { summary: `${note.summary}\n${["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ")}\nabc` },
    ],
    ["a GitHub token", { title: `Token ghp_${"A".repeat(36)}` }],
    [
      "a password connection string",
      { project: { ...note.project, repository: "postgres://app:hunter22@db.internal/app" } },
    ],
    [
      "a credential assignment",
      { metrics: [{ description: "password = s3cretvalue", how_measured: "n/a" }] },
    ],
  ])("refuses %s as secret_like_content without naming it", (_label, change) => {
    const result = checkWorkJournalNoteInput({ ...note, ...change });
    expect(result).toEqual({ ok: false, code: "secret_like_content", fields: [] });
  });

  it("refuses a link that is not https", () => {
    const result = checkWorkJournalNoteInput({
      ...note,
      links: [{ kind: "commit", url: "http://git.example.test/fernhill/bookings/commit/abc" }],
    });
    expect(result).toEqual({ ok: false, code: "link_not_https", fields: ["links.0.url"] });
  });

  it("refuses a metric without how_measured", () => {
    const result = checkWorkJournalNoteInput({
      ...note,
      metrics: [{ description: "Twice as fast" }],
    });
    expect(result).toEqual({
      ok: false,
      code: "metric_without_how_measured",
      fields: ["metrics.0.how_measured"],
    });
  });

  it.each([
    ["a short title", { title: "Fix" }],
    ["a short summary", { summary: "Too short." }],
    ["no technologies", { technologies: [] }],
    ["repeated technologies", { technologies: ["Stripe", "stripe"] }],
    ["an unknown category", { category: "heroics" }],
    ["an end before the start", { period: { start: "2026-10", end: "2026-09" } }],
    ["an unknown field", { secret_sauce: true }],
    ["eleven links", { links: Array.from({ length: 11 }, () => note.links[0]) }],
  ])("refuses %s as invalid_note", (_label, change) => {
    const result = checkWorkJournalNoteInput({ ...note, ...change });
    expect(result).toMatchObject({ ok: false, code: "invalid_note" });
  });

  it("never echoes refused text in a refusal", () => {
    const result = checkWorkJournalNoteInput({ ...note, title: "x" });
    expect(JSON.stringify(result)).not.toContain(note.summary);
  });

  it("detects credential-shaped strings anywhere in a value", () => {
    expect(containsSecretLikeContent({ a: [{ b: `AKIA${"A".repeat(16)}` }] })).toBe(true);
    expect(containsSecretLikeContent(note)).toBe(false);
  });
});

describe("work journal dedupe", () => {
  const input = { ...parsed(), dry_run: undefined };

  it("keys on the agent's key, else repository and first PR link, else project and title", () => {
    expect(workJournalDedupeKey({ ...input, dedupe_key: " Fernhill-42 " })).toBe("key:fernhill-42");
    expect(workJournalDedupeKey(input)).toBe(
      "pr:fernhill/bookings|https://git.example.test/fernhill/bookings/pull/42",
    );
    expect(workJournalDedupeKey({ ...input, links: [] })).toBe(
      "title:fernhill bookings|card payments for the fernhill booking site",
    );
  });

  it("marks the same project with overlapping periods and shared work as a likely duplicate", () => {
    const base = parsed();
    const sameLink = parsed({
      ...note,
      title: "Refunds through webhooks at Fernhill",
      technologies: ["Go"],
      period: { start: "2026-10" },
    });
    const sharedTech = parsed({
      ...note,
      links: [],
      technologies: ["stripe", "postgres", "Redis"],
    });
    const otherProject = parsed({ ...note, project: { name: "Elsewhere", visibility: "public" } });
    const later = parsed({ ...note, period: { start: "2027-01" } });
    const oneTech = parsed({ ...note, links: [], technologies: ["Stripe", "Redis"] });
    expect(isLikelyWorkJournalDuplicate(base, sameLink)).toBe(true);
    expect(isLikelyWorkJournalDuplicate(base, sharedTech)).toBe(true);
    expect(isLikelyWorkJournalDuplicate(base, otherProject)).toBe(false);
    expect(isLikelyWorkJournalDuplicate(base, later)).toBe(false);
    expect(isLikelyWorkJournalDuplicate(base, oneTech)).toBe(false);
  });
});

describe("stored work journal note", () => {
  it("projects to a list item without summary, links or metrics", () => {
    const stored: WorkJournalStoredNote = workJournalStoredNoteSchema.parse({
      id: "wjn_fixture0001",
      tenant_id: "tenant-1",
      workspace_id: "owner",
      status: "pending",
      content: parsed(),
      dedupe_key: "pr:x",
      screening: { verdict: "clear" },
      edit_count: 0,
      created_at: "2026-11-03T10:00:00.000Z",
      updated_at: "2026-11-03T10:00:00.000Z",
    });
    const item = workJournalNoteListItem(stored);
    expect(item).toMatchObject({ project: "Fernhill bookings", status: "pending" });
    expect(JSON.stringify(item)).not.toContain("hosted checkout");
    expect(JSON.stringify(item)).not.toContain("pull/42");
  });
});
