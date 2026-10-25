import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import {
  candidateEvidenceKinds,
  maximumSourceEvidenceKindEntries,
  normalizeSourceEvidenceKindSetResult,
  normalizeSourceEvidenceKindsResult,
  parseSourceEvidenceKindSetInput,
} from "./source-evidence-kind-contract.js";

const base = { storeId: "store-1", knowledgeBaseId: "kb-1" } as const;
const summary = {
  sourceId: "source-1",
  displayName: "resume.pdf",
  kind: "cv",
  origin: "detected",
} as const;

describe("source evidence kind bridge contract", () => {
  it("accepts every taxonomy kind and null, and rejects anything else", () => {
    for (const kind of [...candidateEvidenceKinds, null]) {
      const input = { ...base, sourceId: "source-1", kind };
      expect(validateBridgeCommand({ type: "knowledge.source-evidence-kind.set", input })).toEqual({
        type: "knowledge.source-evidence-kind.set",
        input,
      });
    }
    for (const input of [
      { ...base, sourceId: "source-1", kind: "resume" },
      { ...base, sourceId: "source-1", kind: "CV" },
      { ...base, sourceId: "source-1" },
      { ...base, sourceId: "../source", kind: "cv" },
      { ...base, sourceId: "source-1", kind: "cv", storeRoot: "/private/store" },
    ]) {
      expect(parseSourceEvidenceKindSetInput(input)).toBeUndefined();
      expect(() =>
        validateBridgeCommand({ type: "knowledge.source-evidence-kind.set", input }),
      ).toThrow("invalid");
    }
    expect(validateBridgeCommand({ type: "knowledge.source-evidence-kinds", input: base })).toEqual(
      {
        type: "knowledge.source-evidence-kinds",
        input: base,
      },
    );
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.source-evidence-kinds",
        input: { ...base, storeRoot: "/private/store" },
      }),
    ).toThrow("invalid");
  });

  it("accepts a bounded listing and a set result, and rejects malformed answers", () => {
    expect(
      normalizeSourceEvidenceKindsResult({ ...base, sources: [summary], truncated: false }),
    ).toEqual({ ...base, sources: [summary], truncated: false });
    expect(normalizeSourceEvidenceKindSetResult({ ...base, source: summary })).toEqual({
      ...base,
      source: summary,
    });
    for (const value of [
      { ...base, sources: [{ ...summary, kind: "resume" }], truncated: false },
      { ...base, sources: [{ ...summary, origin: "guessed" }], truncated: false },
      { ...base, sources: [{ ...summary, displayName: "a\nb" }], truncated: false },
      { ...base, sources: [{ ...summary, text: "secret" }], truncated: false },
      { ...base, sources: [summary, summary], truncated: false },
      {
        ...base,
        sources: Array.from({ length: maximumSourceEvidenceKindEntries + 1 }, (_, index) => ({
          ...summary,
          sourceId: `source-${index}`,
        })),
        truncated: true,
      },
      { ...base, sources: [summary] },
    ]) {
      expect(normalizeSourceEvidenceKindsResult(value)).toBeUndefined();
    }
    expect(
      normalizeSourceEvidenceKindSetResult({ ...base, source: { ...summary, kind: "resume" } }),
    ).toBeUndefined();
  });

  it("carries the commands through the capability port only when the host offers them", async () => {
    const calls: unknown[] = [];
    const bridge: NativeBridge = {
      capabilities: ["knowledge.source-evidence-kinds", "knowledge.source-evidence-kind.set"],
      invoke: async (command) => {
        calls.push(command);
        return command.type === "knowledge.source-evidence-kinds"
          ? { ok: true, value: { ...base, sources: [summary], truncated: false } }
          : { ok: true, value: { ...base, source: { ...summary, kind: "notes", origin: "user" } } };
      },
    };
    const port = createCapabilityPort(bridge);
    await expect(
      port.execute({ type: "knowledge.source-evidence-kinds", input: base }),
    ).resolves.toMatchObject({ ok: true, value: { sources: [summary] } });
    await expect(
      port.execute({
        type: "knowledge.source-evidence-kind.set",
        input: { ...base, sourceId: "source-1", kind: "notes" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { source: { kind: "notes", origin: "user" } } });
    expect(calls).toHaveLength(2);

    const without = createCapabilityPort({ capabilities: [], invoke: bridge.invoke });
    expect(without.hasCapability("knowledge.source-evidence-kind.set")).toBe(false);
  });
});
