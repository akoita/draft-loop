import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { type OpportunityRecordResult, validateBridgeCommand } from "./bridge.js";
import { OpportunityBriefReviewView } from "./opportunity-brief-review.js";
import {
  acknowledgeIssue,
  type BriefEditState,
  briefEditProblem,
  buildBriefEditPatch,
  createBriefEditState,
  dropRequirement,
  editRequirementText,
  hasUnsavedBriefChanges,
  loadBrief,
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
    expect(html).toContain("Job posting (workspace-job-description)");
    expect(html).toContain(">Critical<");
    expect(html).toContain("Responsibilities (1)");
    expect(html).toContain("Run the deploy pipeline");
    expect(html).toContain("Platform engineer");
    expect(html).toContain("Acme");
    expect(html).toContain("Save changes");
    expect(html).toContain("Mark reviewed");
  });

  it("explains what blocks review instead of failing at the host", () => {
    const rec = record({ employer: null, issues: [openIssue] });
    expect(reviewBlockers(rec)).toEqual([
      "The brief has no employer.",
      "Acknowledge or resolve the open issue first.",
    ]);
    const html = view(rec, createBriefEditState(rec));
    expect(html).toContain("The brief has no employer.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/u);
    expect(html).toContain("The source was only partially processed.");
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
