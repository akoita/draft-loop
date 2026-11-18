import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { queueLiveBriefExtraction } from "./brief-extraction.js";
import {
  createBriefExtractionAllowance,
  defaultBriefExtractionsPerDay,
  readBriefExtractionsPerDay,
} from "./brief-extraction-allowance.js";
import type { TenantEntitlements } from "./entitlement-gate.js";

const now = new Date("2026-11-18T10:00:00Z");

function request(caller: unknown) {
  const warnings: Record<string, unknown>[] = [];
  return {
    warnings,
    request: {
      caller,
      log: { warn: (fields: Record<string, unknown>) => warnings.push(fields) },
    } as unknown as FastifyRequest,
  };
}

/** One organisation whose meter allows `used < limit`, recording each limit it is asked for. */
function tenant(modelCallsPerDay: number | null | "no-plan", used: number) {
  const limits: number[] = [];
  const value = {
    entitlements: async () => (modelCallsPerDay === "no-plan" ? undefined : { modelCallsPerDay }),
    modelCalls: {
      used: async () => used,
      take: async ({ limit }: { limit: number }) => {
        limits.push(limit);
        return used < limit ? { allowed: true, used: used + 1 } : { allowed: false, used };
      },
    },
  } as unknown as TenantEntitlements;
  return { value, limits };
}

const member = { kind: "member", tenantId: "org-1", memberId: "member-1" };

describe("the brief extraction allowance", () => {
  it("counts against the plan's daily model calls when the plan has a limit", async () => {
    const org = tenant(20, 3);
    const allow = createBriefExtractionAllowance({
      entitlementsFor: () => org.value,
      now: () => now,
    });
    expect(await allow.take(request(member).request)).toBe(true);
    expect(org.limits).toEqual([20]);
  });

  it("applies the deployment ceiling to an unlimited plan, and logs ids only when refused", async () => {
    const org = tenant(null, 7);
    const allow = createBriefExtractionAllowance({
      entitlementsFor: () => org.value,
      unlimitedPlanPerDay: 7,
      now: () => now,
    });
    const { request: refused, warnings } = request(member);
    expect(await allow.take(refused)).toBe(false);
    expect(org.limits).toEqual([7]);
    expect(warnings).toEqual([
      {
        event: "brief_extraction_limited",
        organisationId: "org-1",
        memberId: "member-1",
        limit: 7,
        plan: "unlimited",
      },
    ]);
  });

  it("says the day is spent without taking from it", async () => {
    const full = tenant(20, 20);
    const allow = createBriefExtractionAllowance({ entitlementsFor: () => full.value });
    expect(await allow.spent(request(member).request)).toBe(true);
    expect(full.limits).toEqual([]);
    const open = tenant(null, 3);
    const openAllow = createBriefExtractionAllowance({ entitlementsFor: () => open.value });
    expect(await openAllow.spent(request(member).request)).toBe(false);
    expect(await openAllow.spent(request({ kind: "owner" }).request)).toBe(false);
  });

  it("counts nothing for the owner token or an organisation with no plan", async () => {
    const noPlan = tenant("no-plan", 0);
    const allow = createBriefExtractionAllowance({ entitlementsFor: () => noPlan.value });
    expect(await allow.take(request({ kind: "owner" }).request)).toBe(true);
    expect(await allow.take(request(member).request)).toBe(true);
    expect(noPlan.limits).toEqual([]);
  });

  it("reads the ceiling from the environment", () => {
    expect(defaultBriefExtractionsPerDay).toBe(50);
    expect(readBriefExtractionsPerDay({})).toBeUndefined();
    expect(readBriefExtractionsPerDay({ DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY: "12" })).toBe(12);
    expect(() =>
      readBriefExtractionsPerDay({ DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY: "0" }),
    ).toThrow();
  });
});

describe("queueing a live brief under the allowance", () => {
  const brief = {
    id: "brief-1",
    version: 1,
    role: null,
    requirements: [],
    sources: [{ id: "posting", classification: "job-posting" }],
  };
  const input = (allowed: boolean, verdict: "clear" | "flagged", asked: string[]) => {
    const queued: unknown[] = [];
    return {
      queued,
      input: {
        extractions: {
          queue: async (job: unknown) => {
            queued.push(job);
            return true;
          },
          state: async () => undefined,
        },
        workspaceId: "r1",
        workspace: { fixtureMode: false },
        applicationId: "app-1",
        record: { brief } as never,
        screening: { verdict, sources: [{ sourceId: "posting", verdict }] } as never,
        log: { warn: () => undefined } as never,
        allowance: async () => {
          asked.push("asked");
          return allowed;
        },
      },
    };
  };

  it("leaves the brief for the person when the allowance is spent", async () => {
    const asked: string[] = [];
    const { input: spent, queued } = input(false, "clear", asked);
    expect(await queueLiveBriefExtraction(spent)).toBe("limited");
    expect(queued).toEqual([]);
    const { input: open, queued: queuedOpen } = input(true, "clear", asked);
    expect(await queueLiveBriefExtraction(open)).toBe("pending");
    expect(queuedOpen).toHaveLength(1);
  });

  it("takes nothing from the allowance for a brief it would not queue", async () => {
    const asked: string[] = [];
    const { input: flagged } = input(true, "flagged", asked);
    expect(await queueLiveBriefExtraction(flagged)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
