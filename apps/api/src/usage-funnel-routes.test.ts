import type {
  OrganisationMilestones,
  UsageFunnelSource,
} from "@draft-loop/application/usage-funnel";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

const reached: OrganisationMilestones = {
  memberSignIns: ["2026-11-17T09:00:00.000Z"],
  firsts: {
    signedIn: "2026-11-17T09:00:00.000Z",
    evidence: "2026-11-17T10:00:00.000Z",
    briefReviewed: null,
    draftFinished: null,
    approved: null,
    exported: null,
    prepared: null,
  },
  activity: ["2026-11-17T00:00:00.000Z"],
};

let app: Awaited<ReturnType<typeof buildApi>> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("the operator's usage funnel (#2834)", () => {
  it("answers counts only, for the weeks asked", async () => {
    const asked: string[] = [];
    const source: UsageFunnelSource = {
      organisations: async () => ["org-fictional-north", "org-fictional-south"],
      milestones: async (organisationId) => {
        asked.push(organisationId);
        return reached;
      },
    };
    app = await buildApi({ ownerToken, logger: false, usageFunnel: source });

    const response = await app.inject({
      method: "GET",
      url: "/v1/operator/usage-funnel?weeks=2",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(asked).toEqual(["org-fictional-north", "org-fictional-south"]);
    expect(body.organisations).toBe(2);
    expect(body.weeks).toHaveLength(2);
    expect(body.cohort[0]).toMatchObject({ step: "signedIn" });
    // No organisation, member or time of one appears in the report.
    expect(response.body).not.toContain("org-fictional");
    expect(response.body).not.toContain("2026-11-17T");
  });

  it("keeps the funnel from callers without the operator's credential", async () => {
    app = await buildApi({
      ownerToken,
      logger: false,
      usageFunnel: { organisations: async () => [], milestones: async () => reached },
    });

    const anonymous = await app.inject({ method: "GET", url: "/v1/operator/usage-funnel" });
    expect(anonymous.statusCode).toBe(401);
    const tooLong = await app.inject({
      method: "GET",
      url: "/v1/operator/usage-funnel?weeks=27",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});
