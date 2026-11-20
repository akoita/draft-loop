import type { CanonicalCandidateProfile } from "@draft-loop/domain";
import { emptyFactUsageSettings } from "@draft-loop/domain/fact-usage";
import { createMemoryFactSuggestionStore } from "@draft-loop/storage/fact-suggestions";
import { describe, expect, it } from "vitest";

import { fileAgentProfileSuggestion, latestReviewedProfile } from "./agent-profile-suggestions.js";

// Fictional facts only.
function profile(version: number, status: "draft" | "reviewed", reviewedAt?: string) {
  return {
    id: "career",
    version,
    status,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
    facts: [
      {
        id: "fact-team",
        category: "achievement",
        field: "team size",
        value: "Led a team of 5",
        provenance: [],
      },
    ],
    issues: [],
  } as unknown as CanonicalCandidateProfile;
}

const reviewed = profile(2, "reviewed", "2026-11-03T00:00:00.000Z");
let counter = 0;
const newId = () => {
  counter += 1;
  return `fsg_unit${String(counter).padStart(8, "0")}`;
};

describe("agent profile suggestions (#3072)", () => {
  it("picks the newest reviewed version", () => {
    const older = profile(1, "reviewed", "2026-11-02T00:00:00.000Z");
    expect(latestReviewedProfile([older, reviewed, profile(3, "draft")])?.version).toBe(2);
    expect(latestReviewedProfile([profile(3, "draft")])).toBeUndefined();
  });

  it("answers a change the person rejected as previously rejected", async () => {
    const store = createMemoryFactSuggestionStore();
    const file = () =>
      fileAgentProfileSuggestion({
        store,
        workspaceId: "owner",
        profile: reviewed,
        usage: emptyFactUsageSettings,
        agentTokenId: "dlat_agent0001",
        input: {
          factId: "fact-team",
          change: { kind: "retire" },
          quote: "Left.",
          speaker: "agent",
        },
        newId,
      });
    const first = await file();
    const stored = await store.get("owner", first.suggestionId);
    if (stored === undefined) throw new Error("not stored");
    await store.decide("owner", {
      ...stored,
      status: "rejected",
      decision: { role: "candidate", memberId: "owner", decidedAt: "2026-11-04T00:00:00.000Z" },
    });
    expect(await file()).toMatchObject({ status: "previously_rejected" });
  });

  it("limits how many suggestions one agent files in an hour", async () => {
    const store = createMemoryFactSuggestionStore();
    const file = (value: string, agentTokenId = "dlat_agent0001") =>
      fileAgentProfileSuggestion({
        store,
        workspaceId: "owner",
        profile: reviewed,
        usage: emptyFactUsageSettings,
        agentTokenId,
        input: {
          change: { kind: "add", category: "skill", field: "language", value },
          quote: `I use ${value}.`,
          speaker: "candidate",
        },
        limits: { perHour: 2, pendingPerProfile: 10 },
        newId,
      });
    await file("Rust");
    await file("Go");
    await expect(file("Zig")).rejects.toMatchObject({ code: "rate_limited" });
    expect(await file("Zig", "dlat_agent0002")).toMatchObject({ status: "pending" });
  });
});
