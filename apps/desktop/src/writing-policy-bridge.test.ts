import { describe, expect, it, vi } from "vitest";
import {
  bridgeCapabilities,
  createCapabilityPort,
  maximumWritingPolicyContentBytes,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createBridgeReviewPort } from "./native.js";

const checksum = "a".repeat(64);

function bridge(
  invoke: NativeBridge["invoke"],
  capabilities: NativeBridge["capabilities"] = bridgeCapabilities,
): NativeBridge {
  return { capabilities, invoke };
}

describe("writing policy bridge commands", () => {
  it("declares both commands as capabilities", () => {
    expect(bridgeCapabilities).toEqual(
      expect.arrayContaining(["writing-policy.read", "writing-policy.save"]),
    );
  });

  // These send the real payloads the renderer builds through the runtime
  // allowlist, because the interface and the allowlist are separate lists and
  // only this path notices when one of them forgets a key.
  it("accepts the real read payload", () => {
    expect(
      validateBridgeCommand({ type: "writing-policy.read", input: { workspaceId: "ws-1" } }),
    ).toEqual({ type: "writing-policy.read", input: { workspaceId: "ws-1" } });
  });

  it("accepts the real save payload with every key intact", () => {
    const input = { workspaceId: "ws-1", content: "Tone: warm\n\n- No em dashes.\n" };
    expect(validateBridgeCommand({ type: "writing-policy.save", input })).toEqual({
      type: "writing-policy.save",
      input,
    });
  });

  it("refuses unknown keys and missing keys on both commands", () => {
    for (const command of [
      { type: "writing-policy.read", input: { workspaceId: "ws-1", content: "x" } },
      { type: "writing-policy.read", input: {} },
      { type: "writing-policy.save", input: { workspaceId: "ws-1", content: "x", activate: true } },
      { type: "writing-policy.save", input: { workspaceId: "ws-1" } },
      { type: "writing-policy.save", input: { content: "x" } },
      { type: "writing-policy.save", input: { workspaceId: "ws-1", content: 3 } },
      { type: "writing-policy.save", input: { workspaceId: "../etc", content: "x" } },
    ]) {
      expect(() => validateBridgeCommand(command)).toThrow();
    }
  });

  it("leaves wording of empty or invalid policy text to the application but bounds its size", () => {
    expect(() =>
      validateBridgeCommand({
        type: "writing-policy.save",
        input: { workspaceId: "ws-1", content: "" },
      }),
    ).not.toThrow();
    expect(() =>
      validateBridgeCommand({
        type: "writing-policy.save",
        input: { workspaceId: "ws-1", content: "Tone: sarcastic" },
      }),
    ).not.toThrow();
    const save = (content: string) =>
      validateBridgeCommand({
        type: "writing-policy.save",
        input: { workspaceId: "ws-1", content },
      });
    expect(() => save("a".repeat(maximumWritingPolicyContentBytes))).not.toThrow();
    expect(() => save("a".repeat(maximumWritingPolicyContentBytes + 1))).toThrow();
    // Bytes, not characters: 3-byte characters overflow well before the character count.
    expect(() => save("€".repeat(Math.ceil(maximumWritingPolicyContentBytes / 3) + 1))).toThrow();
  });

  it("accepts the real read result for a saved policy and for the starting template", async () => {
    const saved = {
      workspaceId: "ws-1",
      content: "Tone: warm\n",
      version: "sha256:aaaaaaaaaaaa",
      checksum,
      isDefaultTemplate: false,
    };
    const template = {
      workspaceId: "ws-1",
      content: "Tone: professional\n",
      version: null,
      checksum: null,
      isDefaultTemplate: true,
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: saved }));
    const port = createCapabilityPort(bridge(invoke));
    const read = { type: "writing-policy.read", input: { workspaceId: "ws-1" } } as const;
    await expect(port.execute(read)).resolves.toEqual({ ok: true, value: saved });
    invoke.mockResolvedValueOnce({ ok: true, value: template });
    await expect(port.execute(read)).resolves.toEqual({ ok: true, value: template });
  });

  it("rejects a read result that is inconsistent or carries extra keys", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const port = createCapabilityPort(bridge(invoke));
    const read = { type: "writing-policy.read", input: { workspaceId: "ws-1" } } as const;
    const good = {
      workspaceId: "ws-1",
      content: "Tone: warm\n",
      version: "sha256:aaaaaaaaaaaa",
      checksum,
      isDefaultTemplate: false,
    };
    for (const value of [
      { ...good, path: "/private/policy.md" },
      { ...good, isDefaultTemplate: true },
      { ...good, checksum: null },
      { ...good, content: 4 },
    ]) {
      invoke.mockResolvedValueOnce({ ok: true, value });
      await expect(port.execute(read)).resolves.toMatchObject({ ok: false });
    }
  });

  it("accepts the real save result and rejects extra keys", async () => {
    const saved = { workspaceId: "ws-1", version: "sha256:aaaaaaaaaaaa", checksum };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: saved }));
    const port = createCapabilityPort(bridge(invoke));
    const save = {
      type: "writing-policy.save",
      input: { workspaceId: "ws-1", content: "Tone: warm\n" },
    } as const;
    await expect(port.execute(save)).resolves.toEqual({ ok: true, value: saved });
    invoke.mockResolvedValueOnce({ ok: true, value: { ...saved, content: "Tone: warm" } });
    await expect(port.execute(save)).resolves.toMatchObject({ ok: false });
  });

  it("exposes the renderer port methods only when the host offers the capabilities", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const withBoth = createBridgeReviewPort(createCapabilityPort(bridge(invoke)));
    expect(withBoth.readWritingPolicy).toBeTypeOf("function");
    expect(withBoth.saveWritingPolicy).toBeTypeOf("function");
    const without = createBridgeReviewPort(createCapabilityPort(bridge(invoke, ["review.load"])));
    expect(without.readWritingPolicy).toBeUndefined();
    expect(without.saveWritingPolicy).toBeUndefined();
  });

  it("sends the workspace id and the whole text when saving", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "writing-policy.save") {
        return {
          ok: true,
          value: { workspaceId: "ws-1", version: "sha256:aaaaaaaaaaaa", checksum },
        };
      }
      return { ok: false, error: { code: "operation-failed", message: "stop after save" } };
    });
    const port = createBridgeReviewPort(createCapabilityPort(bridge(invoke)));
    await expect(port.saveWritingPolicy?.("ws-1", "Tone: warm\n")).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith({
      type: "writing-policy.save",
      input: { workspaceId: "ws-1", content: "Tone: warm\n" },
    });
  });
});
