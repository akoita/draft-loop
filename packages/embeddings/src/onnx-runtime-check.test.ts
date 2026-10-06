import { describe, expect, it } from "vitest";

import { verifyOnnxRuntime } from "./onnx-runtime-check.js";
import {
  loadOnnxRuntimeUncached,
  type OnnxRuntimeModule,
  OnnxRuntimeUnavailableError,
} from "./onnx-runtime-loader.js";

describe("onnx runtime loader", () => {
  it("uses the primary importer when it succeeds", async () => {
    const runtime = { InferenceSession: {} } as unknown as OnnxRuntimeModule;
    const loaded = await loadOnnxRuntimeUncached({
      importer: async () => ({ default: runtime }),
      resourceLoader: () => {
        throw new Error("fallback must not run");
      },
    });
    expect(loaded).toBe(runtime);
  });

  it("falls back to the packaged resources copy when the import fails", async () => {
    const runtime = { InferenceSession: {} } as unknown as OnnxRuntimeModule;
    const requested: string[] = [];
    const loaded = await loadOnnxRuntimeUncached({
      importer: async () => {
        throw new Error("Cannot find package 'onnxruntime-node'");
      },
      resourcesPath: "/opt/app/resources",
      resourceLoader: (path) => {
        requested.push(path);
        return runtime;
      },
    });
    expect(loaded).toBe(runtime);
    expect(requested).toEqual(["/opt/app/resources"]);
  });

  it("fails clearly when there is no resources path", async () => {
    await expect(
      loadOnnxRuntimeUncached({
        importer: async () => {
          throw new Error("missing");
        },
        resourcesPath: undefined,
      }),
    ).rejects.toBeInstanceOf(OnnxRuntimeUnavailableError);
  });

  it("fails clearly when the resources copy is also broken", async () => {
    await expect(
      loadOnnxRuntimeUncached({
        importer: async () => {
          throw new Error("missing");
        },
        resourcesPath: "/opt/app/resources",
        resourceLoader: () => {
          throw new Error("no such directory");
        },
      }),
    ).rejects.toThrow(/application resources/u);
  });
});

describe("verifyOnnxRuntime", () => {
  it("loads and runs the real runtime", async () => {
    await expect(verifyOnnxRuntime()).resolves.toEqual({ ok: true });
  });

  it("reports a load failure instead of throwing", async () => {
    const result = await verifyOnnxRuntime({
      loadRuntime: async () => {
        throw new Error("binding missing");
      },
    });
    expect(result).toEqual({ ok: false, reason: "binding missing" });
  });
});
