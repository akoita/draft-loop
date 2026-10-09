import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CareerEvidenceCard } from "./career-evidence-card.js";
import {
  type CareerFlowStep,
  CareerFlowStrip,
  careerEvidenceCardSubtitle,
  careerEvidenceIntro,
  careerProfileCardSubtitle,
  careerProfileIntro,
} from "./career-flow.js";
import { CareerEvidencePage, CareerProfilePage } from "./career-pages.js";
import { HomeView, WorkspaceLocation } from "./home.js";
import { KnowledgeWorkspace } from "./knowledge.js";
import { createFixtureReviewState } from "./model.js";
import { ProfileWorkspace } from "./profile.js";
import { ReviewWorkspace } from "./review.js";
import { SemanticRetrievalPanel } from "./semantic-retrieval.js";

const noop = () => undefined;

const knowledge = (
  <KnowledgeWorkspace
    workspaceId="workspace-1"
    capabilities={{}}
    disabled={false}
    onPendingChange={noop}
    onSelectionSaved={async () => true}
  />
);
const retrieval = (
  <SemanticRetrievalPanel workspaceId="workspace-1" capabilities={{}} disabled={false} />
);
const workflow = (
  <ProfileWorkspace
    workspaceId="workspace-1"
    capabilities={{
      deriveCanonicalCandidateProfile: vi.fn(),
      getCanonicalCandidateProfile: vi.fn(),
      listCanonicalCandidateProfileVersions: vi.fn(),
      editCanonicalCandidateProfile: vi.fn(),
      reviewCanonicalCandidateProfile: vi.fn(),
    }}
    selectedProfile={null}
    onSelectionChange={noop}
  />
);

const frame = {
  workspaceTitle: <h1>Job search 2026</h1>,
  workspaceNavigation: null,
  errorMessage: null,
  back: { label: "Home", onBack: noop },
  onOpenStep: { evidence: noop, profile: noop, applications: noop },
};

function evidencePage(
  overrides: { onOpenStep?: Partial<Record<CareerFlowStep, () => void>> } = {},
): string {
  return renderToStaticMarkup(
    <CareerEvidencePage {...frame} knowledge={knowledge} retrieval={retrieval} {...overrides} />,
  );
}

function profilePage(): string {
  return renderToStaticMarkup(<CareerProfilePage {...frame} workflow={workflow} />);
}

describe("Career evidence page", () => {
  it("holds the knowledge and retrieval panels and no profile workflow", () => {
    const html = evidencePage();
    expect(html).toContain('id="candidate-knowledge-heading"');
    expect(html).toContain("Knowledge-store selection is unavailable");
    expect(html).toContain('id="semantic-retrieval-heading"');
    expect(html).not.toContain("canonical-profile-title");
    expect(html).not.toContain("Configured model pair");
  });

  it("starts with the one-sentence intro, then the flow with Career evidence current", () => {
    const html = evidencePage();
    expect(html).toContain(`<p class="career-page-intro">${careerEvidenceIntro}</p>`);
    expect(careerEvidenceIntro).toMatch(/^Your career evidence is the raw material you provide/u);
    expect(html).toMatch(
      /<li class="career-flow-step" aria-current="step">(<span[^>]*>→<\/span>)?Career evidence<\/li>/u,
    );
    expect((html.match(/aria-current="step"/gu) ?? []).length).toBe(1);
    expect(html.indexOf("career-flow")).toBeLessThan(html.indexOf("career-page-intro"));
  });

  it("names the page in a labelled location with a way back", () => {
    const html = evidencePage();
    expect(html).toContain('aria-label="Workspace location"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toMatch(/aria-current="page">Career evidence<\/span>/u);
    expect(html).toContain('aria-label="Back to Home"');
    expect(html).not.toContain("Career profile and evidence");
  });

  it("shows the Career evidence card above the knowledge panel, and the application screen does not", () => {
    const state = { ...createFixtureReviewState(), state: "collecting" as const, runId: "pending" };
    const page = renderToStaticMarkup(
      <CareerEvidencePage
        {...frame}
        card={<CareerEvidenceCard setup={state.setup} />}
        knowledge={knowledge}
      />,
    );
    expect(page).toContain("<strong>Career evidence</strong>");
    expect(page.indexOf("<strong>Career evidence</strong>")).toBeLessThan(
      page.indexOf("candidate-knowledge-heading"),
    );

    const application = renderToStaticMarkup(
      <ReviewWorkspace state={state} onAction={noop} onSelectFiles={noop} onAddUrl={noop} />,
    );
    expect(application).not.toContain("<strong>Career evidence</strong>");
  });

  it("links to the profile page only when the host has a profile workflow", () => {
    expect(evidencePage()).toContain('type="button">Career profile</button>');
    expect(evidencePage({ onOpenStep: { evidence: noop, applications: noop } })).not.toContain(
      'type="button">Career profile</button>',
    );
  });
});

describe("Career profile page", () => {
  it("holds the profile workflow and no knowledge or retrieval panel", () => {
    const html = profilePage();
    expect(html).not.toContain("candidate-knowledge-heading");
    expect(html).not.toContain("Knowledge-store selection");
    expect(html).not.toContain("semantic-retrieval-heading");
    expect(html).not.toContain("Configured model pair");
    expect(html).toContain('id="canonical-profile-title"');
  });

  it("starts with the one-sentence intro, then the flow with Career profile current", () => {
    const html = profilePage();
    expect(html).toContain(`<p class="career-page-intro">${careerProfileIntro}</p>`);
    expect(careerProfileIntro).toMatch(/^Your career profile is the structured, verified record/u);
    expect(html).toMatch(
      /<li class="career-flow-step" aria-current="step">(<span[^>]*>→<\/span>)?Career profile<\/li>/u,
    );
    expect((html.match(/aria-current="step"/gu) ?? []).length).toBe(1);
  });

  it("names the page, offers Back and links to the other steps", () => {
    const html = profilePage();
    expect(html).toMatch(/aria-current="page">Career profile<\/span>/u);
    expect(html).toContain('aria-label="Back to Home"');
    expect(html).toContain('type="button">Career evidence</button>');
    expect(html).toContain('type="button">Applications</button>');
    expect(html).not.toContain('type="button">Career profile</button>');
    expect(html).not.toContain("Career profile and evidence");
  });
});

describe("career flow", () => {
  it("lists the steps in order and marks only the current one", () => {
    for (const [current, label] of [
      ["evidence", "Career evidence"],
      ["profile", "Career profile"],
      ["applications", "Applications"],
    ] as const) {
      const html = renderToStaticMarkup(<CareerFlowStrip current={current} />);
      expect(html).toContain('aria-label="Career flow"');
      expect(html.indexOf("Career evidence")).toBeLessThan(html.indexOf("Career profile"));
      expect(html.indexOf("Career profile")).toBeLessThan(html.indexOf("Applications"));
      expect(html).toContain(`aria-current="step">`);
      expect(html).toMatch(
        new RegExp(`aria-current="step">(<span[^>]*>→</span>)?${label}</li>`, "u"),
      );
      expect((html.match(/aria-current="step"/gu) ?? []).length).toBe(1);
      expect((html.match(/aria-hidden="true">→<\/span>/gu) ?? []).length).toBe(2);
      expect(html).not.toContain("<button");
    }
  });

  it("makes every step but the current one a button when it has a page to open", () => {
    const onOpen = { evidence: vi.fn(), profile: vi.fn(), applications: vi.fn() };
    const html = renderToStaticMarkup(<CareerFlowStrip current="profile" onOpen={onOpen} />);
    expect(html).toContain('type="button">Career evidence</button>');
    expect(html).toContain('type="button">Applications</button>');
    expect(html).toMatch(/aria-current="step">(<span[^>]*>→<\/span>)?Career profile<\/li>/u);
    const found = handlers(<CareerFlowStrip current="profile" onOpen={onOpen} />);
    found.get("Career evidence")?.();
    found.get("Applications")?.();
    expect(onOpen.evidence).toHaveBeenCalledTimes(1);
    expect(onOpen.applications).toHaveBeenCalledTimes(1);
    expect(onOpen.profile).not.toHaveBeenCalled();
  });

  it("keeps the Home card subtitles consistent with the intros", () => {
    expect(careerEvidenceCardSubtitle).toContain("raw material");
    expect(careerEvidenceIntro).toContain("raw material");
    expect(careerProfileCardSubtitle).toContain("verified record");
    expect(careerProfileIntro).toContain("verified record");
  });
});

/** Finds a button by its text in an element tree without a DOM, calling components that hold no hooks. */
function findHandlers(node: ReactNode, found: Map<string, () => void>): void {
  if (Array.isArray(node)) {
    for (const child of node) findHandlers(child, found);
    return;
  }
  if (!isValidElement(node)) return;
  const props = node.props as Record<string, unknown>;
  if (node.type === "button" && typeof props.onClick === "function") {
    found.set(textOf(props.children as ReactNode), props.onClick as () => void);
  }
  if (node.type === WorkspaceLocation) {
    const back = props.back as { label: string; onBack: () => void } | undefined;
    if (back !== undefined) found.set(`Back to ${back.label}`, back.onBack);
  }
  if (typeof node.type === "function" && node.type !== WorkspaceLocation) {
    try {
      findHandlers((node.type as (p: unknown) => ReactNode)(props), found);
      return;
    } catch {
      // A component with hooks: look at its props instead.
    }
  }
  for (const value of Object.values(props)) findHandlers(value as ReactNode, found);
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("").trim();
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function handlers(node: ReactNode): Map<string, () => void> {
  const found = new Map<string, () => void>();
  findHandlers(node, found);
  return found;
}

describe("career navigation", () => {
  it("opens Evidence from Manage evidence and Profile from Manage profile on Home", () => {
    const onManageEvidence = vi.fn();
    const onManageProfile = vi.fn();
    const found = handlers(
      <HomeView
        workspaceTitle={null}
        workspaceNavigation={null}
        profile={{ kind: "reviewed", version: 1 }}
        evidence={{
          kind: "selected",
          storeId: "store-1",
          knowledgeBaseId: "base-1",
          displayName: "Engineering",
          sourceCount: 5,
          blockedCount: 0,
          semanticLine: null,
        }}
        legacyEvidenceSourceCount={0}
        applications={{ status: "loading" }}
        now={new Date()}
        onOpenApplication={noop}
        onManageProfile={onManageProfile}
        onManageEvidence={onManageEvidence}
      />,
    );
    found.get("Manage profile")?.();
    expect(onManageProfile).toHaveBeenCalledTimes(1);
    expect(onManageEvidence).not.toHaveBeenCalled();
    found.get("Manage evidence")?.();
    expect(onManageEvidence).toHaveBeenCalledTimes(1);
  });

  it("goes back and crosses between the two pages through the flow strip", () => {
    const onBack = vi.fn();
    const onOpenStep = { evidence: vi.fn(), profile: vi.fn(), applications: vi.fn() };
    const back = { label: "Acme", onBack };
    const evidence = handlers(
      <CareerEvidencePage {...frame} back={back} onOpenStep={onOpenStep} knowledge={knowledge} />,
    );
    evidence.get("Back to Acme")?.();
    evidence.get("Career profile")?.();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenStep.profile).toHaveBeenCalledTimes(1);

    const profile = handlers(
      <CareerProfilePage {...frame} back={back} onOpenStep={onOpenStep} workflow={workflow} />,
    );
    profile.get("Back to Acme")?.();
    profile.get("Career evidence")?.();
    profile.get("Applications")?.();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onOpenStep.evidence).toHaveBeenCalledTimes(1);
    expect(onOpenStep.applications).toHaveBeenCalledTimes(1);
  });
});
