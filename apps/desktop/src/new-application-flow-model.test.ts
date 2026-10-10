import { describe, expect, it, vi } from "vitest";

import {
  defaultReviewedProfile,
  emptyNewApplicationDraft,
  loadReviewedProfileChoices,
  newApplicationJobInput,
  newApplicationProblem,
  newApplicationStartBlocker,
  requirementsReviewed,
  requirementsStatusText,
  reviewedProfileKey,
  sortReviewedProfileChoices,
  stepProgressText,
} from "./new-application-flow-model.js";

const workspaceId = "workspace-1";

describe("step 1: the job", () => {
  it("asks for a name, then the pasted job text", () => {
    expect(newApplicationProblem(emptyNewApplicationDraft)).toMatch(/Name/u);
    const named = { ...emptyNewApplicationDraft, name: "Acme" };
    expect(newApplicationProblem(named)).toMatch(/job description/u);
    expect(newApplicationProblem({ ...named, jobText: "Role text" })).toBeNull();
  });

  it("needs a web address and the person's approval for a URL job", () => {
    const named = { ...emptyNewApplicationDraft, name: "Acme", jobKind: "url" as const };
    expect(newApplicationProblem(named)).toMatch(/web address/u);
    expect(newApplicationProblem({ ...named, jobUrl: "ftp://example.test/job" })).toMatch(
      /web address/u,
    );
    expect(newApplicationProblem({ ...named, jobUrl: "https://jobs.example.test/1" })).toMatch(
      /Allow DraftLoop to fetch/u,
    );
    expect(
      newApplicationProblem({ ...named, jobUrl: "https://jobs.example.test/1", urlApproved: true }),
    ).toBeNull();
  });

  it("hands the port the text, or the trimmed URL", () => {
    expect(newApplicationJobInput({ ...emptyNewApplicationDraft, jobText: "Role" })).toBe("Role");
    expect(
      newApplicationJobInput({
        ...emptyNewApplicationDraft,
        jobKind: "url",
        jobUrl: " https://jobs.example.test/1 ",
      }),
    ).toEqual({ url: "https://jobs.example.test/1" });
  });
});

describe("step 2: requirements", () => {
  const brief = (status: "draft" | "reviewed") => ({
    workspaceId,
    briefId: "brief-1",
    version: 2,
    status,
    requirementCount: 1,
    criticalCount: 0,
  });

  it("moves on only once the application's brief is reviewed", () => {
    expect(requirementsReviewed(undefined)).toBe(false);
    expect(requirementsReviewed(null)).toBe(false);
    expect(requirementsReviewed(brief("draft"))).toBe(false);
    expect(requirementsReviewed(brief("reviewed"))).toBe(true);
  });

  it("words each state", () => {
    expect(requirementsStatusText(undefined)).toMatch(/Checking/u);
    expect(requirementsStatusText(null)).toMatch(/No requirements yet/u);
    expect(requirementsStatusText(brief("draft"))).toMatch(/draft.*Review it to continue/u);
    expect(requirementsStatusText(brief("reviewed"))).toMatch(/reviewed.*start from it/u);
  });
});

describe("step 3: reviewed profiles", () => {
  const catalog = (
    profiles: readonly { profileId: string; version: number; reviewedAt: string }[],
  ) => ({
    workspaceId,
    profiles,
  });
  const reviewedVersion = (version: number, reviewedAt: string) => ({
    version,
    status: "reviewed",
    reviewedAt,
    facts: [{}],
    issues: [],
  });

  it("sorts the newest review first", () => {
    const sorted = sortReviewedProfileChoices([
      { profileId: "a", version: 1, reviewedAt: "2026-10-01T00:00:00.000Z" },
      { profileId: "b", version: 4, reviewedAt: "2026-10-05T00:00:00.000Z" },
      { profileId: "a", version: 2, reviewedAt: "2026-10-03T00:00:00.000Z" },
    ]);
    expect(sorted.map(reviewedProfileKey)).toEqual(["b@4", "a@2", "a@1"]);
    expect(defaultReviewedProfile(sorted)).toMatchObject({ profileId: "b", version: 4 });
    expect(defaultReviewedProfile([])).toBeUndefined();
  });

  it("offers the latest reviewed version first and the earlier reviewed versions after it", async () => {
    const result = await loadReviewedProfileChoices(
      {
        listReviewedCanonicalCandidateProfiles: async () =>
          catalog([{ profileId: "candidate", version: 3, reviewedAt: "2026-10-05T00:00:00.000Z" }]),
        listCanonicalCandidateProfileVersions: async () => ({
          workspaceId,
          profileId: "candidate",
          versions: [
            reviewedVersion(1, "2026-10-01T00:00:00.000Z"),
            { version: 2, status: "draft", reviewedAt: null, facts: [{}], issues: [] },
            reviewedVersion(3, "2026-10-05T00:00:00.000Z"),
            { ...reviewedVersion(4, "2026-10-06T00:00:00.000Z"), facts: [] },
            {
              ...reviewedVersion(5, "2026-10-07T00:00:00.000Z"),
              issues: [{ status: "open" }],
            },
          ] as never,
        }),
      },
      workspaceId,
    );
    expect(result.status).toBe("ready");
    expect(result.status === "ready" && result.choices.map(reviewedProfileKey)).toEqual([
      "candidate@3",
      "candidate@1",
    ]);
  });

  it("keeps the catalog's version when a profile's history cannot be read", async () => {
    const result = await loadReviewedProfileChoices(
      {
        listReviewedCanonicalCandidateProfiles: async () =>
          catalog([{ profileId: "candidate", version: 3, reviewedAt: "2026-10-05T00:00:00.000Z" }]),
        listCanonicalCandidateProfileVersions: vi.fn(async () => {
          throw new Error("unreadable");
        }),
      },
      workspaceId,
    );
    expect(result).toMatchObject({ status: "ready", choices: [{ profileId: "candidate" }] });
  });

  it("reports no reviewed profile, an unsupported host and a failure separately", async () => {
    await expect(
      loadReviewedProfileChoices(
        { listReviewedCanonicalCandidateProfiles: async () => catalog([]) },
        workspaceId,
      ),
    ).resolves.toEqual({ status: "ready", choices: [] });
    await expect(loadReviewedProfileChoices({}, workspaceId)).resolves.toEqual({
      status: "unsupported",
    });
    await expect(
      loadReviewedProfileChoices(
        {
          listReviewedCanonicalCandidateProfiles: async () => {
            throw new Error("down");
          },
        },
        workspaceId,
      ),
    ).resolves.toEqual({ status: "failed" });
  });
});

describe("step 4: start", () => {
  const ready = {
    requirementsReady: true,
    profile: { profileId: "candidate", version: 3 },
    transmissionRequired: false,
    transmissionConfirmed: false,
  };

  it("names what is missing, in order", () => {
    expect(newApplicationStartBlocker({ ...ready, requirementsReady: false })).toMatch(
      /requirements/u,
    );
    expect(newApplicationStartBlocker({ ...ready, profile: null })).toMatch(/career profile/u);
    expect(newApplicationStartBlocker({ ...ready, transmissionRequired: true })).toMatch(
      /Confirm the provider data transmission/u,
    );
    expect(
      newApplicationStartBlocker({
        ...ready,
        transmissionRequired: true,
        transmissionConfirmed: true,
      }),
    ).toBeNull();
    expect(newApplicationStartBlocker(ready)).toBeNull();
  });

  it("holds Start while the pair's provider is not configured, but not while unknown", () => {
    const missing = { ready: false, summary: "Configure OpenAI API key for live review" };
    expect(newApplicationStartBlocker({ ...ready, providerReadiness: missing })).toBe(
      "Configure OpenAI API key for live review.",
    );
    expect(
      newApplicationStartBlocker({ ...ready, profile: null, providerReadiness: missing }),
    ).toMatch(/career profile/u);
    expect(
      newApplicationStartBlocker({
        ...ready,
        providerReadiness: {
          ready: true,
          summary: "Anthropic API key & OpenAI API key configured",
        },
      }),
    ).toBeNull();
    expect(newApplicationStartBlocker({ ...ready, providerReadiness: null })).toBeNull();
  });

  it("counts the four steps", () => {
    expect(stepProgressText("job")).toBe("Step 1 of 4");
    expect(stepProgressText("start")).toBe("Step 4 of 4");
  });
});
