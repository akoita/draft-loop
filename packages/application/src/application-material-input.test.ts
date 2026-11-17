import { describe, expect, it } from "vitest";

import {
  type ApplicationMaterialRecordService,
  applicationMaterialRecordInput,
} from "./application-material-input.js";

/** Invented profile versions; only the fields the input reads. */
function version(number: number, status: "draft" | "reviewed", updatedAt: string, title: string) {
  return {
    profile: {
      version: number,
      status,
      updatedAt,
      facts: [{ id: `t${number}`, category: "role", field: "title", value: title }],
    },
  };
}

function service(versions: ReturnType<typeof version>[]): ApplicationMaterialRecordService {
  return {
    listCanonicalCandidateProfileVersions: async () => versions,
    getOpportunity: async () => undefined,
  } as unknown as ApplicationMaterialRecordService;
}

const input = (versions: ReturnType<typeof version>[]) =>
  applicationMaterialRecordInput({ service: service(versions), root: "r", briefId: undefined });

describe("the career profile version material is drafted from (#2816)", () => {
  it("uses the last reviewed version and says a newer draft waits", async () => {
    const result = await input([
      version(1, "reviewed", "2026-11-01T00:00:00.000Z", "Analyst"),
      version(2, "draft", "2026-11-02T00:00:00.000Z", "Lead Analyst"),
    ]);
    expect(result.facts.map((fact) => fact.value)).toEqual(["Analyst"]);
    expect(result.profile).toEqual({ version: 1, reviewed: true, newerDraftWaiting: true });
  });

  it("uses the newest version when it is the reviewed one", async () => {
    const result = await input([
      version(1, "reviewed", "2026-11-01T00:00:00.000Z", "Analyst"),
      version(2, "reviewed", "2026-11-02T00:00:00.000Z", "Lead Analyst"),
    ]);
    expect(result.facts.map((fact) => fact.value)).toEqual(["Lead Analyst"]);
    expect(result.profile).toEqual({ version: 2, reviewed: true, newerDraftWaiting: false });
  });

  it("uses the newest draft before any version is reviewed, and says so", async () => {
    const result = await input([version(1, "draft", "2026-11-01T00:00:00.000Z", "Analyst")]);
    expect(result.facts.map((fact) => fact.value)).toEqual(["Analyst"]);
    expect(result.profile).toEqual({ version: 1, reviewed: false, newerDraftWaiting: false });
  });

  it("gives no profile source without a profile", async () => {
    const result = await input([]);
    expect(result.facts).toEqual([]);
    expect(result).not.toHaveProperty("profile");
  });
});
