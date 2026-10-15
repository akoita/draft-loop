import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { approvalBlockerId } from "./approval-gate-focus.js";
import type { ApprovalReadiness, ApprovalReadinessBlocker } from "./approval-readiness.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  compactReadinessBlocker,
  footerBlocker,
  ReviewFooter,
  type ReviewFooterProps,
} from "./review-footer.js";
import { sendVerdict } from "./send-verdict.js";

const fixture = createFixtureReviewState();
// The fixture sits at its round limit; one round earlier a revision is still available.
const reviewed: DesktopReviewState = {
  ...fixture,
  state: "awaiting-approval",
  round: 1,
  findings: [],
};
const relevanceBlocker: ApprovalReadinessBlocker = {
  code: "unmet-rubric-threshold",
  dimension: "relevance",
  score: 0.22,
  threshold: 0.8,
};
const relevanceBlocked: ApprovalReadiness = {
  artifactId: fixture.artifact.id,
  artifactVersion: fixture.artifact.version,
  applicationReady: false,
  blockers: [relevanceBlocker],
};
const ready = { ready: true, headline: "Ready to send", reasons: [] } as const;

describe("footerBlocker", () => {
  it("says there is nothing to approve without a draft", () => {
    const state = { ...reviewed, artifact: { ...reviewed.artifact, version: 0 } };
    expect(footerBlocker(state, null, null)).toEqual({
      kind: "no-artifact",
      text: "No draft yet: approval opens once the author produces a valid draft",
      tone: "neutral",
    });
  });

  it("names the export path once the draft is exported", () => {
    const state: DesktopReviewState = {
      ...reviewed,
      state: "exported",
      approval: "approved",
      exportPath: "/tmp/cv.md",
    };
    expect(footerBlocker(state, null, null)).toEqual({
      kind: "exported",
      text: "Exported to /tmp/cv.md",
      tone: "safe",
    });
  });

  it("warns when an exported draft's export file can't be found", () => {
    const state: DesktopReviewState = {
      ...reviewed,
      state: "exported",
      approval: "approved",
      exportPath: null,
    };
    expect(footerBlocker(state, null, null)).toEqual({
      kind: "exported",
      text: "Exported · the previous export can't be found",
      tone: "warning",
    });
  });

  it("says an approved draft is ready to export, and says when it was approved past the checks", () => {
    const state: DesktopReviewState = { ...reviewed, state: "approved", approval: "approved" };
    expect(footerBlocker(state, null, null)).toMatchObject({
      kind: "approved",
      text: "Approved · ready to export",
    });
    expect(footerBlocker(state, { ...relevanceBlocked, overridden: true }, null).text).toBe(
      "Approved past the final CV checks with a recorded reason · ready to export",
    );
  });

  it("names the blocking findings that need a decision or a revision", () => {
    const pending = { ...reviewed, findings: fixture.findings };
    expect(footerBlocker(pending, null, null)).toEqual({
      kind: "findings",
      text: "1 blocking finding needs a decision",
      tone: "warning",
    });
    const accepted = {
      ...reviewed,
      findings: fixture.findings.map((finding) => ({ ...finding, decision: "accepted" as const })),
    };
    expect(footerBlocker(accepted, null, null).text).toBe(
      "1 accepted blocking finding needs a revision",
    );
    // At the round limit no revision can fix an accepted blocking finding.
    expect(footerBlocker({ ...accepted, round: 2 }, null, null).text).toBe(
      "1 blocking finding needs a decision · No revision left: use Reject or Override",
    );
  });

  it("states the failing final CV checks in one line", () => {
    expect(footerBlocker(reviewed, relevanceBlocked, null)).toEqual({
      kind: "final-checks",
      text: "Not ready: relevance 22% (80% needed)",
      tone: "warning",
    });
    expect(
      footerBlocker(
        { ...reviewed, round: 2 },
        { ...relevanceBlocked, blockers: [...relevanceBlocked.blockers, { code: "report-error" }] },
        null,
      ).text,
    ).toBe(
      "Not ready: relevance 22% (80% needed); a readiness report finding blocks application readiness · No revision left",
    );
  });

  it("follows the send verdict for a draft that can be approved", () => {
    expect(footerBlocker(reviewed, null, ready)).toEqual({
      kind: "ready",
      text: "Ready to send",
      tone: "safe",
    });
    const verdict = sendVerdict({
      blocking: [],
      warnings: fixture.findings
        .filter((finding) => finding.severity === "warning")
        .map((finding) => ({ ...finding, code: "editorial-fragment" })),
      readiness: null,
    });
    expect(footerBlocker(reviewed, null, verdict)).toEqual({
      kind: "ready",
      text: "Not ready to send yet: fragments (1)",
      tone: "warning",
    });
    expect(footerBlocker({ ...reviewed, round: 2 }, null, ready).text).toBe(
      "Ready to send · No revision left",
    );
  });

  it("says in plain words that the loop stopped on agreement or paused on a persisting finding", () => {
    const withReason = (stopReason: string, findings: DesktopReviewState["findings"]) => ({
      ...reviewed,
      findings,
      evaluation: { ...reviewed.evaluation, stopReason },
    });
    expect(footerBlocker(withReason("consensus-ready", []), null, ready)).toEqual({
      kind: "ready",
      text: "Stopped: author and critic agree it's ready",
      tone: "safe",
    });
    expect(footerBlocker(withReason("persisting-findings", fixture.findings), null, null)).toEqual({
      kind: "findings",
      text: "Paused: the same blocking finding persisted for two rounds — decide it to continue",
      tone: "warning",
    });
    // Once the reviewer has decided the finding, the usual line returns.
    const decided = fixture.findings.map((finding) => ({
      ...finding,
      decision: "accepted" as const,
    }));
    expect(footerBlocker(withReason("persisting-findings", decided), null, null).text).toBe(
      "1 accepted blocking finding needs a revision",
    );
  });

  it("explains the wait while the run cannot be approved yet", () => {
    expect(
      footerBlocker(
        {
          ...reviewed,
          state: "reviewing",
          execution: { ...reviewed.execution, status: "running" },
        },
        null,
        null,
      ),
    ).toMatchObject({ kind: "waiting", text: "Review in progress · nothing to do yet" });
    expect(footerBlocker({ ...reviewed, reviewComplete: false }, null, null)).toMatchObject({
      kind: "waiting",
      text: "Version 2 has not been critiqued yet: approval needs a finished critique",
    });
    expect(
      footerBlocker({ ...reviewed, round: 3, reviewComplete: false }, null, null),
    ).toMatchObject({
      kind: "waiting",
      text: "Round limit recovery required: return to reviewed Round 2",
    });
    expect(footerBlocker({ ...reviewed, state: "provider-error" }, null, ready)).toMatchObject({
      kind: "waiting",
      text: "Provider recovery remains before approval",
    });
  });

  it("shortens rubric blockers and lower-cases the others", () => {
    expect(compactReadinessBlocker(relevanceBlocker)).toBe("relevance 22% (80% needed)");
    expect(compactReadinessBlocker({ code: "disputed-dimension" })).toBe(
      "a readiness dimension remains disputed",
    );
  });
});

const noop = (): void => undefined;
function footerProps(overrides: Partial<ReviewFooterProps> = {}): ReviewFooterProps {
  return {
    blocker: {
      kind: "final-checks",
      text: "Not ready: relevance 22% (80% needed)",
      tone: "warning",
    },
    readOnly: false,
    errorMessage: null,
    statusLine: "Artifact: not approved · Export: not exported · Validation: Final CV checks",
    detail: <p>Final CV checks block approval.</p>,
    conditions: [
      { id: "draft", label: "Draft artifact produced", met: true },
      { id: "application-readiness", label: "Final CV checks passed", met: false },
    ],
    editNote: null,
    detailsOpen: false,
    onDetailsOpenChange: noop,
    recovery: null,
    approve: { disabled: true, onApprove: noop },
    override: null,
    revision: { disabled: false, onRequest: noop, direction: "", onDirectionChange: noop },
    exportAction: {
      disabled: true,
      pathLabel: "Available after approval",
      again: false,
      pendingSeconds: null,
      format: "markdown",
      onFormatChange: noop,
      note: null,
      onExport: noop,
    },
    ...overrides,
  };
}
const render = (overrides: Partial<ReviewFooterProps> = {}): string =>
  renderToStaticMarkup(<ReviewFooter {...footerProps(overrides)} />);
const override = {
  open: false,
  onOpenChange: noop,
  reason: "",
  onReasonChange: noop,
  disabled: false,
  onSubmit: noop,
};

describe("ReviewFooter", () => {
  it("states the blocker above the buttons as a focusable status line", () => {
    const html = render();
    expect(html).toContain(
      `<p id="${approvalBlockerId}" class="gate-blocker gate-blocker-warning" tabindex="-1" role="status">Not ready: relevance 22% (80% needed)</p>`,
    );
    expect(html.indexOf(approvalBlockerId)).toBeLessThan(html.indexOf("Approve artifact"));
    expect(html).toMatch(/title="Approve artifact \(Alt\+A\)" disabled=""/u);
    expect(html).not.toContain("Approve with override");
  });

  it("folds the checklist and the status line under Details", () => {
    const closed = render();
    expect(closed).toContain(
      '<details class="gate-details" id="approval-details"><summary>Details</summary>',
    );
    expect(closed).toContain("Artifact: not approved · Export: not exported");
    expect(closed).toContain('Final CV checks passed<span class="sr-only"> — not met</span>');
    expect(render({ detailsOpen: true })).toContain(
      '<details class="gate-details" id="approval-details" open="">',
    );
  });

  it("offers the override folded, and opens an inline reason field on request", () => {
    const folded = render({ override });
    expect(folded).toContain(
      '<button class="button button-outline" type="button" aria-expanded="false" aria-controls="approval-override-form">Approve with override…</button>',
    );
    expect(folded).not.toContain("Reason for approving anyway");

    const open = render({ override: { ...override, open: true } });
    expect(open).toContain('aria-expanded="true" aria-controls="approval-override-form"');
    expect(open).toContain('id="approval-override-form" aria-label="Approve past final CV checks"');
    expect(open).toContain("Reason for approving anyway (required)");
    expect(open).toContain('aria-label="Reason for approving past final CV checks"');
    expect(open).toMatch(/disabled="">Approve with override<\/button>/u);

    const reasoned = render({ override: { ...override, open: true, reason: "Checked by hand" } });
    expect(reasoned).toMatch(/type="button">Approve with override<\/button>/u);
  });

  it("shows the approved and exported states with the export path", () => {
    const approved = render({
      blocker: { kind: "approved", text: "Approved · ready to export", tone: "safe" },
      approve: { disabled: true, onApprove: noop },
      exportAction: {
        disabled: false,
        pathLabel: "Available now",
        again: false,
        pendingSeconds: null,
        format: "markdown",
        onFormatChange: noop,
        note: null,
        onExport: noop,
      },
    });
    expect(approved).toContain('class="gate-blocker gate-blocker-safe"');
    expect(approved).toContain(">Approved · ready to export</p>");
    expect(approved).toMatch(/title="Export as Markdown \(Alt\+E\)">Export…<kbd>/u);
    expect(approved).toContain('aria-label="Export format"');
    expect(approved).toContain('<option value="docx">DOCX</option>');
    expect(approved).toContain('<option value="pdf">PDF</option>');

    const exported = render({
      blocker: { kind: "exported", text: "Exported to /tmp/cv.md", tone: "safe" },
      exportAction: {
        disabled: false,
        pathLabel: "/tmp/cv.md",
        again: true,
        pendingSeconds: null,
        format: "markdown",
        onFormatChange: noop,
        note: null,
        onExport: noop,
      },
    });
    expect(exported).toContain(">Exported to /tmp/cv.md</p>");
    expect(exported).toContain('<span class="export-path" aria-live="polite">/tmp/cv.md</span>');
    expect(exported).toMatch(/title="Export as Markdown again \(Alt\+E\)">Export again…<kbd>/u);
  });

  it("names the chosen format and shows an estimated-length note after an export", () => {
    const html = render({
      exportAction: {
        disabled: false,
        pathLabel: "/tmp/cv.docx",
        again: true,
        pendingSeconds: null,
        format: "docx",
        onFormatChange: noop,
        note: "Estimated length is about 3 pages, over the 2-page target. This is an estimate.",
        onExport: noop,
      },
    });
    expect(html).toContain('<option value="docx" selected="">DOCX</option>');
    expect(html).toContain('title="Export as DOCX again (Alt+E)"');
    expect(html).toContain('<p class="export-note" role="status">Estimated length is about 3');
  });

  it("offers the round-limit repair and reports a pending export", () => {
    const html = render({
      blocker: { kind: "waiting", text: "Round limit recovery required", tone: "warning" },
      recovery: { round: 2, disabled: false, onRecover: noop },
      exportAction: {
        disabled: true,
        pathLabel: "Available now",
        again: false,
        pendingSeconds: 1,
        format: "markdown",
        onFormatChange: noop,
        note: null,
        onExport: noop,
      },
    });
    expect(html).toContain(">Return to reviewed Round 2</button>");
    expect(html).toContain("Exporting Markdown…</button>");
    expect(html).toContain("Exporting Markdown… Elapsed 1 second.");
  });

  it("keeps the blocker and Details but hides every action on a read-only run", () => {
    const html = render({ readOnly: true, override });
    expect(html).toContain('aria-label="approval actions" hidden="">');
    expect(html).toContain("Not ready: relevance 22% (80% needed)");
    expect(html).toContain("<summary>Details</summary>");
  });
});

describe("the review footer in the workspace", () => {
  it("replaces the separate gate panel", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={fixture} onAction={() => undefined} />,
    );
    expect(html).not.toContain("approval-panel");
    expect(html).not.toContain("Human approval gate");
    expect(html).toContain('<section class="gate-action-bar" aria-label="approval and export">');
    expect(html).toContain(
      ">1 blocking finding needs a decision · No revision left: use Reject or Override</p>",
    );
    expect(html).toContain("Resolve or override 1 blocking finding before approval.");
  });

  it("states final CV checks in the footer and offers the override there", () => {
    const state: DesktopReviewState = {
      ...reviewed,
      approvalReadiness: relevanceBlocked,
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
    expect(html).toContain(">Not ready: relevance 22% (80% needed)</p>");
    expect(html).toContain(">Approve with override…</button>");
  });

  it("sits below the side panel's scroll area, never over its tabs (#1253)", () => {
    const state: DesktopReviewState = {
      ...reviewed,
      approvalReadiness: relevanceBlocked,
      coverage: {
        instructionsVersion: null,
        summary: { judged: 2, satisfied: 1, notSatisfied: 1, invalid: 0, unanswered: 0 },
        assessments: [0, 1].map((index) => ({
          requirementId: `req-${index}`,
          requirementText: `Requirement ${index}`,
          status: index === 0 ? ("covered" as const) : ("uncovered" as const),
          basis: "judgement" as const,
          evidence: [],
          rationale: `Rationale ${index}.`,
        })),
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
    const aside = /<aside class="side-column">.*<\/aside>/su.exec(html)?.[0] ?? "";
    const footerAt = aside.indexOf('<section class="gate-action-bar"');
    const scrollArea = aside.slice(0, footerAt);
    const footer = aside.slice(footerAt);

    // The panel's content, tabs included, lives in its own scroll area; the footer is the
    // column's next child, so a taller footer shrinks that area instead of covering it.
    expect(scrollArea.startsWith('<aside class="side-column"><div class="side-scroll">')).toBe(
      true,
    );
    expect(scrollArea.endsWith("</div>")).toBe(true);
    expect(scrollArea).toContain('role="tablist"');
    expect(footer).not.toContain('role="tablist"');
    expect(footer.endsWith("</section></aside>")).toBe(true);
  });
});
