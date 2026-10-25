import type { ApplicationService } from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import {
  type BriefExtractionHandlerOptions,
  type BriefExtractionJobOutcome,
  createBriefExtractionHandler,
} from "./brief-extraction-handler.js";

const job = {
  tenantId: "tenant-a",
  workspaceId: "workspace-1",
  applicationId: "app-1",
  briefId: "brief-1",
  version: 1,
};

type Extract = NonNullable<ApplicationService["extractApplicationBrief"]>;

async function handle(
  outcome: Awaited<ReturnType<Extract>>["outcome"],
  options: Partial<BriefExtractionHandlerOptions> = {},
) {
  const extractApplicationBrief = vi.fn<Extract>(async () => ({ outcome }));
  const outcomes: BriefExtractionJobOutcome[] = [];
  const handler = createBriefExtractionHandler({
    serviceFor: () => ({ extractApplicationBrief }),
    workspaceRoot: (queued) => `/tenants/${queued.tenantId}/workspaces/${queued.workspaceId}`,
    allowProviderData: true,
    onOutcome: (_job, value) => outcomes.push(value),
    ...options,
  });
  await handler(job);
  return { extractApplicationBrief, outcome: outcomes[0] };
}

describe("brief extraction job handler", () => {
  it("extracts the queued brief version in the job's workspace", async () => {
    const { extractApplicationBrief, outcome } = await handle("extracted");

    expect(outcome).toBe("extracted");
    expect(extractApplicationBrief).toHaveBeenCalledWith({
      root: "/tenants/tenant-a/workspaces/workspace-1",
      applicationId: "app-1",
      briefId: "brief-1",
      expectedVersion: 1,
      allowProviderData: true,
    });
  });

  it.each(["brief-moved", "job-text-changed", "missing"] as const)(
    "reports a brief the service left as it was (%s)",
    async (left) => {
      expect((await handle(left)).outcome).toBe(left);
    },
  );

  it("passes the deployment's provider data policy, never assuming it", async () => {
    const { extractApplicationBrief } = await handle("provider-data-refused", {
      allowProviderData: false,
    });

    expect(extractApplicationBrief).toHaveBeenCalledWith(
      expect.objectContaining({ allowProviderData: false }),
    );
  });

  it("ends without a provider call when the record's consent does not cover its providers", async () => {
    const consentFor = vi.fn(async () => false);
    const { extractApplicationBrief, outcome } = await handle("extracted", { consentFor });

    expect(outcome).toBe("consent-required");
    expect(consentFor).toHaveBeenCalledWith(job);
    expect(extractApplicationBrief).not.toHaveBeenCalled();
  });

  it("ends before anything else when the record is erased", async () => {
    const consentFor = vi.fn(async () => true);
    const { extractApplicationBrief, outcome } = await handle("extracted", {
      recordErased: async () => true,
      consentFor,
    });

    expect(outcome).toBe("record-erased");
    expect(consentFor).not.toHaveBeenCalled();
    expect(extractApplicationBrief).not.toHaveBeenCalled();
  });

  it("fails the attempt when the service throws, so the queue retries it", async () => {
    const handler = createBriefExtractionHandler({
      serviceFor: () => ({
        extractApplicationBrief: async () => {
          throw new Error("connection lost");
        },
      }),
      workspaceRoot: () => "/tenants/tenant-a/workspaces/workspace-1",
      allowProviderData: true,
    });

    await expect(handler(job)).rejects.toThrow("connection lost");
  });
});
