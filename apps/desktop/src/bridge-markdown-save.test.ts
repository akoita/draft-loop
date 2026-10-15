import { describe, expect, it, vi } from "vitest";

import {
  bridgeCapabilities,
  createCapabilityPort,
  maximumMarkdownFileSaveBytes,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";

function bridge(invoke: NativeBridge["invoke"]): NativeBridge {
  return { capabilities: bridgeCapabilities, invoke };
}

describe("file.save-markdown across the bridge", () => {
  it("carries a file name and Markdown to the host and the saved file's name back", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: { saved: true, fileName: "run-2-vs-run-3-comparison.md" },
    }));
    const port = createCapabilityPort(bridge(invoke));
    expect(port.hasCapability("file.save-markdown")).toBe(true);

    const result = await port.execute({
      type: "file.save-markdown",
      input: { suggestedName: "run-2-vs-run-3-comparison.md", content: "# Run comparison\n" },
    });

    expect(result).toEqual({
      ok: true,
      value: { saved: true, fileName: "run-2-vs-run-3-comparison.md" },
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "file.save-markdown",
      input: { suggestedName: "run-2-vs-run-3-comparison.md", content: "# Run comparison\n" },
    });
  });

  it("offers the review port's saveMarkdownFile only through the real capability", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: { saved: false, fileName: null },
    }));
    const port = createBridgeReviewPort(createNativeCapabilityPort(bridge(invoke)));
    expect(port.saveMarkdownFile).toBeDefined();
    await expect(port.saveMarkdownFile?.("comparison.md", "text")).resolves.toEqual({
      saved: false,
      fileName: null,
    });
  });

  it("rejects paths, other extensions, extra keys, non-text and oversized content", () => {
    const valid = { suggestedName: "comparison.md", content: "text" };
    expect(validateBridgeCommand({ type: "file.save-markdown", input: valid })).toEqual({
      type: "file.save-markdown",
      input: valid,
    });
    for (const input of [
      { ...valid, suggestedName: "../comparison.md" },
      { ...valid, suggestedName: "exports/comparison.md" },
      { ...valid, suggestedName: "comparison.txt" },
      { ...valid, path: "/tmp/comparison.md" },
      { ...valid, content: 42 },
      { ...valid, content: "x".repeat(maximumMarkdownFileSaveBytes + 1) },
      // Multi-byte text is measured in bytes, not characters.
      { ...valid, content: "é".repeat(maximumMarkdownFileSaveBytes / 2 + 1) },
    ]) {
      expect(() => validateBridgeCommand({ type: "file.save-markdown", input } as never)).toThrow(
        "invalid",
      );
    }
  });

  it("refuses a host reply that carries a folder or a name for an unsaved file", async () => {
    for (const value of [
      { saved: true, fileName: "/home/someone/comparison.md" },
      { saved: false, fileName: "comparison.md" },
      { saved: true, fileName: "comparison.md", path: "/home/someone" },
    ]) {
      const port = createCapabilityPort(bridge(async () => ({ ok: true, value })));
      const result = await port.execute({
        type: "file.save-markdown",
        input: { suggestedName: "comparison.md", content: "text" },
      });
      expect(result.ok).toBe(false);
    }
  });
});
