import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalCandidateProfileRecordResult } from "./bridge.js";
import { ProfileWorkspace } from "./profile.js";
import { projectCanonicalCandidateProfileOutcome } from "./profile-outcome.js";
import type { ProfileStatus } from "./profile-status.js";
import {
  ProfileGenerationAction,
  ProfileStatusSummary,
  ProfileVersionDetails,
  ProfileVersionHistory,
} from "./profile-status-view.js";

const at = "2026-09-01T10:00:00.000Z";
const jargon = /canonical|immutable|bounded|provider-independent/iu;

function record(
  status: "draft" | "reviewed",
  version: number,
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "sample-profile",
    version,
    parentVersion: version === 1 ? null : version - 1,
    status,
    createdAt: at,
    updatedAt: at,
    reviewedAt: status === "reviewed" ? at : null,
    checksum: "c".repeat(64),
    facts: [],
    issues: [],
  };
}

const needsReview: ProfileStatus = {
  kind: "needs-review",
  issueCount: 2,
  primaryAction: "review",
  label: "Needs review: 2 issues",
  detail: "Resolve or acknowledge each open issue, save, then mark the profile reviewed.",
};

/** Visible text only: tags, attributes and the visually hidden status prefix removed. */
function visibleText(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ");
}

describe("profile status summary", () => {
  it("spells the status out in words and keeps the action beside it", () => {
    const html = renderToStaticMarkup(
      <ProfileStatusSummary titleId="profile-title" status={needsReview}>
        <button type="button">Review issues</button>
      </ProfileStatusSummary>,
    );
    expect(html).toContain('<h2 id="profile-title">Your career profile</h2>');
    expect(html).toContain('data-status="needs-review"');
    expect(html).toContain('<span class="sr-only">Status: </span>Needs review: 2 issues');
    expect(html).toContain(needsReview.detail);
    expect(html.indexOf("Needs review: 2 issues")).toBeLessThan(html.indexOf("Review issues"));
    expect(html).not.toContain("Used for applications");
  });

  it("says loading instead of a guessed status and marks the profile in use", () => {
    const html = renderToStaticMarkup(
      <ProfileStatusSummary titleId="profile-title" status={needsReview} loading selected />,
    );
    expect(html).toContain("Loading your profile…");
    expect(html).not.toContain(needsReview.label);
    expect(html).toContain("Used for applications");
  });
});

describe("profile generation approval", () => {
  it("is one checkbox worded as what is sent, beside the button that sends it", () => {
    const html = renderToStaticMarkup(
      <ProfileGenerationAction
        outcome={projectCanonicalCandidateProfileOutcome(null, "sample-profile", null)}
        mode="update"
        profileIdValid
        providerTransmissionApproved={false}
        busy={false}
        sourceCount={4}
        providerName="Anthropic"
        onApprovalChange={() => undefined}
        onDerive={() => undefined}
      />,
    );
    expect((html.match(/type="checkbox"/gu) ?? []).length).toBe(1);
    expect(html).toContain(
      "Send my career evidence (up to 4 sources) to Anthropic to update the profile.",
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Update profile<\/button>/u);
    expect(html).toContain("Tick the approval box to update.");
  });

  it("keeps the box ticked and disabled while the generation it allowed runs, then clears it", () => {
    const action = (generating: boolean) =>
      renderToStaticMarkup(
        <ProfileGenerationAction
          outcome={projectCanonicalCandidateProfileOutcome(null, "sample-profile", null)}
          profileIdValid
          // The page clears the approval when it sends, so each generation asks again.
          providerTransmissionApproved={false}
          busy={generating}
          generating={generating}
          providerName="Anthropic"
          onApprovalChange={() => undefined}
          onDerive={() => undefined}
        />,
      );
    const running = action(true);
    expect(running).toContain('<input type="checkbox" disabled="" checked=""/>');
    expect(running).toContain("Generating…");
    expect(running).not.toContain("Tick the approval box");

    const ended = action(false);
    expect(ended).toMatch(/<input type="checkbox"\/>/u);
    expect(ended).toContain("Tick the approval box to generate.");
  });
});

describe("profile version details", () => {
  it("shows version facts and a plain note on reviewed and earlier versions", () => {
    const reviewed = renderToStaticMarkup(
      <ProfileVersionDetails record={record("reviewed", 2)} history={[record("reviewed", 2)]} />,
    );
    expect(reviewed).toContain("<dt>Checksum</dt>");
    expect(reviewed).toContain(`${"c".repeat(12)}…`);
    expect(reviewed).toContain("Reviewed versions cannot be edited.");

    const earlier = renderToStaticMarkup(
      <ProfileVersionDetails
        record={record("draft", 1)}
        history={[record("draft", 1), record("draft", 2)]}
      />,
    );
    expect(earlier).toContain("Earlier versions cannot be edited.");
    expect(reviewed + earlier).not.toMatch(jargon);
  });

  it("lists the version history only when versions exist", () => {
    const html = renderToStaticMarkup(
      <ProfileVersionHistory
        history={[record("draft", 1), record("reviewed", 2)]}
        version={2}
        disabled={false}
        onChoose={() => undefined}
      />,
    );
    expect(html).toContain("<span>Version history</span>");
    expect(html).toContain('aria-label="Profile version"');
    expect(html).toContain("Version 2 · reviewed");
    expect(
      renderToStaticMarkup(
        <ProfileVersionHistory
          history={[]}
          version={null}
          disabled={false}
          onChoose={() => undefined}
        />,
      ),
    ).toBe("");
  });
});

describe("career profile page layout", () => {
  const capabilities = {
    deriveCanonicalCandidateProfile: vi.fn(async () => record("draft", 1)),
    getCanonicalCandidateProfile: vi.fn(async () => record("draft", 1)),
    listCanonicalCandidateProfileVersions: vi.fn(async () => ({
      workspaceId: "workspace-1",
      profileId: "sample-profile",
      versions: [record("draft", 1)],
    })),
    editCanonicalCandidateProfile: vi.fn(async () => record("draft", 1)),
    reviewCanonicalCandidateProfile: vi.fn(async () => record("reviewed", 1)),
    listReviewedCanonicalCandidateProfiles: vi.fn(async () => ({
      workspaceId: "workspace-1",
      profiles: [],
    })),
  };
  const html = renderToStaticMarkup(
    <ProfileWorkspace
      workspaceId="workspace-1"
      capabilities={capabilities}
      selectedProfile={null}
      onSelectionChange={() => undefined}
      providerCompany="anthropic"
    />,
  );
  const detailsAt = html.indexOf('<details class="profile-more">');
  const primary = html.slice(0, detailsAt);
  const details = html.slice(detailsAt);

  it("leads with the status, then one primary action with its approval", () => {
    expect(detailsAt).toBeGreaterThan(0);
    expect(primary).toContain("No profile yet");
    expect(primary).toMatch(/<button[^>]*>Generate profile<\/button>/u);
    expect(primary.indexOf("No profile yet")).toBeLessThan(primary.indexOf("Generate profile"));
    expect(primary).toContain("Send my career evidence to Anthropic to build the profile.");
    expect((html.match(/type="checkbox"/gu) ?? []).length).toBe(2);
    expect((primary.match(/type="checkbox"/gu) ?? []).length).toBe(1);
  });

  it("keeps the name, pickers, history and re-extraction under a native Details disclosure", () => {
    expect(details.startsWith('<details class="profile-more"><summary>Details</summary>')).toBe(
      true,
    );
    expect(details).not.toContain('<details class="profile-more" open');
    for (const text of [
      'aria-label="Profile name"',
      "Load latest",
      'aria-label="Existing reviewed profiles"',
      "Re-extract all sources",
    ]) {
      expect(primary).not.toContain(text);
      expect(details).toContain(text);
    }
    // The only send action is the primary one, so Details offers no second approval.
    expect(details).not.toContain("Send my career evidence");
  });

  it("uses no internal jargon in the visible text above Details", () => {
    expect(visibleText(primary)).not.toMatch(jargon);
    expect(primary).not.toContain("Immutable profile history");
  });
});
