import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CareerEvidencePage, CareerProfilePage } from "./career-pages.js";
import {
  EvidenceSignpost,
  evidenceSignpostText,
  nextProfileDropState,
  ProfileSignpostArea,
  profileSignpostText,
} from "./career-signposts.js";

const noop = () => undefined;
const frame = {
  workspaceTitle: <h1>Job search 2026</h1>,
  workspaceNavigation: null,
  errorMessage: null,
  back: { label: "Home", onBack: noop },
  onOpenStep: { evidence: noop, profile: noop, applications: noop },
};

describe("career signposts", () => {
  it("points from the profile page to Career evidence for documents, above the workflow", () => {
    const html = renderToStaticMarkup(
      <CareerProfilePage {...frame} workflow={<section id="workflow" />} />,
    );
    expect(html).toContain(profileSignpostText.lead);
    expect(html).toContain(profileSignpostText.body);
    expect(html).toContain(`${profileSignpostText.action} <span aria-hidden="true">→</span>`);
    expect(html.indexOf("career-signpost")).toBeLessThan(html.indexOf('id="workflow"'));
    expect(html).not.toContain(evidenceSignpostText.lead);
  });

  it("points from the evidence page to Career profile for facts, before the evidence card", () => {
    const html = renderToStaticMarkup(
      <CareerEvidencePage {...frame} card={<section id="evidence-card" />} />,
    );
    expect(html).toContain(evidenceSignpostText.body);
    expect(html).toContain(evidenceSignpostText.action);
    expect(html.indexOf("career-signpost")).toBeLessThan(html.indexOf('id="evidence-card"'));
    expect(html).not.toContain(profileSignpostText.lead);
  });

  it("offers no signpost to a page the host cannot open", () => {
    const evidence = renderToStaticMarkup(
      <CareerEvidencePage {...frame} onOpenStep={{ evidence: noop, applications: noop }} />,
    );
    expect(evidence).not.toContain("career-signpost");
    const profile = renderToStaticMarkup(
      <ProfileSignpostArea onOpenEvidence={undefined}>
        <p>Workflow</p>
      </ProfileSignpostArea>,
    );
    expect(profile).toBe("<p>Workflow</p>");
  });

  it("renders the evidence signpost with its button", () => {
    const html = renderToStaticMarkup(<EvidenceSignpost onOpenProfile={noop} />);
    expect(html).toContain('<aside class="career-signpost career-signpost-neutral">');
    expect(html).toContain('type="button">Open Career profile');
  });

  it("points to Career evidence while a file hovers and says it was not added after a drop", () => {
    expect(nextProfileDropState("none", "dragover")).toBe("dragging");
    expect(nextProfileDropState("dragging", "dragleave")).toBe("none");
    expect(nextProfileDropState("dragging", "drop")).toBe("dropped");
    expect(nextProfileDropState("dropped", "dragleave")).toBe("dropped");
    expect(nextProfileDropState("dropped", "dragover")).toBe("dragging");
  });
});
