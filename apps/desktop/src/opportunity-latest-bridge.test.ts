import { describe, expect, it } from "vitest";

import {
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { createBridgeReviewPort } from "./native.js";

const latest = {
  workspaceId: "workspace-1",
  briefId: "target-role",
  version: 2,
  status: "draft",
  requirementCount: 5,
  criticalCount: 2,
};

function bridge(
  invoke: NativeBridge["invoke"],
  capabilities: NativeBridge["capabilities"] = bridgeCapabilities,
): NativeBridge {
  return { capabilities, invoke };
}

describe("opportunity.latest bridge command", () => {
  it("is exposed and validated at runtime, not only typed", () => {
    // Drift guard: the allowlist line and the validator case must both exist.
    expect(bridgeCapabilities).toContain("opportunity.latest");
    const command = { type: "opportunity.latest" as const, input: { workspaceId: "workspace-1" } };
    expect(validateBridgeCommand(command)).toEqual(command);
    for (const input of [
      {},
      { workspaceId: "workspace-1", briefId: "target-role" },
      { workspaceId: "workspace-1", root: "/private" },
      "workspace-1",
    ]) {
      expect(() => validateBridgeCommand({ type: "opportunity.latest", input })).toThrow("invalid");
    }
  });

  it("normalizes a real payload and rejects malformed or content-bearing ones", async () => {
    const respond = (value: unknown) =>
      createCapabilityPort(
        bridge(async () => ({ ok: true, value }), ["opportunity.latest"]),
      ).execute({ type: "opportunity.latest", input: { workspaceId: "workspace-1" } });
    await expect(respond(latest)).resolves.toEqual({ ok: true, value: latest });
    await expect(respond(null)).resolves.toEqual({ ok: true, value: null });
    for (const malformed of [
      { ...latest, status: "published" },
      { ...latest, requirementCount: -1 },
      { ...latest, criticalCount: 6 },
      { ...latest, version: 0 },
      { ...latest, requirements: [{ text: "private" }] },
      { briefId: "target-role" },
      "target-role",
    ]) {
      await expect(respond(malformed)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("reaches the renderer port as getLatestOpportunity only when the capability exists", async () => {
    const state = { ...createFixtureReviewState(), workspaceId: "workspace-1" };
    const invoke = async (command: { type: string }) =>
      command.type === "review.load"
        ? { ok: true as const, value: state }
        : { ok: true as const, value: latest };
    const withCapability = createBridgeReviewPort(
      createCapabilityPort(bridge(invoke as never, ["review.load", "opportunity.latest"])),
    );
    await expect(withCapability.getLatestOpportunity?.()).resolves.toEqual(latest);
    const without = createBridgeReviewPort(
      createCapabilityPort(bridge(invoke as never, ["review.load"])),
    );
    expect(without.getLatestOpportunity).toBeUndefined();
  });
});

describe("start and setup contract for the requirements source", () => {
  const action = (extra: Record<string, unknown>) => ({
    type: "review.dispatch" as const,
    input: { workspaceId: "workspace-1", runId: "pending", action: { type: "start", ...extra } },
  });

  it("accepts only the job-description requirements source on start", () => {
    expect(validateBridgeCommand(action({ requirementsSource: "job-description" }))).toMatchObject({
      input: { action: { requirementsSource: "job-description" } },
    });
    expect(validateBridgeCommand(action({}))).toEqual(action({}));
    expect(() => validateBridgeCommand(action({ requirementsSource: "brief" }))).toThrow("invalid");
    expect(() =>
      validateBridgeCommand(action({ opportunityBrief: { briefId: "b", version: 1 } })),
    ).toThrow("invalid");
  });

  it("carries the raw-job refusal through the review state", async () => {
    const setup = {
      ...createFixtureReviewState().setup,
      jobRequirementProblem: "Requirement 1 in the job description has 196 words.",
    };
    const state = { ...createFixtureReviewState(), setup };
    const port = createBridgeReviewPort(
      createCapabilityPort(bridge(async () => ({ ok: true, value: state }), ["review.load"])),
    );
    await expect(port.load()).resolves.toMatchObject({
      setup: { jobRequirementProblem: "Requirement 1 in the job description has 196 words." },
    });
    const rejecting = createBridgeReviewPort(
      createCapabilityPort(
        bridge(
          async () => ({
            ok: true,
            value: { ...state, setup: { ...setup, jobRequirementProblem: 7 } },
          }),
          ["review.load"],
        ),
      ),
    );
    await expect(rejecting.load()).rejects.toThrow();
  });
});
