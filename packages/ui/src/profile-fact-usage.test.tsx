import { factUsageKey } from "@draft-loop/domain/fact-usage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileRecordResult,
  CapabilityPort,
} from "./bridge.js";
import { createFactUsageCapabilities } from "./fact-usage-capabilities.js";
import { normalizeFactUsageResult, validateFactUsageSetInput } from "./fact-usage-contract.js";
import { ProfileDetails } from "./profile.js";
import type { ProfileFactUsageControls } from "./profile-fact-usage.js";

const provenance = {
  storeId: "store-1",
  knowledgeBaseId: "ckb-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};
const role: CanonicalCandidateProfileFactResult = {
  id: "fact-role",
  category: "role",
  field: "title",
  value: "Platform engineer",
  provenance: [provenance],
};
const skill: CanonicalCandidateProfileFactResult = {
  id: "fact-skill",
  category: "skill",
  field: "language",
  value: "TypeScript",
  provenance: [provenance],
};

function record(): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    reviewedAt: null,
    checksum: "a".repeat(64),
    facts: [role, skill],
    issues: [],
  };
}

function details(usage?: ProfileFactUsageControls) {
  return renderToStaticMarkup(
    <ProfileDetails
      record={record()}
      draftFacts={[role, skill]}
      draftIssues={[]}
      editable
      busy={false}
      usage={usage}
      onFactValueChange={() => undefined}
      onRemoveFact={() => undefined}
      onIssueStatusChange={() => undefined}
      onSave={() => undefined}
      onReview={() => undefined}
    />,
  );
}

describe("usage level on the career profile", () => {
  it("shows no usage controls on a host without them", () => {
    expect(details()).not.toContain("Usage for");
  });

  it("shows each fact's and section's level beside the facts, and says it is not sensitivity", () => {
    const html = details({
      view: { sections: { skill: "interview-only" }, facts: { [factUsageKey(role)]: "never-say" } },
      pending: false,
      change: () => undefined,
    });
    expect(html).toContain("separate from sensitivity");
    expect(html).toContain('aria-label="Usage for Title"');
    expect(html).toMatch(/<option value="never-say" selected="">Never say<\/option>/u);
    expect(html).toContain("Like section (Interview only)");
    expect(html).toContain('aria-label="Usage for Skill section"');
    expect(html).toContain("profile-usage-never-say");
  });

  it("crosses the bridge by key and refuses fact text", () => {
    const key = factUsageKey(role);
    expect(
      validateFactUsageSetInput({ workspaceId: "w", change: { kind: "fact", key, level: null } }),
    ).toEqual({ workspaceId: "w", change: { kind: "fact", key, level: null } });
    expect(
      validateFactUsageSetInput({
        workspaceId: "w",
        change: { kind: "fact", key: "Platform engineer", level: "cv" },
      }),
    ).toBeUndefined();
    expect(
      normalizeFactUsageResult({
        workspaceId: "w",
        usage: { sections: { salary: "cv" }, facts: {} },
      }),
    ).toBeUndefined();
  });

  it("offers usage capabilities only when the host serves both commands", async () => {
    const executed: unknown[] = [];
    const port = (capabilities: readonly string[]): CapabilityPort =>
      ({
        capabilities,
        hasCapability: (name: string) => capabilities.includes(name),
        execute: async (command: unknown) => {
          executed.push(command);
          return { ok: true, value: { workspaceId: "w", usage: { sections: {}, facts: {} } } };
        },
      }) as unknown as CapabilityPort;
    const unwrap = <Value,>(result: { ok: boolean; value?: Value }) => result.value as Value;
    expect(createFactUsageCapabilities(port(["fact-usage.get"]), unwrap as never)).toBeUndefined();
    const capabilities = createFactUsageCapabilities(
      port(["fact-usage.get", "fact-usage.set"]),
      unwrap as never,
    );
    await capabilities?.setFactUsage("w", { kind: "section", category: "skill", level: null });
    expect(executed).toEqual([
      {
        type: "fact-usage.set",
        input: { workspaceId: "w", change: { kind: "section", category: "skill", level: null } },
      },
    ]);
  });
});
