import { describe, expect, it } from "vitest";

import {
  type BridgeCommand,
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createBridgeReviewPort } from "./native.js";

const commands = [
  "knowledge.ensure-default",
  "workspace.evidence-migration.get",
  "workspace.evidence-migration.decline",
] as const;

function bridge(invoke: NativeBridge["invoke"]): NativeBridge {
  return { capabilities: bridgeCapabilities, invoke };
}

async function respond(command: BridgeCommand, value: unknown) {
  return createCapabilityPort(bridge(async () => ({ ok: true, value }))).execute(command);
}

const ensured = {
  storeId: "store-1",
  knowledgeBaseId: "base-1",
  displayName: "Career evidence",
  created: true,
};

describe("career evidence bridge commands", () => {
  it("advertises every command as a capability", () => {
    expect(bridgeCapabilities).toEqual(expect.arrayContaining([...commands]));
  });

  it("accepts the real payload of every command", () => {
    for (const type of commands) {
      expect(validateBridgeCommand({ type, input: { workspaceId: "workspace-1" } })).toEqual({
        type,
        input: { workspaceId: "workspace-1" },
      });
    }
  });

  it("rejects extra keys, a missing workspace, and paths", () => {
    for (const type of commands) {
      for (const input of [
        {},
        { workspaceId: "workspace-1", storeRoot: "/private/store" },
        { workspaceId: "workspace-1", declined: true },
        { workspaceId: "" },
        "workspace-1",
      ]) {
        expect(() => validateBridgeCommand({ type, input })).toThrow("invalid");
      }
    }
  });

  it("accepts the real result of ensure-default and rejects a leaked path", async () => {
    const command = { type: "knowledge.ensure-default", input: { workspaceId: "workspace-1" } };
    await expect(respond(command as BridgeCommand, ensured)).resolves.toEqual({
      ok: true,
      value: ensured,
    });
    await expect(
      respond(command as BridgeCommand, { ...ensured, storeRoot: "/private/store" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    await expect(
      respond(command as BridgeCommand, { ...ensured, created: "yes" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("accepts the real result of the migration decision commands", async () => {
    const value = { workspaceId: "workspace-1", declined: true };
    for (const type of [
      "workspace.evidence-migration.get",
      "workspace.evidence-migration.decline",
    ]) {
      const command = { type, input: { workspaceId: "workspace-1" } } as BridgeCommand;
      await expect(respond(command, value)).resolves.toEqual({ ok: true, value });
      await expect(respond(command, { ...value, path: "/private" })).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("exposes the commands to the renderer only when the host advertises them", async () => {
    const calls: BridgeCommand[] = [];
    const port = createBridgeReviewPort(
      createCapabilityPort(
        bridge(async (command) => {
          calls.push(command);
          return { ok: true, value: ensured };
        }),
      ),
    );
    await expect(port.ensureDefaultCandidateKnowledgeBase?.("workspace-1")).resolves.toEqual(
      ensured,
    );
    expect(calls).toEqual([
      { type: "knowledge.ensure-default", input: { workspaceId: "workspace-1" } },
    ]);
    const without = createBridgeReviewPort(
      createCapabilityPort({
        capabilities: bridgeCapabilities.filter((name) => !commands.some((c) => c === name)),
        invoke: async () => ({ ok: true, value: ensured }),
      }),
    );
    expect(without.ensureDefaultCandidateKnowledgeBase).toBeUndefined();
    expect(without.getLegacyEvidenceMigration).toBeUndefined();
    expect(without.declineLegacyEvidenceMigration).toBeUndefined();
  });
});
