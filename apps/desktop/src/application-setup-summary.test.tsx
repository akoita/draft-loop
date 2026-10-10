import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApplicationSetupSummaryView,
  type ApplicationSetupSummaryViewProps,
} from "./application-setup-summary.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();

function summaryProps(
  overrides: Partial<ApplicationSetupSummaryViewProps> = {},
): ApplicationSetupSummaryViewProps {
  return {
    evidence: {
      kind: "selected",
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      displayName: "Main career evidence",
      sourceCount: 4,
      blockedCount: 0,
      semanticLine: null,
    },
    legacyEvidenceSourceCount: 0,
    reviewed: {
      status: "ready",
      choices: [
        { profileId: "fx11", version: 3, reviewedAt: "2026-10-09T11:00:00Z" },
        { profileId: "fx11", version: 2, reviewedAt: "2026-10-01T11:00:00Z" },
      ],
    },
    selectedProfile: { profileId: "fx11", version: 3 },
    author: fixture.providerTransmissionPreflight.author,
    critic: fixture.providerTransmissionPreflight.critic,
    writingPolicyStatus: "active",
    writingPolicyVersion: "sha256:0949b3e22cfe",
    disabled: false,
    onSelectProfile: () => undefined,
    onManageEvidence: () => undefined,
    onManageProfile: () => undefined,
    onOpenSettings: () => undefined,
    ...overrides,
  };
}

function collectingState() {
  return {
    ...fixture,
    state: "collecting" as const,
    runId: "pending",
    setup: {
      ...fixture.setup,
      fixtureMode: false,
      jobDescriptionReady: true,
      writingPolicyStatus: "active" as const,
      writingPolicy: null,
      ready: true,
      nextSteps: [],
    },
    providerTransmissionPreflight: {
      ...fixture.providerTransmissionPreflight,
      required: true,
      acknowledged: false,
      acknowledgedAt: null,
    },
  };
}

describe("ApplicationSetupSummaryView", () => {
  it("names the application's own model pair when it has one", () => {
    const html = renderToStaticMarkup(
      <ApplicationSetupSummaryView
        {...summaryProps({
          applicationPair: {
            author: { id: "standard-anthropic-author", version: 1 },
            critic: { id: "standard-openai-critic", version: 2 },
          },
        })}
      />,
    );

    expect(html).toContain(
      `This application: Writer ${fixture.providerTransmissionPreflight.author.model}`,
    );
    expect(html).toContain("Preset Standard, chosen for this application.");
    expect(renderToStaticMarkup(<ApplicationSetupSummaryView {...summaryProps()} />)).not.toContain(
      "This application:",
    );
  });

  it("shows each workspace input as one card that opens its own screen", () => {
    const html = renderToStaticMarkup(<ApplicationSetupSummaryView {...summaryProps()} />);

    expect(html).toContain("Career evidence");
    expect(html).toContain("Open Career evidence");
    expect(html).toContain("Using fx11 · version 3 · reviewed 2026-10-09");
    expect(html).toContain("Open Career profile");
    expect(html).toContain("Reviewed version");
    expect(html).toContain(`Writer ${fixture.providerTransmissionPreflight.author.model}`);
    expect(html).toContain("Writing policy sha256:0949b3e22cfe is active.");
    expect(html).toContain("Open Home settings");
    // No full controls from the dedicated screens.
    expect(html).not.toContain("Add file");
    expect(html).not.toContain("Replace policy");
    expect(html).not.toContain("Facts by category");
  });

  it("asks for a reviewed profile when none exists", () => {
    const html = renderToStaticMarkup(
      <ApplicationSetupSummaryView
        {...summaryProps({ reviewed: { status: "ready", choices: [] }, selectedProfile: null })}
      />,
    );

    expect(html).toContain("Required");
    expect(html).toContain("No reviewed career profile yet.");
    expect(html).not.toContain("Reviewed version");
  });

  it("says when the writing policy cannot be read", () => {
    const html = renderToStaticMarkup(
      <ApplicationSetupSummaryView {...summaryProps({ writingPolicyStatus: "unavailable" })} />,
    );

    expect(html).toContain("Writing policy needs attention");
  });
});

describe("ReviewWorkspace with setup summary", () => {
  it("keeps only what starting a review needs", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collectingState()}
        onAction={() => undefined}
        onSelectFiles={() => undefined}
        onAddUrl={() => undefined}
        profilePanel={<div>FULL PROFILE PANEL</div>}
        setupSummary={<div>SETUP SUMMARY</div>}
      />,
    );

    expect(html).toContain("Start the review");
    expect(html).toContain("Job and requirements");
    expect(html).toContain("SETUP SUMMARY");
    expect(html).not.toContain("FULL PROFILE PANEL");
    // Workspace-level writing policy controls live on Home.
    expect(html).not.toContain("Replace policy");
    expect(html).not.toContain("Provider sign-in is in Home");
    // The job can still be replaced, behind a disclosure.
    expect(html).toContain("<summary>Replace the job description</summary>");
    // The data-sent detail is folded; the acknowledgement needed to start stays visible.
    expect(html).toContain("<summary>See exactly what is sent</summary>");
    expect(html).toContain("Acknowledge provider transmission");
    expect(html).toContain("Advanced: writing policy override for this job");
    expect(html).toContain("Start author–critic review");
  });

  it("keeps the full setup when no summary is given", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collectingState()}
        onAction={() => undefined}
        profilePanel={<div>FULL PROFILE PANEL</div>}
      />,
    );

    expect(html).toContain("Bring your career evidence into the loop");
    expect(html).toContain("FULL PROFILE PANEL");
    expect(html).toContain("Replace policy");
    expect(html).not.toContain("See exactly what is sent");
  });
});
