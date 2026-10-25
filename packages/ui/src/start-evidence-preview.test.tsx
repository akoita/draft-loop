import { describe, expect, it, vi } from "vitest";
import {
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { createBridgeReviewPort } from "./native.js";
import type { RunEvidenceModeView } from "./run-evidence-mode.js";
import {
  evidencePreviewValue,
  requestStartEvidencePreview,
  startConfirmationSummary,
} from "./start-confirmation.js";
import type { StartEvidencePreview } from "./start-evidence-preview.js";

const fits: RunEvidenceModeView = {
  requestedMode: "full-source",
  effectiveMode: "full-source",
  chunkCount: 282,
  sourceCount: 1,
};

function ready(preview: RunEvidenceModeView): StartEvidencePreview {
  return { status: "ready", preview };
}

describe("start confirmation evidence line", () => {
  it("names the mode and size of each preview", () => {
    expect(evidencePreviewValue(ready(fits))).toBe("Full source · 282 chunks from 1 source (fits)");
    expect(
      evidencePreviewValue(
        ready({ ...fits, effectiveMode: "retrieval", fallbackReason: "budget-exceeded" }),
      ),
    ).toBe(
      "Full source does not fit the budget for this pair (282 chunks); retrieval will be used",
    );
    expect(
      evidencePreviewValue(
        ready({
          ...fits,
          chunkCount: 0,
          effectiveMode: "retrieval",
          fallbackReason: "no-eligible-chunks",
        }),
      ),
    ).toBe("Full source has no eligible chunks; retrieval will be used");
    expect(
      evidencePreviewValue(
        ready({ requestedMode: "retrieval", effectiveMode: "retrieval", chunkCount: 0 }),
      ),
    ).toBe("Retrieval");
    expect(evidencePreviewValue({ status: "checking" })).toBe("Checking…");
  });

  it("adds the line to the inputs only when a preview is known or pending", () => {
    const evidence = (evidencePreview?: StartEvidencePreview | null) =>
      startConfirmationSummary(createFixtureReviewState(), {
        action: { type: "start" },
        ...(evidencePreview === undefined ? {} : { evidencePreview }),
      }).inputs.find((line) => line.label === "Evidence")?.value;
    expect(evidence()).toBeUndefined();
    expect(evidence(null)).toBeUndefined();
    expect(evidence({ status: "checking" })).toBe("Checking…");
    expect(evidence(ready(fits))).toBe("Full source · 282 chunks from 1 source (fits)");
  });

  it("shows checking, then the answer, and nothing on failure or a late answer", async () => {
    const seen: (StartEvidencePreview | null)[] = [];
    const set = (value: StartEvidencePreview | null) => seen.push(value);
    requestStartEvidencePreview(async () => fits, set);
    await vi.waitFor(() => expect(seen).toEqual([{ status: "checking" }, ready(fits)]));

    seen.length = 0;
    requestStartEvidencePreview(async () => Promise.reject(new Error("offline")), set);
    await vi.waitFor(() => expect(seen).toEqual([{ status: "checking" }, null]));

    seen.length = 0;
    const cancel = requestStartEvidencePreview(async () => fits, set);
    cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([{ status: "checking" }]);

    seen.length = 0;
    requestStartEvidencePreview(undefined, set);
    expect(seen).toEqual([null]);
  });
});

function bridge(invoke: NativeBridge["invoke"]): NativeBridge {
  return { capabilities: bridgeCapabilities, invoke };
}

const command = {
  type: "review.preview-evidence",
  input: {
    workspaceId: "workspace-1",
    applicationId: "app-1",
    modelProfiles: {
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 1 },
    },
  },
} as const;

/*
 * Drift proof: a real payload goes through the real bridge validators, so a field added to the
 * interface but not to the runtime allowlist fails here instead of in the app.
 */
describe("evidence preview over the bridge", () => {
  it("is a capability and accepts its real input", () => {
    expect(bridgeCapabilities).toContain("review.preview-evidence");
    expect(validateBridgeCommand(command)).toEqual(command);
    expect(() =>
      validateBridgeCommand({ ...command, input: { ...command.input, root: "/private" } }),
    ).toThrow();
  });

  it("accepts a real result unchanged and refuses anything else", async () => {
    const respond = (value: unknown) =>
      createCapabilityPort(bridge(async () => ({ ok: true, value }))).execute(command);
    for (const preview of [
      fits,
      { ...fits, effectiveMode: "retrieval", fallbackReason: "budget-exceeded" },
      { requestedMode: "retrieval", effectiveMode: "retrieval", chunkCount: 0 },
      null,
    ]) {
      await expect(respond({ preview })).resolves.toEqual({ ok: true, value: { preview } });
    }
    for (const value of [
      { preview: { ...fits, serializedCharacterCount: 10 } },
      { preview: { ...fits, chunkCount: -1 } },
      { preview: fits, root: "/private" },
      {},
    ]) {
      await expect(respond(value)).resolves.toMatchObject({ ok: false });
    }
  });

  it("sends the workspace and pair from the review port", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: { preview: fits },
    }));
    const port = createBridgeReviewPort(createCapabilityPort(bridge(invoke)));
    await expect(
      port.previewStartEvidence?.("workspace-1", command.input.modelProfiles),
    ).resolves.toEqual(fits);
    await expect(port.previewStartEvidence?.("workspace-1", null)).resolves.toEqual(fits);
    expect(invoke.mock.calls.map(([sent]) => sent)).toEqual([
      {
        type: "review.preview-evidence",
        input: { workspaceId: "workspace-1", modelProfiles: command.input.modelProfiles },
      },
      { type: "review.preview-evidence", input: { workspaceId: "workspace-1" } },
    ]);
  });
});
