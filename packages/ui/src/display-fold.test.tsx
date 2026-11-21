import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import { DisplayFold } from "./display-fold.js";
import { type DisplayMode, DisplayPreferenceProvider } from "./display-preference.js";
import { GettingStarted } from "./getting-started.js";
import type { GettingStartedInputs } from "./getting-started-model.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

function withMode(mode: DisplayMode | null, node: ReactNode, guideHidden = false) {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider value={{ preference: { mode, guideHidden }, choose: () => {} }}>
      {node}
    </DisplayPreferenceProvider>,
  );
}

const exported: ApplicationSummaryView = {
  id: "app-1",
  name: "Acme",
  jobSourceKind: "pasted-text",
  status: "exported",
  isDefault: false,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
  runCount: 1,
  briefCount: 0,
  exportCount: 1,
  latestRunId: "run-1",
  archivedAt: null,
  modelProfiles: null,
  nameChosen: true,
  suggestedName: null,
};

// A person who added evidence, reviewed the profile and made and downloaded a CV.
const onboarded: GettingStartedInputs = {
  evidence: {
    kind: "selected",
    storeId: "store-1",
    knowledgeBaseId: "kb-1",
    displayName: "Documents",
    sourceCount: 1,
    blockedCount: 0,
  },
  legacyEvidenceSourceCount: 0,
  profile: { kind: "reviewed", version: 1 },
  applications: { status: "ready", applications: [exported] },
};

const actions = {
  onManageEvidence: () => undefined,
  onManageProfile: () => undefined,
  onNewApplication: () => undefined,
  onOpenApplication: () => undefined,
};

describe("a folded section on the screens people use after onboarding", () => {
  const fold = (
    <DisplayFold className="claims-disclosure">
      <summary>Traceability</summary>
    </DisplayFold>
  );

  it("starts open with Show everything", () => {
    expect(withMode("everything", fold)).toBe(
      '<details class="claims-disclosure" open=""><summary>Traceability</summary></details>',
    );
  });

  it("stays folded on Simple and Guided", () => {
    for (const mode of ["standard", "guided", null] as const) {
      expect(withMode(mode, fold)).toBe(
        '<details class="claims-disclosure"><summary>Traceability</summary></details>',
      );
    }
  });
});

describe("Home once every Getting started step is done", () => {
  it("keeps a Guided line after the guide is hidden, so Guided never looks like Simple", () => {
    const guided = withMode(
      "guided",
      <GettingStarted inputs={onboarded} actions={actions} />,
      true,
    );
    expect(guided).toContain('<p class="screen-hint">');
    expect(guided).toContain("The CV is downloaded. Select New application for your next job.");
    expect(
      withMode("standard", <GettingStarted inputs={onboarded} actions={actions} />, true),
    ).toBe("");
    expect(withMode("everything", <GettingStarted inputs={onboarded} actions={actions} />)).toBe(
      "",
    );
  });
});

describe("the CV review of an approved draft", () => {
  const review = (
    <ReviewWorkspace
      state={{ ...createFixtureReviewState(), approval: "approved" }}
      onAction={() => undefined}
    />
  );

  it("opens Traceability and the approval Details with Show everything only", () => {
    const everything = withMode("everything", review);
    expect(everything).toContain('<details class="claims-disclosure" open="">');
    expect(everything).toMatch(/<details class="gate-details"[^>]* open=""/);
    const simple = withMode("standard", review);
    expect(simple).toContain('<details class="claims-disclosure">');
    expect(simple).not.toMatch(/<details class="gate-details"[^>]* open=""/);
  });

  it("still guides a Guided person toward the export", () => {
    expect(withMode("guided", review)).toContain("This CV is approved.");
    expect(withMode("standard", review)).not.toContain("This CV is approved.");
  });
});
