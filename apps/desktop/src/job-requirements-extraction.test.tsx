import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { type OpportunityCreateInput, validateBridgeCommand } from "./bridge.js";
import {
  JobRequirementsExtractionView,
  type JobRequirementsPhase,
  runJobRequirementsExtraction,
  summarizeJobRequirements,
} from "./job-requirements-extraction.js";

const writingModel = { company: "anthropic", model: "claude-opus-4-5" } as const;

function record(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-1",
    briefId: "brief-abc",
    version: 1,
    priorVersion: null,
    status: "draft",
    createdAt: "2026-10-07T10:00:00.000Z",
    reviewedAt: null,
    checksum: "d".repeat(64),
    sources: [],
    role: null,
    employer: null,
    responsibilities: [{ id: "r1" }, { id: "r2" }],
    requirements: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    priorities: [],
    candidateInstructions: {},
    issues: [
      {
        id: "i1",
        code: "partial-fetch",
        status: "open",
        severity: "warning",
        message: "The source was only partially processed.",
        sourceIds: ["workspace-job-description"],
      },
      {
        id: "i2",
        code: "stale-source",
        status: "resolved",
        severity: "warning",
        message: "Resolved already.",
        sourceIds: [],
      },
    ],
    ...overrides,
  } as never;
}

function render(phase: JobRequirementsPhase, disabled = false): string {
  return renderToStaticMarkup(
    <JobRequirementsExtractionView
      phase={phase}
      writingModel={writingModel}
      disabled={disabled}
      onOpen={() => undefined}
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

describe("Extract requirements card states", () => {
  it("offers the action without sending anything", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain(">Extract requirements<");
    expect(html).not.toContain("Send the job description");
  });

  it("disables the action while another workspace operation is running", () => {
    expect(render({ kind: "idle" }, true)).toMatch(
      /<button[^>]*disabled=""[^>]*>Extract requirements/u,
    );
  });

  it("asks for consent naming the writing model and the exact scope", () => {
    const html = render({ kind: "consent" });
    expect(html).toContain("Send the job description to the writing model?");
    expect(html).toContain("anthropic/claude-opus-4-5");
    expect(html).toContain("Only the job description is sent");
    expect(html).toContain("career evidence is not sent");
    expect(html).toContain("Nothing is sent until you choose Extract");
    expect(html).toContain(">Extract<");
    expect(html).toContain(">Cancel<");
  });

  it("shows progress and says extraction cannot be cancelled once started", () => {
    const html = render({ kind: "running" });
    expect(html).toContain("Extracting requirements…");
    expect(html).toContain("cannot be cancelled");
    expect(html).not.toContain(">Cancel<");
  });

  it("summarizes the draft brief with counts and open issues only", () => {
    const summary = summarizeJobRequirements(record());
    expect(summary).toMatchObject({
      briefId: "brief-abc",
      version: 1,
      status: "draft",
      requirementCount: 3,
      responsibilityCount: 2,
    });
    expect(summary.issues.map((issue) => issue.id)).toEqual(["i1"]);
    const html = render({ kind: "done", summary });
    expect(html).toContain("Draft brief saved");
    expect(html).toContain("brief-abc");
    expect(html).toContain("3 requirements");
    expect(html).toContain("2 responsibilities");
    expect(html).toContain("The source was only partially processed.");
    expect(html).not.toContain("Resolved already.");
  });

  it("shows a failure with a retry action", () => {
    const html = render({
      kind: "failed",
      message: "The job description is larger than the limit.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The job description is larger than the limit.");
    expect(html).toContain(">Try again<");
  });
});

describe("runJobRequirementsExtraction", () => {
  it("sends only the workspace job description source with approval, and no path", async () => {
    const createOpportunity = vi.fn(async (_input: Omit<OpportunityCreateInput, "workspaceId">) =>
      record(),
    );
    const outcome = await runJobRequirementsExtraction(createOpportunity);
    expect(outcome).toMatchObject({ kind: "done", summary: { briefId: "brief-abc" } });
    expect(createOpportunity).toHaveBeenCalledTimes(1);
    expect(createOpportunity.mock.calls[0]?.[0]).toEqual({
      sources: [
        {
          id: "workspace-job-description",
          kind: "workspace-job-description",
          classification: "job-posting",
        },
      ],
      providerTransmissionApproved: true,
    });
  });

  it("reports the failure message the host gave", async () => {
    const outcome = await runJobRequirementsExtraction(async () => {
      throw new Error("The job description is larger than the 64 KiB extraction limit.");
    });
    expect(outcome).toEqual({
      kind: "failed",
      message: "The job description is larger than the 64 KiB extraction limit.",
    });
  });

  it("falls back to a fixed sentence when the failure has no message", async () => {
    const outcome = await runJobRequirementsExtraction(async () => {
      throw "boom";
    });
    expect(outcome).toEqual({
      kind: "failed",
      message: "Requirements could not be extracted. Nothing was saved.",
    });
  });
});

describe("workspace-job-description bridge drift", () => {
  it("accepts the exact payload the renderer sends", async () => {
    const createOpportunity = vi.fn(async (_input: Omit<OpportunityCreateInput, "workspaceId">) =>
      record(),
    );
    await runJobRequirementsExtraction(createOpportunity);
    const sent = createOpportunity.mock.calls[0]?.[0];
    const command = validateBridgeCommand({
      type: "opportunity.create",
      input: { workspaceId: "workspace-1", ...sent },
    });
    expect(command).toEqual({
      type: "opportunity.create",
      input: {
        workspaceId: "workspace-1",
        providerTransmissionApproved: true,
        sources: [
          {
            id: "workspace-job-description",
            kind: "workspace-job-description",
            classification: "job-posting",
          },
        ],
      },
    });
  });

  it("stays strict: no path, no other classification, no extra keys", () => {
    const base = { id: "job", kind: "workspace-job-description", classification: "job-posting" };
    for (const source of [
      { ...base, path: "/private/job.md" },
      { ...base, classification: "company-context" },
      { ...base, content: "inline" },
      { ...base, selection: "native-dialog" },
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "opportunity.create",
          input: { workspaceId: "workspace-1", sources: [source] },
        }),
      ).toThrow("invalid");
    }
  });
});
