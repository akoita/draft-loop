import { describe, expect, it, vi } from "vitest";
import type { NativeBridge } from "./bridge.js";
import { bridgeError } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { createDesktopReviewPort } from "./native.js";
import { isElectronRendererRuntime, nativeConnectionUnavailableMessage } from "./native-startup.js";

describe("desktop renderer startup", () => {
  it("selects a supported native bridge in the Electron runtime", async () => {
    const invoke: NativeBridge["invoke"] = vi.fn(async () => ({
      ok: false as const,
      error: bridgeError("operation-failed", "review.load"),
    }));
    const port = createDesktopReviewPort({
      nativeBridge: {
        capabilities: ["review.load", "review.dispatch"],
        invoke,
      } satisfies NativeBridge,
      electronRuntime: true,
    });

    await expect(port.load()).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith({ type: "review.load", input: {} });
  });

  it("fails closed when Electron has no native bridge", async () => {
    const port = createDesktopReviewPort({ nativeBridge: undefined, electronRuntime: true });

    await expect(port.load()).rejects.toThrow(nativeConnectionUnavailableMessage);
    await expect(port.dispatch(createFixtureReviewState(), { type: "start" })).rejects.toThrow(
      nativeConnectionUnavailableMessage,
    );
  });

  it.each([
    ["malformed bridge", { capabilities: ["unrecognized"], invoke: vi.fn() }],
    ["incomplete review bridge", { capabilities: ["review.load"], invoke: vi.fn() }],
  ])("fails closed for an %s without invoking it", async (_label, nativeBridge) => {
    const invoke = vi.fn();
    const port = createDesktopReviewPort({
      nativeBridge: { ...nativeBridge, invoke },
      electronRuntime: true,
    });

    await expect(port.load()).rejects.toThrow(nativeConnectionUnavailableMessage);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the deterministic fixture for ordinary browser preview", async () => {
    const port = createDesktopReviewPort({ nativeBridge: undefined, electronRuntime: false });

    const state = await port.load();
    expect(state.setup.fixtureMode).toBe(true);
  });

  it("uses the Electron user-agent marker only to suppress fixture fallback", () => {
    expect(isElectronRendererRuntime("Mozilla/5.0 Electron/44.4.5")).toBe(true);
    expect(isElectronRendererRuntime("Mozilla/5.0 Chrome/140.0.0.0")).toBe(false);
    expect(isElectronRendererRuntime(undefined)).toBe(false);
  });
});
