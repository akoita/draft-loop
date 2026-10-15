import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState, type ReviewFinding } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import { sendVerdict } from "./send-verdict.js";

const finding = (code: string, severity: "error" | "warning" = "warning"): ReviewFinding => ({
  id: `${code}-${Math.random()}`,
  code,
  category: "quality",
  severity,
  message: "quoted text",
  decision: "pending",
  agreement: "critic-only",
});

const notReady = {
  artifactId: "artifact-1",
  artifactVersion: 2,
  applicationReady: false,
  blockers: [
    { code: "unmet-rubric-threshold", dimension: "relevance", score: 0.37, threshold: 0.8 },
  ],
} as const;

describe("send verdict", () => {
  it("is ready when nothing blocks and no editorial warning is open", () => {
    expect(
      sendVerdict({ blocking: [], warnings: [finding("coverage-gap")], readiness: null }),
    ).toEqual({ ready: true, headline: "Ready to send", reasons: [] });
  });

  it("names blocking findings, final CV checks and editorial warnings in plain words", () => {
    const verdict = sendVerdict({
      blocking: [finding("unsupported-claim", "error")],
      warnings: [
        finding("editorial-source-note"),
        finding("editorial-source-note"),
        finding("editorial-missing-evidence"),
        finding("coverage-gap"),
      ],
      readiness: notReady,
    });

    expect(verdict).toEqual({
      ready: false,
      headline: "Not ready to send yet",
      reasons: [
        "1 blocking finding to resolve",
        "Relevance score 37%; 80% required",
        "copied source notes or narration (2)",
        "job-relevant evidence left out (1)",
      ],
    });
  });

  it("is not ready with editorial warnings alone", () => {
    expect(
      sendVerdict({
        blocking: [],
        warnings: [finding("editorial-fragment"), finding("editorial-negative-aside")],
        readiness: { ...notReady, applicationReady: true, blockers: [] },
      }),
    ).toMatchObject({ ready: false, reasons: ["fragments (1)", "negative asides (1)"] });
  });
});

describe("send verdict in the review", () => {
  const fixture = createFixtureReviewState();
  const reviewed = {
    ...fixture,
    state: "awaiting-approval",
    reviewComplete: true,
    approval: "pending",
    approvalReadiness: null,
    findings: [],
  } as const;

  it("says the reviewed draft is ready to send when nothing blocks", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={reviewed as never} onAction={() => undefined} />,
    );
    expect(html).toMatch(/class="gate-blocker gate-blocker-safe"[^>]*>Ready to send/u);
  });

  it("lists editorial warnings as reasons the draft is not ready", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{ ...reviewed, findings: [finding("editorial-source-note")] } as never}
        onAction={() => undefined}
      />,
    );
    expect(html).toMatch(
      /class="gate-blocker gate-blocker-warning"[^>]*>Not ready to send yet: copied source notes or narration \(1\)/u,
    );
  });
});
