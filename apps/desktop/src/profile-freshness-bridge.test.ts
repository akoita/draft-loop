import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";

/*
 * Drift proof: real payloads go through the real validator and normalizer, so a field added to an
 * interface but not to the runtime allowlist fails here instead of in the app.
 */

const base: ProfileFreshnessResult = {
  workspaceId: "workspace-1",
  profileId: "profile-1",
  state: "up-to-date",
  version: 3,
  reviewedVersion: null,
  newSourceCount: 0,
  changedSourceCount: 0,
  removedSourceCount: 0,
};

const answers: readonly ProfileFreshnessResult[] = [
  { ...base, state: "not-generated", version: null },
  base,
  { ...base, state: "update-available", newSourceCount: 2, changedSourceCount: 1 },
  { ...base, state: "update-available", removedSourceCount: 1 },
  { ...base, state: "review-pending", version: 4, reviewedVersion: 3 },
  { ...base, state: "review-pending", version: 1 },
  { ...base, state: "unavailable" },
];

const command = {
  type: "profile.freshness",
  input: { workspaceId: "workspace-1", profileId: "profile-1" },
} as const;

function portReturning(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: [...bridgeCapabilities],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge);
}

describe("profile.freshness bridge command", () => {
  it("is advertised", () => {
    expect(bridgeCapabilities).toContain("profile.freshness");
  });

  it("accepts exactly the documented input", () => {
    expect(validateBridgeCommand(command)).toEqual(command);
  });

  it("rejects extra keys, missing keys, paths and bad ids", () => {
    for (const input of [
      {},
      { workspaceId: "workspace-1" },
      { profileId: "profile-1" },
      { workspaceId: "workspace-1", profileId: "profile-1", path: "/private" },
      { workspaceId: "workspace-1", profileId: "../profile" },
      { workspaceId: "", profileId: "profile-1" },
    ]) {
      expect(() => validateBridgeCommand({ type: "profile.freshness", input })).toThrow();
    }
  });

  it("accepts a real answer for every state unchanged", async () => {
    for (const answer of answers) {
      await expect(portReturning(answer).execute(command)).resolves.toEqual({
        ok: true,
        value: answer,
      });
    }
  });

  it("rejects an answer with an extra, missing or path-bearing field", async () => {
    const { removedSourceCount: _omitted, ...withoutCount } = base;
    for (const answer of [
      { ...base, sourcePath: "/home/me/cv.md" },
      { ...base, sources: ["cv.md"] },
      withoutCount,
      { ...base, state: "stale" },
      { ...base, version: 0 },
      { ...base, newSourceCount: -1 },
    ]) {
      await expect(portReturning(answer).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects an answer whose fields contradict its state", async () => {
    for (const answer of [
      { ...base, state: "not-generated" },
      { ...base, state: "up-to-date", version: null },
      { ...base, state: "up-to-date", newSourceCount: 1 },
      { ...base, state: "update-available" },
      { ...base, state: "up-to-date", reviewedVersion: 2 },
      { ...base, state: "review-pending", version: 3, reviewedVersion: 3 },
    ]) {
      await expect(portReturning(answer).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects an answer for another workspace shape", async () => {
    await expect(
      portReturning({ ...base, workspaceId: "bad id" }).execute(command),
    ).resolves.toMatchObject({ ok: false });
  });
});
