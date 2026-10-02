import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BridgeCommand, NativeBridge } from "../bridge.js";
import { bridgeCapabilities } from "../bridge-capabilities.js";

let preloadCode = "";

beforeAll(async () => {
  const result = await build({
    configFile: resolve(process.cwd(), "apps/desktop/vite.preload.config.ts"),
    logLevel: "silent",
    build: {
      write: false,
      lib: {
        entry: resolve(process.cwd(), "apps/desktop/src/electron/preload.ts"),
        formats: ["cjs"],
        fileName: "preload",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : "output" in result ? [result] : [];
  const chunk = outputs.flatMap((output) => output.output).find((item) => item.type === "chunk");
  if (chunk?.type !== "chunk")
    throw new Error("The preload bundle did not emit a JavaScript chunk.");
  preloadCode = chunk.code;
});

describe("sandboxed Electron preload bundle", () => {
  it("loads only Electron and exposes the frozen bridge without invoking commands", async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: null }));
    let exposedKey: string | null = null;
    let exposedBridge: NativeBridge | null = null;
    const exposeInMainWorld = vi.fn((key: string, value: unknown) => {
      exposedKey = key;
      exposedBridge = value as NativeBridge;
    });
    const contextBridge = { exposeInMainWorld };
    const sandboxRequire = vi.fn((specifier: string) => {
      if (specifier !== "electron") {
        throw new Error(`Sandbox denied preload import: ${specifier}`);
      }
      return { contextBridge, ipcRenderer: { invoke } };
    });
    const module = { exports: {} as Record<string, unknown> };

    runInNewContext(preloadCode, {
      require: sandboxRequire,
      module,
      exports: module.exports,
    });

    expect(sandboxRequire.mock.calls).toEqual([["electron"]]);
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposedKey).toBe("__DRAFT_LOOP_NATIVE_BRIDGE__");
    const bridge = exposedBridge as NativeBridge | null;
    expect(bridge).not.toBeNull();
    if (bridge === null) throw new Error("The preload did not expose a native bridge.");
    expect([...bridge.capabilities]).toEqual(bridgeCapabilities);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(bridge.capabilities)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();

    const command: BridgeCommand = { type: "review.load", input: {} };
    await bridge.invoke(command);
    expect(invoke).toHaveBeenCalledWith("draft-loop:bridge", command);
  });
});
