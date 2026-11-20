import type { BridgeCommand, CapabilityPort } from "@draft-loop/ui/bridge";
import { createBridgeReviewPort } from "@draft-loop/ui/native";
import { describe, expect, it } from "vitest";

import { hostedBridgeCapabilities } from "./http-bridge.js";

/**
 * The hosted web app must never send a command its bridge does not serve: the shared screens
 * would show the generic "not available" text, as the start checklist's Choose file did (#3125).
 */
describe("the shared screens over the hosted bridge", () => {
  it("send only commands the hosted bridge declares", async () => {
    const declared = new Set<string>(hostedBridgeCapabilities);
    const sent = new Set<string>();
    const port: CapabilityPort = {
      capabilities: hostedBridgeCapabilities,
      hasCapability: (capability) => declared.has(capability),
      execute: (async (command: BridgeCommand) => {
        sent.add(command.type);
        return { ok: false, error: { code: "capability-unavailable", message: "test" } };
      }) as CapabilityPort["execute"],
    };
    const review = createBridgeReviewPort(port) as unknown as Record<string, unknown>;

    for (const value of Object.values(review)) {
      if (typeof value !== "function") continue;
      try {
        await (value as (...args: unknown[]) => unknown)("w1", "a1", "r1", "x");
      } catch {
        // Each call fails on the refused command; only what it tried to send matters.
      }
    }

    expect(sent.size).toBeGreaterThan(0);
    expect([...sent].filter((type) => !declared.has(type))).toEqual([]);
  });

  it("offer no URL source", () => {
    const declared = new Set<string>(hostedBridgeCapabilities);
    const review = createBridgeReviewPort({
      capabilities: hostedBridgeCapabilities,
      hasCapability: (capability) => declared.has(capability),
      execute: (async () => ({ ok: false })) as unknown as CapabilityPort["execute"],
    });
    expect(review.addUrl).toBeUndefined();
  });
});
