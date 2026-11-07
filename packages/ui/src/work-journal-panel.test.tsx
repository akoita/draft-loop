import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type WorkJournalReviewNote,
  workJournalEditDraft,
  workJournalEditedContent,
  workJournalPeriod,
  workJournalProvenance,
  workJournalRefusal,
  workJournalReviewItems,
  workJournalScreening,
} from "./work-journal-model.js";
import { WorkJournalPanel, type WorkJournalPanelProps } from "./work-journal-panel.js";

// Fictional projects and links only.
function note(id: string, overrides: Partial<WorkJournalReviewNote> = {}): WorkJournalReviewNote {
  return {
    id,
    status: "pending",
    content: {
      title: "Card payments for the Fernhill booking site",
      summary: "Added card payments to the booking flow with a hosted checkout page.",
      period: { start: "2026-10-12", end: "2026-10-30" },
      project: { name: "Fernhill bookings", visibility: "private" },
      technologies: ["TypeScript", "Stripe"],
      category: "payments",
      candidate_role: ["implemented"],
      links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
      metrics: [],
    },
    possible_duplicate_of: [],
    screening: { verdict: "clear" },
    created_at: "2026-11-03T10:00:00.000Z",
    ...overrides,
  };
}

const props: WorkJournalPanelProps = {
  intake: true,
  notes: [],
  knowledgeBases: [{ id: "kb-1", name: "Career evidence" }],
  onSetIntake: async () => undefined,
  onReview: async () => undefined,
};

describe("work journal view model", () => {
  it("lists pending notes newest first with their pending duplicates, merge suggested", () => {
    const items = workJournalReviewItems([
      note("wjn_a", { created_at: "2026-11-03T09:00:00.000Z" }),
      note("wjn_b", { possible_duplicate_of: ["wjn_a", "wjn_gone"] }),
      note("wjn_c", { status: "approved" }),
    ]);
    expect(items.map((item) => item.note.id)).toEqual(["wjn_b", "wjn_a"]);
    expect(items[0]?.duplicates.map((duplicate) => duplicate.id)).toEqual(["wjn_a"]);
    expect(items[0]?.suggested).toBe("merge");
    expect(items[1]?.suggested).toBe("approve");
  });

  it("reads periods and screening in words, and holds what screening flagged", () => {
    expect(workJournalPeriod({ start: "2026-10" })).toBe("2026-10");
    expect(workJournalPeriod({ start: "2026-10-12", end: "2026-10-30" })).toBe(
      "2026-10-12 to 2026-10-30",
    );
    expect(workJournalScreening({ verdict: "clear" }).held).toBe(false);
    expect(workJournalScreening({ verdict: "flagged" })).toMatchObject({
      label: "Quarantined: flagged",
      held: true,
    });
    expect(workJournalScreening({ verdict: "unscreened" }).held).toBe(true);
  });

  it("turns the edit form into content and refuses an empty field before sending", () => {
    const { content } = note("wjn_a");
    const draft = workJournalEditDraft(content);
    expect(
      workJournalEditedContent(content, {
        ...draft,
        technologies: "TypeScript, Stripe, , TypeScript, Postgres",
        visibility: "public",
      }),
    ).toEqual({
      content: {
        ...content,
        technologies: ["TypeScript", "Stripe", "Postgres"],
        project: { name: "Fernhill bookings", visibility: "public" },
      },
    });
    expect(workJournalEditedContent(content, { ...draft, technologies: " , " })).toEqual({
      problem: "Name at least one technology.",
    });
    expect(workJournalEditedContent(content, { ...draft, roles: [] })).toEqual({
      problem: "Choose what the candidate did.",
    });
  });

  it("explains a quarantine refusal and passes other messages through", () => {
    expect(workJournalRefusal("note_quarantined", "x")).toContain("cannot be approved");
    expect(workJournalRefusal("something_else", "The server said no.")).toBe("The server said no.");
  });
});

describe("work journal panel", () => {
  it("shows the consent switch and an empty list", () => {
    const html = renderToStaticMarkup(<WorkJournalPanel {...props} />);
    expect(html).toContain("Accept notes from agents");
    expect(html).toMatch(/type="checkbox" checked=""/u);
    expect(html).toContain("No notes wait for review.");
  });

  it("shows a pending note's details and approves into the first knowledge base by default", () => {
    const html = renderToStaticMarkup(<WorkJournalPanel {...props} notes={[note("wjn_a")]} />);
    expect(html).toContain("Card payments for the Fernhill booking site");
    expect(html).toContain("2026-10-12 to 2026-10-30 · Fernhill bookings (private)");
    expect(html).toContain("TypeScript, Stripe · Implemented");
    expect(html).toContain("https://git.example.test/fernhill/bookings/pull/42");
    expect(html).toContain("Screened: clear");
    expect(html).toContain("Approve as career evidence");
    expect(html).toContain('<option value="kb-1" selected="">Career evidence</option>');
  });

  it("puts a likely duplicate side by side with Merge preselected", () => {
    const html = renderToStaticMarkup(
      <WorkJournalPanel
        {...props}
        notes={[
          note("wjn_a", { created_at: "2026-11-03T09:00:00.000Z" }),
          note("wjn_b", { possible_duplicate_of: ["wjn_a"] }),
        ]}
      />,
    );
    expect(html).toContain("Likely the same work:");
    expect(html).toMatch(/checked="" value="merge"/u);
    expect(html).toContain("Merge the notes");
  });

  it("never offers Approve for a quarantined note", () => {
    const html = renderToStaticMarkup(
      <WorkJournalPanel
        {...props}
        notes={[note("wjn_a", { screening: { verdict: "flagged" } })]}
      />,
    );
    expect(html).toContain("Quarantined: flagged");
    expect(html).toContain("Screening held this note back.");
    expect(html).not.toContain('value="approve"');
    expect(html).toMatch(/checked="" value="edit"/u);
  });
});

describe("work journal provenance", () => {
  const base = {
    id: "wjn_fixture0001",
    status: "pending",
    possible_duplicate_of: [],
    screening: { verdict: "clear" },
    created_at: "2026-11-03T10:00:00.000Z",
  } as unknown as Parameters<typeof workJournalProvenance>[0];

  it("names the filing and amending agent tokens, and nothing for an owner's note", () => {
    expect(workJournalProvenance(base)).toBeNull();
    expect(workJournalProvenance({ ...base, agent_token_id: "dlat_fixtureAAAA" })).toBe(
      "Filed by agent token dlat_fixtureAAAA.",
    );
    expect(
      workJournalProvenance({
        ...base,
        agent_token_id: "dlat_fixtureAAAA",
        amended_by_agent_token_ids: ["dlat_fixtureAAAA", "dlat_fixtureBBBB"],
      }),
    ).toBe("Filed by agent token dlat_fixtureAAAA; amended by dlat_fixtureBBBB.");
  });
});
