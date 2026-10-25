import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createCapabilityPort,
  type OpportunityRecordResult,
  validateBridgeCommand,
} from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { briefDialogClosesAfter, OpportunityBriefReviewView } from "./opportunity-brief-review.js";
import {
  acknowledgeIssue,
  type BriefEditState,
  briefEditProblem,
  briefSourceLabel,
  buildBriefEditPatch,
  createBriefEditState,
  describeBriefSources,
  dropRequirement,
  editEmployer,
  editRequirementText,
  hasUnsavedBriefChanges,
  loadBrief,
  markReviewedDisabledReason,
  opportunityVersionConflictMessage,
  restoreRequirement,
  reviewBlockers,
  reviewBrief,
  saveBriefEdits,
  setRequirementPriority,
} from "./opportunity-brief-review-model.js";

function record(overrides: Partial<OpportunityRecordResult> = {}): OpportunityRecordResult {
  return {
    workspaceId: "workspace-1",
    briefId: "brief-abc",
    version: 1,
    priorVersion: null,
    status: "draft",
    createdAt: "2026-10-07T10:00:00.000Z",
    reviewedAt: null,
    checksum: "d".repeat(64),
    sources: [
      {
        id: "workspace-job-description",
        kind: "pasted-content",
        classification: "job-posting",
        status: "available",
        checksum: "a".repeat(64),
        capturedAt: "2026-10-07T10:00:00.000Z",
      },
    ],
    role: { value: "Platform engineer", sourceIds: ["workspace-job-description"] },
    employer: { value: "Acme", sourceIds: ["workspace-job-description"] },
    responsibilities: [
      { id: "resp-1", text: "Run the deploy pipeline", sourceIds: ["workspace-job-description"] },
    ],
    requirements: [
      {
        id: "req-1",
        text: "Five years of TypeScript",
        priority: "critical",
        sourceIds: ["workspace-job-description"],
      },
      {
        id: "req-2",
        text: "Experience with Postgres",
        priority: "medium",
        sourceIds: ["workspace-job-description"],
      },
    ],
    priorities: [],
    candidateInstructions: {
      tone: null,
      applicationGoal: null,
      forbiddenLanguage: [],
      focusAreas: [],
    },
    issues: [],
    ...overrides,
  };
}

function view(
  rec: OpportunityRecordResult | null,
  edit: BriefEditState | null,
  extra: Partial<Parameters<typeof OpportunityBriefReviewView>[0]> = {},
): string {
  return renderToStaticMarkup(
    <OpportunityBriefReviewView
      load="ready"
      record={rec}
      edit={edit}
      busy={null}
      onText={() => undefined}
      onPriority={() => undefined}
      onDrop={() => undefined}
      onRestore={() => undefined}
      onAcknowledge={() => undefined}
      onSave={() => undefined}
      onReview={() => undefined}
      onStartEdit={() => undefined}
      onCancelEdit={() => undefined}
      onClose={() => undefined}
      {...extra}
    />,
  );
}

const openIssue = {
  id: "issue-1",
  code: "partial-fetch",
  status: "open",
  severity: "warning",
  message: "The source was only partially processed.",
  sourceIds: ["workspace-job-description"],
} as const;

describe("listing a draft brief", () => {
  it("shows each requirement with its text, priority and source reference", () => {
    const rec = record();
    const html = view(rec, createBriefEditState(rec));
    expect(html).toContain("Draft v1");
    expect(html).toContain("Requirements (2)");
    expect(html).toContain("Five years of TypeScript");
    expect(html).toContain("<span>Source</span> Pasted job text");
    expect(html).toContain(">Critical<");
    expect(html).toContain("Responsibilities (1)");
    expect(html).toContain("Run the deploy pipeline");
    expect(html).toContain("Platform engineer");
    expect(html).toContain("Acme");
    expect(html).toContain("Save changes");
    expect(html).toContain("Mark reviewed");
  });

  it("explains what blocks review instead of failing at the host", () => {
    const rec = record({ role: null, issues: [openIssue] });
    expect(reviewBlockers(rec)).toEqual([
      "The brief has no role.",
      "Acknowledge or resolve the open issue first.",
    ]);
    const html = view(rec, createBriefEditState(rec));
    expect(html).toContain("The brief has no role.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/u);
    expect(html).toContain("The source was only partially processed.");
  });

  it("names the reason beside a disabled Mark reviewed", () => {
    const rec = record({ issues: [openIssue] });
    expect(markReviewedDisabledReason(rec, false)).toBe(
      "Acknowledge or resolve the open issue first.",
    );
    expect(markReviewedDisabledReason(record({ requirements: [] }), false)).toBe(
      "Keep at least one requirement.",
    );
    expect(markReviewedDisabledReason(record(), false)).toBeNull();
    expect(view(rec, createBriefEditState(rec))).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="brief-review-disabled-reason"[^>]*>Mark reviewed<\/button><p[^>]*id="brief-review-disabled-reason">Acknowledge or resolve the open issue first\.<\/p>/u,
    );
    const ready = view(record(), createBriefEditState(record()));
    expect(ready).not.toContain("brief-review-disabled-reason");
  });

  it("lets a brief whose job posting names no employer be reviewed", () => {
    const rec = record({ employer: null });
    expect(reviewBlockers(rec)).toEqual([]);
    expect(markReviewedDisabledReason(rec, false)).toBeNull();
    const html = view(rec, createBriefEditState(rec));
    expect(html).toContain("Not named in the job posting");
    expect(html).not.toContain("no employer");
    // The only input is the candidate's own entry; the app never fills the employer in.
    expect(html.match(/<input/gu)).toHaveLength(1);
    expect(html).toContain('value=""');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/u);
  });
});

/** The text a person sees: the markup with its tags and attributes removed. */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/gu, " ");
}

describe("source labels", () => {
  const source = record().sources[0];
  if (source === undefined) throw new Error("source expected");

  it("names each source by its kind, never by its id", () => {
    expect(briefSourceLabel({ ...source, kind: "local-file" })).toBe("Job posting");
    expect(briefSourceLabel({ ...source, kind: "approved-url" })).toBe("Job page");
    expect(briefSourceLabel({ ...source, kind: "pasted-content" })).toBe("Pasted job text");
    expect(briefSourceLabel({ ...source, classification: "social-announcement" })).toBe(
      "Social announcement",
    );
    expect(briefSourceLabel({ ...source, classification: "company-context" })).toBe(
      "Company context",
    );
    expect(
      briefSourceLabel({
        ...source,
        kind: "candidate-input",
        classification: "candidate-instruction",
      }),
    ).toBe("Your instructions");
    expect(briefSourceLabel(undefined)).toBe("Unlisted source");
  });

  it("lists distinct labels in citation order", () => {
    const sources = [
      { ...source, id: "page-1", kind: "approved-url" as const },
      { ...source, id: "page-2", kind: "approved-url" as const },
      {
        ...source,
        id: "about",
        kind: "approved-url" as const,
        classification: "company-context" as const,
      },
    ];
    expect(describeBriefSources(sources, ["page-1", "page-2", "about", "missing"])).toBe(
      "Job page, Company context, Unlisted source",
    );
  });

  it("renders no internal brief or source id in the dialog", () => {
    const rec = record({ issues: [openIssue] });
    for (const html of [view(rec, createBriefEditState(rec)), view(rec, null)]) {
      expect(html).not.toContain("brief-abc");
      expect(html).not.toContain("workspace-job-description");
      expect(visibleText(html)).not.toMatch(/brief-/u);
    }
  });
});

describe("job-text excerpts", () => {
  const excerpt = "Five years of TypeScript are required.";
  const withExcerpts = record({
    responsibilities: [
      {
        id: "resp-1",
        text: "Run the deploy pipeline",
        sourceIds: ["workspace-job-description"],
        excerpt: "You will run the deploy pipeline.",
      },
    ],
    requirements: [
      {
        id: "req-1",
        text: "Five years of TypeScript",
        priority: "critical",
        sourceIds: ["workspace-job-description"],
        excerpt,
      },
      {
        id: "req-2",
        text: "Experience with Postgres",
        priority: "medium",
        sourceIds: ["workspace-job-description"],
      },
    ],
  });

  it("shows the quotation beneath an entry that has one and nothing for an entry without", () => {
    const html = view(withExcerpts, createBriefEditState(withExcerpts));
    expect(html).toContain("From the job text");
    expect(html).toContain(`<blockquote class="brief-excerpt-quote">${excerpt}</blockquote>`);
    expect(html).toContain("You will run the deploy pipeline.");
    expect(html.match(/From the job text/gu)).toHaveLength(2);

    const plain = record();
    expect(view(plain, createBriefEditState(plain))).not.toContain("From the job text");
  });

  it("keeps the excerpt through a wording edit and a bridge round-trip", () => {
    const state = editRequirementText(
      createBriefEditState(withExcerpts),
      "req-1",
      "Five years of production TypeScript",
    );
    const patch = buildBriefEditPatch(withExcerpts, state);
    expect(patch.requirements?.[0]).toMatchObject({
      text: "Five years of production TypeScript",
      excerpt,
    });
    expect(patch.requirements?.[1]).not.toHaveProperty("excerpt");
    expect(
      validateBridgeCommand({
        type: "opportunity.edit",
        input: { workspaceId: "workspace-1", briefId: "brief-abc", expectedVersion: 1, patch },
      }),
    ).toMatchObject({ input: { patch: { requirements: [{ excerpt }, {}] } } });
  });
});

describe("job text read from the page's JobPosting data", () => {
  const fromJobPosting = record({
    sources: [
      {
        id: "workspace-job-description",
        kind: "approved-url",
        classification: "job-posting",
        status: "available",
        checksum: "a".repeat(64),
        capturedAt: "2026-10-07T10:00:00.000Z",
        textOrigin: "job-posting-json-ld",
      },
    ],
  });

  it("says so in the brief review, and says nothing for visible page text", () => {
    expect(view(fromJobPosting, null)).toContain("Read from the page&#x27;s job posting data.");
    const plain = record();
    expect(view(plain, null)).not.toContain("job posting data");
  });

  it("keeps the origin through the bridge result allowlist", async () => {
    const port = createCapabilityPort({
      capabilities: [...bridgeCapabilities],
      invoke: async () => ({ ok: true, value: fromJobPosting }) as never,
    });
    const result = await port.execute({
      type: "opportunity.get",
      input: { workspaceId: "workspace-1", briefId: "brief-abc" },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { sources: [{ textOrigin: "job-posting-json-ld" }] },
    });

    const unknown = createCapabilityPort({
      capabilities: [...bridgeCapabilities],
      invoke: async () =>
        ({
          ok: true,
          value: record({
            sources: [{ ...fromJobPosting.sources[0], textOrigin: "visible-page" } as never],
          }),
        }) as never,
    });
    expect(
      await unknown.execute({
        type: "opportunity.get",
        input: { workspaceId: "workspace-1", briefId: "brief-abc" },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("staging edits", () => {
  const rec = record();

  it("sends only the changed text, with the id and source references kept", () => {
    const state = editRequirementText(createBriefEditState(rec), "req-2", "  Postgres tuning  ");
    expect(hasUnsavedBriefChanges(rec, state)).toBe(true);
    expect(buildBriefEditPatch(rec, state)).toEqual({
      requirements: [
        {
          id: "req-1",
          text: "Five years of TypeScript",
          priority: "critical",
          sourceIds: ["workspace-job-description"],
        },
        {
          id: "req-2",
          text: "Postgres tuning",
          priority: "medium",
          sourceIds: ["workspace-job-description"],
        },
      ],
    });
  });

  it("changes a priority", () => {
    const state = setRequirementPriority(createBriefEditState(rec), "req-2", "high");
    expect(buildBriefEditPatch(rec, state).requirements?.[1]).toMatchObject({ priority: "high" });
  });

  it("drops and restores a requirement before saving", () => {
    const dropped = dropRequirement(createBriefEditState(rec), "req-1");
    expect(buildBriefEditPatch(rec, dropped).requirements?.map(({ id }) => id)).toEqual(["req-2"]);
    const html = view(rec, dropped);
    expect(html).toContain('data-dropped="true"');
    expect(html).toContain("Dropped");
    expect(html).toContain("Restore requirement 1");
    expect(html).toContain("Requirements (1)");

    const restored = restoreRequirement(dropped, "req-1");
    expect(hasUnsavedBriefChanges(rec, restored)).toBe(false);
    expect(buildBriefEditPatch(rec, restored)).toEqual({});
  });

  it("refuses to save an empty requirement", () => {
    const state = editRequirementText(createBriefEditState(rec), "req-1", "   ");
    expect(briefEditProblem(state)).toContain("cannot be empty");
    expect(view(rec, state)).toContain("cannot be empty");
    expect(briefEditProblem(dropRequirement(state, "req-1"))).toBeNull();
  });

  it("acknowledges an open issue through the issues patch", () => {
    const withIssue = record({ issues: [openIssue] });
    const state = acknowledgeIssue(createBriefEditState(withIssue), "issue-1");
    expect(buildBriefEditPatch(withIssue, state)).toEqual({
      issues: [{ ...openIssue, status: "acknowledged" }],
    });
  });

  it("builds a patch the bridge accepts (allowlist drift proof)", () => {
    const withIssue = record({ issues: [openIssue] });
    const state = acknowledgeIssue(
      setRequirementPriority(
        editRequirementText(createBriefEditState(withIssue), "req-1", "Rewritten"),
        "req-2",
        "low",
      ),
      "issue-1",
    );
    const patch = buildBriefEditPatch(withIssue, state);
    expect(
      validateBridgeCommand({
        type: "opportunity.edit",
        input: { workspaceId: "workspace-1", briefId: "brief-abc", expectedVersion: 1, patch },
      }),
    ).toMatchObject({
      type: "opportunity.edit",
      input: {
        patch: { requirements: [{ text: "Rewritten" }, { priority: "low" }], issues: [{}] },
      },
    });
  });
});

describe("saving, conflicts and review", () => {
  const rec = record();
  const next = record({ version: 2 });

  it("saves against the version the person read", async () => {
    const editOpportunity = vi.fn(async () => next);
    const state = editRequirementText(createBriefEditState(rec), "req-1", "Changed");
    await expect(saveBriefEdits({ editOpportunity }, rec, state)).resolves.toEqual({
      kind: "done",
      record: next,
    });
    expect(editOpportunity).toHaveBeenCalledWith({
      briefId: "brief-abc",
      expectedVersion: 1,
      patch: buildBriefEditPatch(rec, state),
    });
  });

  it("reports a version conflict distinctly from other failures", async () => {
    const state = editRequirementText(createBriefEditState(rec), "req-1", "Changed");
    await expect(
      saveBriefEdits(
        {
          editOpportunity: async () => {
            throw new Error(opportunityVersionConflictMessage);
          },
        },
        rec,
        state,
      ),
    ).resolves.toEqual({ kind: "conflict", message: opportunityVersionConflictMessage });
    await expect(
      saveBriefEdits(
        {
          editOpportunity: async () => {
            throw new Error("disk full");
          },
        },
        rec,
        state,
      ),
    ).resolves.toEqual({ kind: "failed", message: "disk full" });
    await expect(
      reviewBrief(
        {
          reviewOpportunity: async () => {
            throw new Error(opportunityVersionConflictMessage);
          },
        },
        rec,
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it("shows the conflict message in the dialog", () => {
    const html = view(rec, createBriefEditState(rec), {
      notice: { kind: "conflict", message: opportunityVersionConflictMessage },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("This brief changed since you opened it.");
  });

  it("marks the exact version read as reviewed", async () => {
    const reviewOpportunity = vi.fn(async () => record({ version: 2, status: "reviewed" }));
    await expect(reviewBrief({ reviewOpportunity }, rec)).resolves.toMatchObject({
      kind: "done",
      record: { status: "reviewed", version: 2 },
    });
    expect(reviewOpportunity).toHaveBeenCalledWith("brief-abc", 1);
  });

  it("loads the latest version and surfaces a load failure", async () => {
    const getOpportunity = vi.fn(async () => rec);
    await expect(loadBrief({ getOpportunity }, "brief-abc")).resolves.toEqual({
      kind: "done",
      record: rec,
    });
    await expect(
      loadBrief(
        {
          getOpportunity: async () => {
            throw new Error("not found");
          },
        },
        "brief-abc",
      ),
    ).resolves.toEqual({ kind: "failed", message: "not found" });
  });

  it("stays on the saved draft with Mark reviewed one click away", () => {
    const html = view(next, createBriefEditState(next), { savedVersion: 2 });
    expect(html).toContain("Draft v2");
    expect(html).toMatch(
      /<p class="setup-note" role="status" tabindex="-1">Saved as draft v2\. Mark it reviewed when it is ready\.<\/p>/u,
    );
    expect(html).toMatch(/<button[^>]*>Mark reviewed<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/u);
    expect(html).not.toContain("Discard changes");
    expect(visibleText(html)).not.toMatch(/brief-/u);
  });

  it("drops the saved note once the version changes or a new edit is staged", () => {
    expect(view(next, createBriefEditState(next), { savedVersion: 1 })).not.toContain(
      "Saved as draft",
    );
    const staged = editRequirementText(createBriefEditState(next), "req-1", "Changed again");
    expect(view(next, staged, { savedVersion: 2 })).not.toContain("Saved as draft");
    const reviewedNext = record({ version: 2, status: "reviewed" });
    expect(view(reviewedNext, null, { savedVersion: 2 })).not.toContain("Saved as draft");
  });

  it("disables Mark reviewed while there are unsaved changes", () => {
    const state = editRequirementText(createBriefEditState(rec), "req-1", "Changed");
    const html = view(rec, state);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/u);
    expect(html).toContain("Save them before marking the brief reviewed");
  });
});

describe("a reviewed version", () => {
  const reviewed = record({ version: 3, status: "reviewed", reviewedAt: "2026-10-07T11:00:00Z" });

  it("is read-only with an Edit action", () => {
    const html = view(reviewed, null);
    expect(html).toContain("Reviewed v3");
    expect(html).toContain("read-only");
    expect(html).toContain("Five years of TypeScript");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Mark reviewed");
    expect(html).not.toContain(">Drop<");
    expect(html).toMatch(/>Edit</u);
  });

  it("edits as a new draft successor without touching the reviewed version", () => {
    const html = view(reviewed, createBriefEditState(reviewed));
    expect(html).toContain("<textarea");
    expect(html).toContain("Save as new draft");
    expect(html).toContain("this reviewed version stays unchanged");
    expect(html).toContain("Cancel editing");
  });
});

describe("load states", () => {
  it("shows loading and a failed load with a retry", () => {
    expect(view(null, null, { load: "loading" })).toContain("Loading the brief");
    const failed = view(null, null, { load: "failed", loadMessage: "No such brief." });
    expect(failed).toContain("No such brief.");
    expect(failed).toContain("Try again");
  });
});

describe("an employer the candidate enters", () => {
  const unnamed = record({ employer: null });
  const entered = record({
    employer: { value: "Example Systems", sourceIds: ["entered-employer"] },
    sources: [
      ...record().sources,
      {
        id: "entered-employer",
        kind: "candidate-input",
        classification: "candidate-provided-fact",
        status: "available",
        checksum: "c".repeat(64),
        capturedAt: "2026-10-07T10:00:00.000Z",
      },
    ],
  });

  it("offers an Entered by you field only while the brief has no employer", () => {
    const html = view(unnamed, createBriefEditState(unnamed), { onEmployer: () => undefined });
    expect(html).toContain("Entered by you");
    expect(html).toContain('aria-label="Employer (entered by you)"');
    expect(html).toContain("never as something the job posting says");

    const named = record();
    expect(view(named, createBriefEditState(named))).not.toContain("Entered by you");
    expect(view(unnamed, null)).not.toContain('aria-label="Employer (entered by you)"');
    expect(view(unnamed, null)).toContain("Not named in the job posting");
  });

  it("saves the typed employer as a candidate-provided entry and nothing else", () => {
    const state = editEmployer(createBriefEditState(unnamed), "  Example Systems ");
    expect(hasUnsavedBriefChanges(unnamed, state)).toBe(true);
    const patch = buildBriefEditPatch(unnamed, state);
    expect(patch).toEqual({ candidateEmployer: "Example Systems" });
    expect(patch).not.toHaveProperty("employer");
    expect(
      validateBridgeCommand({
        type: "opportunity.edit",
        input: { workspaceId: "workspace-1", briefId: "brief-abc", expectedVersion: 1, patch },
      }),
    ).toMatchObject({ input: { patch: { candidateEmployer: "Example Systems" } } });
  });

  it("sends nothing for an empty entry, or when the brief already names an employer", () => {
    expect(hasUnsavedBriefChanges(unnamed, editEmployer(createBriefEditState(unnamed), "  "))).toBe(
      false,
    );
    const named = record();
    const typed = editEmployer(createBriefEditState(named), "Other");
    expect(buildBriefEditPatch(named, typed)).toEqual({});
  });

  it("shows Entered by you beside an employer the candidate entered, not the posting's", () => {
    const html = view(entered, null);
    expect(html).toContain("Example Systems");
    expect(html).toContain('<span class="brief-entered-tag">Entered by you</span>');
    expect(view(record(), null)).not.toContain("Entered by you");
    expect(briefSourceLabel(entered.sources[1])).toBe("Entered by you");
  });

  it("keeps the candidate-provided classification through the bridge result allowlist", async () => {
    const port = createCapabilityPort({
      capabilities: [...bridgeCapabilities],
      invoke: async () => ({ ok: true, value: entered }) as never,
    });
    const result = await port.execute({
      type: "opportunity.get",
      input: { workspaceId: "workspace-1", briefId: "brief-abc" },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { sources: [{}, { classification: "candidate-provided-fact" }] },
    });
  });
});

describe("the brief dialog after an operation", () => {
  it("closes once the brief is marked reviewed, and stays open after a save or a refusal", () => {
    const done = { kind: "done", record: {} as OpportunityRecordResult } as const;
    expect(briefDialogClosesAfter("reviewing", done)).toBe(true);
    expect(briefDialogClosesAfter("saving", done)).toBe(false);
    expect(
      briefDialogClosesAfter("reviewing", { kind: "conflict", message: "Newer version." }),
    ).toBe(false);
    expect(briefDialogClosesAfter("reviewing", { kind: "failed", message: "Not saved." })).toBe(
      false,
    );
  });
});
