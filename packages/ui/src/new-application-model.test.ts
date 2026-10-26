import { describe, expect, it, vi } from "vitest";

import {
  defaultReviewedProfile,
  emptyNewApplicationDraft,
  loadReviewedProfileChoices,
  newApplicationJobFileMaxBytes,
  newApplicationJobFileMediaType,
  newApplicationJobInput,
  newApplicationProblem,
  reviewedProfileKey,
  sortReviewedProfileChoices,
  withChosenJobFile,
} from "./new-application-model.js";

const workspaceId = "workspace-1";

describe("the new application's name and job", () => {
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

  it("reads a job file's type from its name", () => {
    expect(newApplicationJobFileMediaType("Role.PDF")).toBe("application/pdf");
    expect(newApplicationJobFileMediaType("role.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(newApplicationJobFileMediaType("role.markdown")).toBe("text/markdown");
    expect(newApplicationJobFileMediaType("role.txt")).toBe("text/plain");
    expect(newApplicationJobFileMediaType("role.html")).toBeUndefined();
    expect(newApplicationJobFileMediaType("role")).toBeUndefined();
  });

  it("reads a chosen job file, and refuses another type or a large one without reading it", async () => {
    const named = { ...emptyNewApplicationDraft, name: "Acme", jobKind: "file" as const };
    expect(newApplicationProblem(named)).toMatch(/Attach the job description/u);
    const text = new TextEncoder().encode("Platform Engineer");
    const chosen = await withChosenJobFile(named, {
      name: "role.txt",
      size: text.byteLength,
      arrayBuffer: async () => text.buffer as ArrayBuffer,
    });
    expect(chosen.jobFile).toEqual({ name: "role.txt", mediaType: "text/plain", bytes: text });
    expect(newApplicationProblem(chosen)).toBeNull();
    expect(newApplicationJobInput(chosen)).toEqual({ file: chosen.jobFile });

    const read = vi.fn(async () => new ArrayBuffer(0));
    const wrongType = await withChosenJobFile(chosen, {
      name: "role.html",
      size: 4,
      arrayBuffer: read,
    });
    expect(wrongType.jobFile).toBeNull();
    expect(newApplicationProblem(wrongType)).toMatch(/PDF, DOCX, Markdown or plain text/u);
    const tooLarge = await withChosenJobFile(named, {
      name: "role.pdf",
      size: newApplicationJobFileMaxBytes + 1,
      arrayBuffer: read,
    });
    expect(newApplicationProblem(tooLarge)).toMatch(/larger than 10 MB/u);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("reviewed profiles", () => {
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
