import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import {
  candidateProfileApprovalAfterIdChange,
  candidateProfileSelectionForRecord,
  canEditCanonicalCandidateProfile,
  groupCanonicalCandidateProfileFacts,
  groupCanonicalCandidateProfileIssues,
  hasCanonicalCandidateProfileCapabilities,
  ProfileDetails,
  ProfileGenerationAction,
  ProfileOutcomeFeedback,
  ProfileWorkspace,
  SavedProfilePicker,
  safeCanonicalCandidateProfileText,
} from "./profile.js";
import { projectCanonicalCandidateProfileOutcome } from "./profile-outcome.js";

const capturedAt = "2026-08-28T10:00:00.000Z";
const provenance = {
  storeId: "store-1",
  knowledgeBaseId: "ckb-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};

const facts: readonly CanonicalCandidateProfileFactResult[] = [
  {
    id: "fact-role",
    category: "role",
    field: "title",
    value: "Platform engineer",
    provenance: [provenance],
  },
  {
    id: "fact-link",
    category: "approved-link",
    field: "url",
    value: "https://approved.example.test/me",
    provenance: [provenance],
  },
];

const roleFact: CanonicalCandidateProfileFactResult = {
  id: "fact-role",
  category: "role",
  field: "title",
  value: "Platform engineer",
  provenance: [provenance],
};

const linkFact: CanonicalCandidateProfileFactResult = {
  id: "fact-link",
  category: "approved-link",
  field: "url",
  value: "https://approved.example.test/me",
  provenance: [provenance],
};

const issues: readonly CanonicalCandidateProfileIssueResult[] = [
  {
    id: "issue-date",
    code: "conflict-date",
    severity: "error",
    status: "open",
    message: "The dates disagree.",
    factIds: ["fact-role"],
    sourceRefs: [provenance],
  },
  {
    id: "issue-omission",
    code: "omission",
    severity: "warning",
    status: "acknowledged",
    message: "A source omits a detail.",
    factIds: [],
    sourceRefs: [],
  },
];

function record(
  status: "draft" | "reviewed" = "draft",
  version = 1,
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "profile-1",
    version,
    parentVersion: version === 1 ? null : version - 1,
    status,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    reviewedAt: status === "reviewed" ? capturedAt : null,
    checksum: "a".repeat(64),
    facts,
    issues,
  };
}

describe("desktop canonical candidate profile", () => {
  it("scopes provider approval to the exact profile ID", () => {
    expect(candidateProfileApprovalAfterIdChange(true, "profile-a", "profile-a")).toBe(true);
    expect(candidateProfileApprovalAfterIdChange(true, "profile-a", "profile-b")).toBe(false);
    expect(candidateProfileApprovalAfterIdChange(false, "profile-a", "profile-a")).toBe(false);
  });

  it("groups bounded facts and issues without exposing storage selection", () => {
    expect(groupCanonicalCandidateProfileFacts(facts).map(([category]) => category)).toEqual([
      "role",
      "approved-link",
    ]);
    const issueGroups = groupCanonicalCandidateProfileIssues(issues);
    expect([...(issueGroups.get("error")?.keys() ?? [])]).toEqual(["open"]);
    expect([...(issueGroups.get("warning")?.keys() ?? [])]).toEqual(["acknowledged"]);
    expect(JSON.stringify(facts)).not.toContain("storeRoot");
    expect(JSON.stringify(facts)).not.toContain("candidateKnowledgeSelection");
  });

  it("keeps review selection exact and disables historical edits", () => {
    const reviewed = record("reviewed");
    const reviewable = {
      ...reviewed,
      issues: reviewed.issues.map((issue) => ({ ...issue, status: "resolved" as const })),
    };
    expect(candidateProfileSelectionForRecord(reviewable)).toEqual({
      profileId: "profile-1",
      version: 1,
    });
    expect(candidateProfileSelectionForRecord({ ...reviewable, facts: [] })).toBeNull();
    expect(candidateProfileSelectionForRecord(record("draft"))).toBeNull();
    expect(canEditCanonicalCandidateProfile(record("draft", 1), 1)).toBe(true);
    expect(canEditCanonicalCandidateProfile(record("draft", 1), 2)).toBe(false);
    expect(canEditCanonicalCandidateProfile(record("reviewed", 1), 1)).toBe(false);
  });

  it("redacts URL-looking untrusted text while allowing approved-link facts", () => {
    expect(safeCanonicalCandidateProfileText("See https://private.example.test/file")).toBe(
      "See [link omitted]",
    );
    expect(safeCanonicalCandidateProfileText(facts[1]?.value ?? "", true)).toBe(
      "https://approved.example.test/me",
    );
  });

  it("renders grouped profile details with only bounded provenance fields", () => {
    const html = renderToStaticMarkup(
      <ProfileDetails
        record={record()}
        history={[record()]}
        draftFacts={facts}
        draftIssues={issues}
        editable
        busy={false}
        onFactValueChange={() => undefined}
        onRemoveFact={() => undefined}
        onIssueStatusChange={() => undefined}
        onSave={() => undefined}
        onReview={() => undefined}
      />,
    );
    expect(html).toContain("Facts by category");
    expect(html).toContain("Approved link");
    expect(html).not.toContain(">approved-link<");
    expect(html).toContain("Issues by severity and status");
    expect(html).toContain("Conflicting dates");
    expect(html).not.toContain("conflict-date");
    expect(html).toContain("Store");
    expect(html).toContain("CKB");
    expect(html).toContain("Source");
    expect(html).toContain("Version");
    expect(html).toContain("Kind");
    expect(html).toContain("https://approved.example.test/me");
    expect(html).not.toContain("candidateKnowledgeSelection");
    expect(html).not.toContain("storeRoot");
    expect(html).not.toContain("/private");
  });

  it("renders each fact as a readable row with its provenance behind collapsed details", () => {
    const html = renderToStaticMarkup(
      <ProfileDetails
        record={record()}
        history={[record()]}
        draftFacts={[
          { ...roleFact, field: "employment_end_date", subjectId: "subject-77" },
          linkFact,
        ]}
        draftIssues={issues}
        editable
        busy={false}
        onFactValueChange={() => undefined}
        onRemoveFact={() => undefined}
        onIssueStatusChange={() => undefined}
        onSave={() => undefined}
        onReview={() => undefined}
      />,
    );
    expect(html).toContain(">Employment end date</label>");
    expect(html).toContain('for="profile-fact-value-fact-role"');
    expect(html).toContain('id="profile-fact-value-fact-role"');
    expect(html).toContain('aria-label="Value for fact fact-role"');
    expect(html).toContain("1 source</span>");
    expect(html).toContain('aria-label="Remove fact"');
    expect(html).toContain("<summary>Details</summary>");
    expect(html).not.toContain("<details open");
    expect(html.match(/<details class="profile-fact-details"/g)).toHaveLength(3);
    // Technical identifiers stay available inside the collapsed details.
    expect(html).toContain("Field employment_end_date");
    expect(html).toContain("subject subject-77");
    expect(html).toContain('aria-label="Provenance for fact fact-role"');
    expect(html).toContain('aria-label="Provenance for issue issue-date"');
    for (const id of ["store-1", "ckb-1", "source-1", "version-1", "candidate-provided"]) {
      expect(html).toContain(id);
    }
    // Category headings carry a count chip; issues cite facts by label and value.
    expect(html).toContain('<span class="meta-chip">1</span></h4>');
    expect(html).toContain("Facts: Employment end date: Platform engineer");
    expect(html).not.toContain("Facts: fact-role");
  });

  it("falls back to a generic label for issue facts that are no longer present", () => {
    const html = renderToStaticMarkup(
      <ProfileDetails
        record={record()}
        history={[record()]}
        draftFacts={[{ ...roleFact, id: "fact-long", field: "skillName", value: "x".repeat(100) }]}
        draftIssues={[
          {
            ...(issues[0] as CanonicalCandidateProfileIssueResult),
            factIds: ["fact-long", "gone"],
          },
        ]}
        editable={false}
        busy={false}
        onFactValueChange={() => undefined}
        onRemoveFact={() => undefined}
        onIssueStatusChange={() => undefined}
        onSave={() => undefined}
        onReview={() => undefined}
      />,
    );
    expect(html).toContain(`Facts: Skill name: ${"x".repeat(59)}…; unavailable fact`);
    expect(html).not.toContain("Remove fact");
  });

  it("renders saved failure guidance and keeps retry behind the existing consent checkbox", () => {
    const failureIssue: CanonicalCandidateProfileIssueResult = {
      id: "issue-extraction-failure",
      code: "omission",
      severity: "error",
      status: "open",
      message: "Profile extraction exceeded the available output limit. No facts were saved.",
      factIds: [],
      sourceRefs: [],
    };
    const failure = {
      ...record(),
      facts: [],
      issues: [failureIssue],
    };
    const outcome = projectCanonicalCandidateProfileOutcome(failure, "profile-1", "profile-1");
    const onDerive = vi.fn();
    const html = renderToStaticMarkup(
      <>
        <ProfileGenerationAction
          outcome={outcome}
          profileIdValid
          providerTransmissionApproved={false}
          busy={false}
          onApprovalChange={() => undefined}
          onDerive={onDerive}
        />
        <ProfileOutcomeFeedback outcome={outcome} />
      </>,
    );

    expect(html).toContain("Retry profile generation");
    expect(html).toContain('disabled=""');
    expect(html).toContain("I approve sending selected candidate material");
    expect(html).not.toContain("Existing reviewed profiles");
    expect(html).toContain("may use provider credits");
    expect(html).toContain("Tick the approval box to enable Retry.");
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("/private");
    expect(onDerive).not.toHaveBeenCalled();
  });

  describe("failure shown once", () => {
    const cause = "Profile extraction exceeded the available output limit. No facts were saved.";
    const failureRecord = {
      ...record(),
      facts: [],
      issues: [
        {
          id: "issue-extraction-failure",
          code: "omission",
          severity: "error",
          status: "open",
          message: cause,
          factIds: [],
          sourceRefs: [],
        } satisfies CanonicalCandidateProfileIssueResult,
      ],
    };
    const count = (html: string, text: string) => html.split(text).length - 1;
    const failureOutcome = projectCanonicalCandidateProfileOutcome(
      failureRecord,
      "profile-1",
      "profile-1",
    );

    it("renders the cause once in one callout with one next step", () => {
      const feedback = renderToStaticMarkup(<ProfileOutcomeFeedback outcome={failureOutcome} />);
      const details = renderToStaticMarkup(
        <ProfileDetails
          record={failureRecord}
          history={[failureRecord]}
          draftFacts={[]}
          draftIssues={failureRecord.issues}
          editable
          busy={false}
          failureRecorded
          onFactValueChange={() => undefined}
          onRemoveFact={() => undefined}
          onIssueStatusChange={() => undefined}
          onSave={() => undefined}
          onReview={() => undefined}
        />,
      );
      const all = feedback + details;
      expect(count(all, cause)).toBe(1);
      expect(feedback).toContain("profile-outcome-failure");
      expect(feedback).toContain("Profile generation failed. No facts were saved.");
      expect(feedback).toContain('aria-label="Recorded cause"');
      expect(feedback).toContain("Fix the cause above, then retry.");
      expect(feedback).not.toContain("Saved issue guidance");
      expect(feedback).not.toContain(failureOutcome.message);
      expect(details).not.toContain("Issues by severity and status");
      expect(details).not.toContain("Save draft edits");
      expect(details).not.toContain("Mark latest draft reviewed");
      expect(details).not.toContain("Facts by category");
      expect(details).toContain(
        "This version records a failed generation; its cause is shown above.",
      );
      expect(details).toContain("Version");
    });

    it("keeps the facts and issues sections when no failure is recorded", () => {
      const html = renderToStaticMarkup(
        <ProfileDetails
          record={record()}
          history={[record()]}
          draftFacts={facts}
          draftIssues={issues}
          editable
          busy={false}
          onFactValueChange={() => undefined}
          onRemoveFact={() => undefined}
          onIssueStatusChange={() => undefined}
          onSave={() => undefined}
          onReview={() => undefined}
        />,
      );
      expect(html).toContain("Issues by severity and status");
      expect(html).not.toContain("profile-failure-note");
    });

    it("renders an empty callout for a retryable empty version and plain feedback otherwise", () => {
      const empty = projectCanonicalCandidateProfileOutcome(
        { ...record(), facts: [], issues: [] },
        "profile-1",
        "profile-1",
      );
      expect(empty.kind).toBe("empty");
      const html = renderToStaticMarkup(<ProfileOutcomeFeedback outcome={empty} />);
      expect(html).toContain("profile-outcome-empty");
      expect(html).toContain("This profile version has no facts.");
      expect(html).toContain("Check that the selected source material");
      expect(html).not.toContain('aria-label="Recorded cause"');

      const draft = projectCanonicalCandidateProfileOutcome(record(), "profile-1", "profile-1");
      const plain = renderToStaticMarkup(<ProfileOutcomeFeedback outcome={draft} />);
      expect(plain).toContain(draft.message);
      expect(plain).not.toContain("profile-outcome-failure");
      expect(plain).not.toContain("profile-outcome-empty");
    });

    it("hints at approval only when approval is the sole blocker", () => {
      const render = (props: {
        busy?: boolean;
        profileIdValid?: boolean;
        providerTransmissionApproved?: boolean;
        retry?: boolean;
      }) =>
        renderToStaticMarkup(
          <ProfileGenerationAction
            outcome={
              props.retry === true
                ? failureOutcome
                : projectCanonicalCandidateProfileOutcome(null, "profile-1", null)
            }
            profileIdValid={props.profileIdValid ?? true}
            providerTransmissionApproved={props.providerTransmissionApproved ?? false}
            busy={props.busy ?? false}
            onApprovalChange={() => undefined}
            onDerive={() => undefined}
          />,
        );
      expect(render({ retry: true })).toContain("Tick the approval box to enable Retry.");
      expect(render({})).toContain("Tick the approval box to generate.");
      expect(render({ retry: true, busy: true })).not.toContain("Tick the approval box");
      expect(render({ retry: true, profileIdValid: false })).not.toContain("Tick the approval box");
      expect(render({ retry: true, providerTransmissionApproved: true })).not.toContain(
        "Tick the approval box",
      );
    });
  });

  it("keeps progress and cancel optional and offers no Cancel while idle", () => {
    const base = {
      deriveCanonicalCandidateProfile: vi.fn(async () => record()),
      getCanonicalCandidateProfile: vi.fn(async () => record()),
      listCanonicalCandidateProfileVersions: vi.fn(async () => ({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        versions: [record()],
      })),
      editCanonicalCandidateProfile: vi.fn(async () => record()),
      reviewCanonicalCandidateProfile: vi.fn(async () => record("reviewed")),
    };
    const withGenerationControls = {
      ...base,
      getCanonicalCandidateProfileProgress: vi.fn(async () => ({ active: false })),
      cancelCanonicalCandidateProfileGeneration: vi.fn(async () => ({ cancelled: false })),
    };
    expect(hasCanonicalCandidateProfileCapabilities(base)).toBe(true);
    expect(hasCanonicalCandidateProfileCapabilities(withGenerationControls)).toBe(true);
    const html = renderToStaticMarkup(
      <ProfileWorkspace
        workspaceId="workspace-1"
        capabilities={withGenerationControls}
        selectedProfile={null}
        onSelectionChange={() => undefined}
      />,
    );
    expect(html).not.toContain("Cancel generation");
    expect(withGenerationControls.getCanonicalCandidateProfileProgress).not.toHaveBeenCalled();
  });

  it("labels the generate button by whether generation or another operation is pending", () => {
    const outcome = projectCanonicalCandidateProfileOutcome(null, "profile-1", null);
    const render = (props: { busy: boolean; generating?: boolean }) =>
      renderToStaticMarkup(
        <ProfileGenerationAction
          outcome={outcome}
          profileIdValid
          providerTransmissionApproved
          onApprovalChange={() => undefined}
          onDerive={() => undefined}
          {...props}
        />,
      );

    const generating = render({ busy: true, generating: true });
    expect(generating).toContain("Generating…");
    expect(generating).not.toContain("Working…");
    expect(generating).toContain('disabled=""');

    const otherBusy = render({ busy: true });
    expect(otherBusy).toContain("Working…");
    expect(otherBusy).not.toContain("Generating…");
    expect(otherBusy).toContain('disabled=""');

    const idle = render({ busy: false });
    expect(idle).toContain("Derive profile");
    expect(idle).not.toContain("Working…");
    expect(idle).not.toContain("Generating…");
  });

  it("disables review for empty facts and for open warning issues", () => {
    const emptyRecord = { ...record(), facts: [] };
    const emptyMarkup = renderToStaticMarkup(
      <ProfileDetails
        record={emptyRecord}
        history={[emptyRecord]}
        draftFacts={[]}
        draftIssues={[]}
        editable
        busy={false}
        onFactValueChange={() => undefined}
        onRemoveFact={() => undefined}
        onIssueStatusChange={() => undefined}
        onSave={() => undefined}
        onReview={() => undefined}
      />,
    );
    const warning: CanonicalCandidateProfileIssueResult = {
      id: "issue-open-warning",
      code: "duplicate",
      severity: "warning",
      status: "open",
      message: "Confirm whether these facts are duplicates.",
      factIds: [],
      sourceRefs: [],
    };
    const warningMarkup = renderToStaticMarkup(
      <ProfileDetails
        record={record()}
        history={[record()]}
        draftFacts={facts}
        draftIssues={[...issues.slice(1), warning]}
        editable
        busy={false}
        onFactValueChange={() => undefined}
        onRemoveFact={() => undefined}
        onIssueStatusChange={() => undefined}
        onSave={() => undefined}
        onReview={() => undefined}
      />,
    );

    expect(emptyMarkup).toContain("Mark latest draft reviewed");
    expect(emptyMarkup).toMatch(/<button[^>]*disabled=""[^>]*>Mark latest draft reviewed/u);
    expect(warningMarkup).toMatch(/<button[^>]*disabled=""[^>]*>Mark latest draft reviewed/u);
  });

  it("renders an accessible, path-free approval gate only for complete capabilities", () => {
    const capabilities = {
      deriveCanonicalCandidateProfile: vi.fn(async () => record()),
      getCanonicalCandidateProfile: vi.fn(async () => record()),
      listCanonicalCandidateProfileVersions: vi.fn(async () => ({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        versions: [record()],
      })),
      editCanonicalCandidateProfile: vi.fn(async () => record()),
      reviewCanonicalCandidateProfile: vi.fn(async () => record("reviewed")),
    };
    expect(hasCanonicalCandidateProfileCapabilities(capabilities)).toBe(true);
    const html = renderToStaticMarkup(
      <ProfileWorkspace
        workspaceId="workspace-1"
        capabilities={capabilities}
        selectedProfile={null}
        onSelectionChange={() => undefined}
      />,
    );
    expect(html).toContain('aria-labelledby="canonical-profile-title"');
    expect(html).toContain('aria-label="Profile name"');
    expect(html).toContain("Profile name");
    expect(html).toContain('placeholder="e.g. senior-data-engineer-cv"');
    expect(html).toContain(
      "Choose a name for this profile: letters, digits, dots, dashes, or underscores. Approval",
    );
    expect(html).toContain("I approve sending selected candidate material");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("candidateKnowledgeSelection");
    expect(html).not.toContain("storeRoot");
    expect(html).not.toContain("/private");
    expect(
      renderToStaticMarkup(
        <ProfileWorkspace
          workspaceId="workspace-1"
          capabilities={{ getCanonicalCandidateProfile: capabilities.getCanonicalCandidateProfile }}
          selectedProfile={null}
          onSelectionChange={() => undefined}
        />,
      ),
    ).toBe("");
  });

  it("shows the optional reviewed-profile picker without changing the legacy profile gate", () => {
    const capabilities = {
      deriveCanonicalCandidateProfile: vi.fn(async () => record()),
      getCanonicalCandidateProfile: vi.fn(async () => record("reviewed")),
      listCanonicalCandidateProfileVersions: vi.fn(async () => ({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        versions: [record("reviewed")],
      })),
      editCanonicalCandidateProfile: vi.fn(async () => record()),
      reviewCanonicalCandidateProfile: vi.fn(async () => record("reviewed")),
      listReviewedCanonicalCandidateProfiles: vi.fn(async () => ({
        workspaceId: "workspace-1",
        profiles: [{ profileId: "profile-1", version: 1, reviewedAt: capturedAt }],
      })),
    };
    const markup = renderToStaticMarkup(
      <ProfileWorkspace
        workspaceId="workspace-1"
        capabilities={capabilities}
        selectedProfile={null}
        onSelectionChange={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Existing reviewed profiles"');
    expect(markup).toContain("Choose a reviewed profile…");
    expect(markup).toContain("Source compatibility is checked again before starting a review.");
    expect(markup).toContain("Loading reviewed profiles…");
  });

  it("renders the saved-profile picker newest first with name, version, and status", () => {
    const markup = renderToStaticMarkup(
      <SavedProfilePicker
        summaries={[
          { profileId: "writer", latestVersion: 3, status: "draft", updatedAt: capturedAt },
          {
            profileId: "engineer",
            latestVersion: 1,
            status: "reviewed",
            updatedAt: capturedAt,
            reviewedVersion: 1,
          },
        ]}
        currentName="engineer"
        disabled={false}
        onChoose={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Saved profiles"');
    expect(markup).toContain("Choose a saved profile…");
    expect(markup.indexOf("writer · v3 · draft")).toBeGreaterThan(-1);
    expect(markup.indexOf("writer · v3 · draft")).toBeLessThan(
      markup.indexOf("engineer · v1 · reviewed"),
    );
    expect(markup).toMatch(/<option value="engineer" selected/u);
    expect(
      renderToStaticMarkup(
        <SavedProfilePicker
          summaries={[]}
          currentName=""
          disabled={false}
          onChoose={() => undefined}
        />,
      ),
    ).toBe("");
  });
});
