import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ApplicationProfileChoice,
  ApplicationSetupSummaryView,
  type ApplicationSetupSummaryViewProps,
  WorkspaceSettingsLinks,
} from "./application-setup-summary.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { readonly children?: ReactNode };
    return [child, ...elements(props.children)];
  });
}

function buttons(node: ReactNode): ReactElement[] {
  return elements(node).filter((element) => element.type === "button");
}

function textOf(element: ReactElement): string {
  const children = (element.props as { readonly children?: ReactNode }).children;
  return Children.toArray(children)
    .filter((child) => typeof child === "string")
    .join("");
}

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
    writingPolicyStatus: "active",
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

    expect(html).toContain("This application uses Preset Standard.");
    expect(renderToStaticMarkup(<ApplicationSetupSummaryView {...summaryProps()} />)).not.toContain(
      "This application uses",
    );
  });

  it("shows the reviewed profile, then one line per workspace setting", () => {
    const html = renderToStaticMarkup(<ApplicationSetupSummaryView {...summaryProps()} />);

    expect(html).toContain("Using fx11 · version 3 · reviewed 2026-10-09");
    expect(html).toContain("Reviewed version");
    expect(html).toContain("Update in Career profile");
    expect(html).toContain("Career evidence: Main career evidence · 4 sources");
    expect(html).toContain(">Manage</button>");
    expect(html).toContain("Models, writing policy and sign-in are set on Home");
    expect(html).toContain(">Open Home</button>");
    // No summary cards and no full controls from the dedicated screens.
    expect(html).not.toContain("home-card");
    expect(html).not.toContain("Add file");
    expect(html).not.toContain("Replace policy");
    expect(html).not.toContain("Facts by category");
    // At most one primary action in the profile step.
    expect(html).not.toContain("button-primary");
  });

  it("opens each page from its own link", () => {
    const calls: string[] = [];
    const props = summaryProps({
      onManageEvidence: () => calls.push("evidence"),
      onManageProfile: () => calls.push("profile"),
      onOpenSettings: () => calls.push("home"),
    });
    const click = (node: ReactNode, label: string) => {
      const button = buttons(node).find((element) => textOf(element) === label);
      if (button === undefined) throw new Error(`No button: ${label}`);
      (button.props as { readonly onClick: () => void }).onClick();
    };
    click(ApplicationProfileChoice(props), "Update in Career profile");
    click(WorkspaceSettingsLinks(props), "Manage");
    click(WorkspaceSettingsLinks(props), "Open Home");
    expect(calls).toEqual(["profile", "evidence", "home"]);
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
    expect(html).toContain("Job &amp; requirements");
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
    expect(html).toContain("Start review · review the data sent first");
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
