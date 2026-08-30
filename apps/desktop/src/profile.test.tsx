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
  ProfileWorkspace,
  safeCanonicalCandidateProfileText,
} from "./profile.js";

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
    expect(candidateProfileSelectionForRecord(record("reviewed"))).toEqual({
      profileId: "profile-1",
      version: 1,
    });
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
    expect(html).toContain("approved-link");
    expect(html).toContain("Issues by severity and status");
    expect(html).toContain("conflict-date");
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
    expect(html).toContain('aria-label="Opaque profile ID"');
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
});
