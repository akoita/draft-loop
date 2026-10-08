import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeView, ProfileFreshnessNote } from "./home.js";
import type { HomeProfileStatus } from "./home-model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import {
  loadProfileFreshness,
  profileFreshnessChangeText,
  profileFreshnessPresentation,
} from "./profile-freshness.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";

const result = (overrides: Partial<ProfileFreshnessResult> = {}): ProfileFreshnessResult => ({
  workspaceId: "workspace-1",
  profileId: "profile-1",
  state: "up-to-date",
  version: 3,
  reviewedVersion: null,
  newSourceCount: 0,
  changedSourceCount: 0,
  removedSourceCount: 0,
  ...overrides,
});

const reviewed: HomeProfileStatus = { kind: "reviewed", version: 3 };

describe("profile freshness wording", () => {
  it("lists each kind of change with the noun after the last count", () => {
    expect(profileFreshnessChangeText(result({ newSourceCount: 2, changedSourceCount: 1 }))).toBe(
      "2 new, 1 updated source",
    );
    expect(profileFreshnessChangeText(result({ newSourceCount: 1 }))).toBe("1 new source");
    expect(profileFreshnessChangeText(result({ removedSourceCount: 3 }))).toBe("3 retired sources");
    expect(
      profileFreshnessChangeText(
        result({ newSourceCount: 1, changedSourceCount: 2, removedSourceCount: 4 }),
      ),
    ).toBe("1 new, 2 updated, 4 retired sources");
  });

  it("says up to date for a reviewed profile that matches the evidence", () => {
    expect(profileFreshnessPresentation(reviewed, result())).toEqual({
      tone: "ready",
      text: "Up to date with your career evidence",
    });
  });

  it("offers an update when the evidence changed", () => {
    expect(
      profileFreshnessPresentation(
        reviewed,
        result({ state: "update-available", newSourceCount: 2, changedSourceCount: 1 }),
      ),
    ).toEqual({
      tone: "attention",
      text: "Career evidence changed: 2 new, 1 updated source",
      action: "Update profile",
    });
  });

  it("asks for the review of a draft without asking the host", () => {
    // The card's own Review profile button acts here, so the line has no inline action.
    expect(profileFreshnessPresentation({ kind: "draft", version: 4 }, undefined)).toEqual({
      tone: "attention",
      text: "Draft version 4 awaiting your review",
    });
    expect(
      profileFreshnessPresentation(
        reviewed,
        result({ state: "review-pending", version: 4, reviewedVersion: 3 }),
      )?.text,
    ).toBe("Draft version 4 awaiting your review");
  });

  it("says no profile exists yet, leaving generation to the card's button", () => {
    expect(profileFreshnessPresentation({ kind: "none" }, undefined)).toEqual({
      tone: "attention",
      text: "Not generated yet",
    });
  });

  it("stays silent when it has nothing reliable to say", () => {
    for (const profile of [
      { kind: "loading" },
      { kind: "unsupported" },
      { kind: "unavailable" },
      { kind: "failed", version: 1 },
    ] as const) {
      expect(profileFreshnessPresentation(profile, result())).toBeUndefined();
    }
    expect(profileFreshnessPresentation(reviewed, undefined)).toBeUndefined();
    expect(
      profileFreshnessPresentation(reviewed, result({ state: "unavailable" })),
    ).toBeUndefined();
  });
});

describe("profile freshness loading", () => {
  const capabilities = (
    read: DesktopProfileCapabilities["getCandidateProfileFreshness"],
  ): DesktopProfileCapabilities =>
    read === undefined ? {} : { getCandidateProfileFreshness: read };

  it("passes the workspace and profile ids to the host", async () => {
    const calls: string[][] = [];
    const answer = result();
    await expect(
      loadProfileFreshness(
        capabilities(async (workspaceId, profileId) => {
          calls.push([workspaceId, profileId]);
          return answer;
        }),
        "workspace-1",
        "profile-1",
      ),
    ).resolves.toBe(answer);
    expect(calls).toEqual([["workspace-1", "profile-1"]]);
  });

  it("answers nothing when the host lacks the command or fails", async () => {
    await expect(
      loadProfileFreshness(capabilities(undefined), "workspace-1", "profile-1"),
    ).resolves.toBeUndefined();
    await expect(
      loadProfileFreshness(
        capabilities(async () => {
          throw new Error("boom");
        }),
        "workspace-1",
        "profile-1",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("profile freshness on Home", () => {
  function home(profile: HomeProfileStatus, freshness: ProfileFreshnessResult | undefined) {
    const presentation = profileFreshnessPresentation(profile, freshness);
    return renderToStaticMarkup(
      <HomeView
        workspaceTitle={<h1>Job search 2026</h1>}
        workspaceNavigation={null}
        profile={profile}
        evidence={{ kind: "none" }}
        legacyEvidenceSourceCount={0}
        applications={{ status: "ready", applications: [] }}
        now={new Date("2026-10-08T12:00:00.000Z")}
        onOpenApplication={() => undefined}
        onManageProfile={() => undefined}
        onManageEvidence={() => undefined}
        {...(presentation === undefined
          ? {}
          : {
              profileFreshness: (
                <ProfileFreshnessNote presentation={presentation} onAction={() => undefined} />
              ),
            })}
      />,
    );
  }

  it("shows the up to date line without an action", () => {
    const html = home(reviewed, result());
    expect(html).toContain("Up to date with your career evidence");
    expect(html).toContain("home-freshness-ready");
    expect(html).not.toContain("home-freshness-action");
  });

  it("shows the changed-evidence line with the update action", () => {
    const html = home(
      reviewed,
      result({ state: "update-available", newSourceCount: 2, changedSourceCount: 1 }),
    );
    expect(html).toContain("Career evidence changed: 2 new, 1 updated source");
    expect(html).toMatch(/<button[^>]*home-freshness-action[^>]*>Update profile<\/button>/u);
    expect(html).toContain("home-freshness-attention");
  });

  it("shows the draft line without a duplicate inline action", () => {
    const html = home({ kind: "draft", version: 2 }, undefined);
    expect(html).toContain("Draft version 2 awaiting your review");
    expect(html).not.toContain("home-freshness-action");
  });

  it("shows the not-generated line without a duplicate inline action", () => {
    const html = home({ kind: "none" }, undefined);
    expect(html).toContain("Not generated yet");
    expect(html).not.toContain("home-freshness-action");
  });

  it("shows no freshness line while the profile is loading", () => {
    expect(home({ kind: "loading" }, undefined)).not.toContain("home-freshness");
  });

  it("disables the action while a workspace operation runs", () => {
    const html = renderToStaticMarkup(
      <ProfileFreshnessNote
        presentation={{ tone: "attention", text: "x", action: "Update profile" }}
        disabled
        onAction={() => undefined}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Update profile<\/button>/u);
  });
});
