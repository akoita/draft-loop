import { describe, expect, it, vi } from "vitest";

import {
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  safeBridgeError,
  unavailableResult,
  validateBridgeCommand,
} from "./bridge.js";
import { createFixtureReviewState, reduceReviewState } from "./model.js";
import {
  createBridgeReviewPort,
  createBrowserCapabilityPort,
  createBrowserNativeBridge,
} from "./native.js";

function bridge(
  invoke: NativeBridge["invoke"],
  capabilities: NativeBridge["capabilities"] = bridgeCapabilities,
): NativeBridge {
  return { capabilities, invoke };
}

describe("desktop capability bridge", () => {
  it("accepts allowlisted commands and rejects unknown or extra fields", () => {
    expect(
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          extensions: [".pdf"],
          multiple: true,
          target: "evidence",
        },
      }),
    ).toEqual({
      type: "file.select",
      input: {
        workspaceId: "workspace-1",
        extensions: [".pdf"],
        multiple: true,
        target: "evidence",
      },
    });

    expect(() => validateBridgeCommand({ type: "shell.exec", input: {} })).toThrow("not supported");
    expect(() =>
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", path: "/tmp/escape" },
      }),
    ).toThrow("invalid");

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "approve" },
        },
      }),
    ).toMatchObject({ type: "review.dispatch", input: { action: { type: "approve" } } });

    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", mode: "real" },
      }),
    ).toEqual({ type: "workspace.create", input: { name: "candidate", mode: "real" } });

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start" },
        },
      }),
    ).toMatchObject({ type: "review.dispatch", input: { action: { type: "start" } } });

    const fingerprint = "a".repeat(64);
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint },
        },
      }),
    ).toMatchObject({
      type: "review.dispatch",
      input: { action: { type: "acknowledge-provider-transmission", fingerprint } },
    });
    expect(() =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint: "stale" },
        },
      }),
    ).toThrow("invalid");
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "recover-to-review" },
        },
      }),
    ).toMatchObject({ input: { action: { type: "recover-to-review" } } });
    expect(() =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "stop", reason: "provider response body" },
        },
      }),
    ).toThrow("invalid");
  });

  it("accepts the workspace.create shape the live provider E2E gate sends", () => {
    // Regression: `authorModel`/`criticModel` were added to WorkspaceCreateInput and
    // to the host handler without being added to the validator allowlist, so the
    // live gate failed at workspace creation before reaching any provider.
    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: {
          name: "draft-loop-live-e2e",
          mode: "real",
          authorModel: "claude-haiku-4-5",
          criticModel: "gpt-5.6-luna",
        },
      }),
    ).toEqual({
      type: "workspace.create",
      input: {
        name: "draft-loop-live-e2e",
        mode: "real",
        authorModel: "claude-haiku-4-5",
        criticModel: "gpt-5.6-luna",
      },
    });
  });

  it("keeps workspace.create model ids optional, bounded, and trimmed", () => {
    const withoutModels = validateBridgeCommand({
      type: "workspace.create",
      input: { name: "candidate", mode: "real" },
    });
    expect(withoutModels).toEqual({
      type: "workspace.create",
      input: { name: "candidate", mode: "real" },
    });
    expect(Object.keys(withoutModels.input)).toEqual(["name", "mode"]);

    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: {
          name: "candidate",
          authorModel: "  us.anthropic.claude-sonnet-4-5  ",
          criticModel: "gpt-5.6-luna",
        },
      }),
    ).toEqual({
      type: "workspace.create",
      input: {
        name: "candidate",
        authorModel: "us.anthropic.claude-sonnet-4-5",
        criticModel: "gpt-5.6-luna",
      },
    });

    for (const authorModel of [
      "",
      "   ",
      42,
      null,
      "a".repeat(129),
      "gpt 5.6 luna",
      "claude/haiku",
      "-leading-hyphen",
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "workspace.create",
          input: { name: "candidate", mode: "real", authorModel },
        }),
      ).toThrow("invalid");
    }

    expect(() =>
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", mode: "real", criticModel: "gpt$5" },
      }),
    ).toThrow("invalid");
    expect(() =>
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", mode: "real", model: "gpt-5.6-luna" },
      }),
    ).toThrow("invalid");
  });

  it("accepts workspace.create required sections and rejects an empty list", () => {
    // Regression: `requiredSections` was added to WorkspaceCreateInput and to the
    // host handler without being added to the validator allowlist, so the path
    // #190 built - bridge to service.initialize - rejected every call.
    const accepted = validateBridgeCommand({
      type: "workspace.create",
      input: {
        name: "candidate",
        mode: "real",
        requiredSections: ["  Summary  ", "Work Experience", "Education", "Skills"],
      },
    });
    expect(accepted).toEqual({
      type: "workspace.create",
      input: {
        name: "candidate",
        mode: "real",
        requiredSections: ["Summary", "Work Experience", "Education", "Skills"],
      },
    });

    const omitted = validateBridgeCommand({
      type: "workspace.create",
      input: { name: "candidate", mode: "real" },
    });
    expect(Object.keys(omitted.input)).toEqual(["name", "mode"]);

    for (const requiredSections of [
      [],
      "Summary",
      {},
      Array.from({ length: 13 }, (_, index) => `Section ${index}`),
      ["Summary", ""],
      ["Summary", "   "],
      ["Summary", 42],
      ["Summary", null],
      ["Summary", "a".repeat(65)],
      ["Summary", "Skills / Tools"],
      ["Summary", "-leading-hyphen"],
      ["Summary", "Summary"],
      ["Summary", "  Summary  "],
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "workspace.create",
          input: { name: "candidate", mode: "real", requiredSections },
        }),
      ).toThrow("invalid");
    }
  });

  it("rejects traversal and unbounded export paths before invoking the host", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const port = createCapabilityPort(bridge(invoke));

    const result = await port.execute({
      type: "export.write",
      input: {
        workspaceId: "workspace-1",
        runId: "run-1",
        format: "pdf",
        relativePath: "../outside.pdf",
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects workspace names that resolve outside the selected parent", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const port = createCapabilityPort(bridge(invoke, ["workspace.create"]));

    const result = await port.execute({
      type: "workspace.create",
      input: { name: ".." },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates and carries in-app credential operations through the bridge", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "credential.set") {
        return {
          ok: true,
          value: {
            provider: "openai",
            configured: true,
            source: "app",
            protection: "os-backed",
          },
        };
      }
      return {
        ok: true,
        value: {
          provider: "openai",
          configured: true,
          source: "env",
          protection: "environment",
        },
      };
    });
    const port = createCapabilityPort(bridge(invoke, ["credential.set", "credential.status"]));

    const setResult = await port.execute({
      type: "credential.set",
      input: { provider: "openai", apiKey: "sk-proj-test123" },
    });

    expect(setResult).toEqual({
      ok: true,
      value: {
        provider: "openai",
        configured: true,
        source: "app",
        protection: "os-backed",
      },
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "credential.set",
      input: { provider: "openai", apiKey: "sk-proj-test123" },
    });

    const statusResult = await port.execute({
      type: "credential.status",
      input: { provider: "openai" },
    });

    expect(statusResult).toEqual({
      ok: true,
      value: {
        provider: "openai",
        configured: true,
        source: "env",
        protection: "environment",
      },
    });
  });

  it("reports unavailable browser capabilities without filesystem access", async () => {
    const result = await createBrowserCapabilityPort().execute({
      type: "file.select",
      input: { workspaceId: "workspace-1", multiple: true },
    });

    expect(result).toEqual(unavailableResult("file.select"));
    expect(createBrowserNativeBridge().capabilities).toEqual([]);
  });

  it("normalizes host failures into stable, content-free errors", async () => {
    const port = createCapabilityPort(
      bridge(async () => {
        throw new Error("private candidate content and secret");
      }, ["run.status"]),
    );

    const result = await port.execute({
      type: "run.status",
      input: { workspaceId: "workspace-1" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(JSON.stringify(result)).not.toContain("private candidate");
  });

  it("preserves only bounded messages from serialized bridge failures", async () => {
    expect(
      safeBridgeError(
        {
          name: "NativeHostError",
          code: "not-found",
          message: "The run has no draft artifact yet.",
        },
        "review.dispatch",
      ),
    ).toEqual({
      code: "not-found",
      message: "The run has no draft artifact yet.",
      capability: "review.dispatch",
    });
    expect(
      safeBridgeError(
        { code: "not-found", message: "private candidate content" },
        "review.dispatch",
      ),
    ).toEqual({
      code: "not-found",
      message: "The requested desktop resource was not found.",
      capability: "review.dispatch",
    });

    const serialized = createCapabilityPort(
      bridge(
        async () => ({
          ok: false,
          error: {
            code: "permission-denied" as const,
            message: "The workspace is read-only.",
            capability: "run.status" as const,
          },
        }),
        ["run.status"],
      ),
    );
    await expect(
      serialized.execute({ type: "run.status", input: { workspaceId: "workspace-1" } }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "permission-denied",
        message: "The workspace is read-only.",
        capability: "run.status",
      },
    });

    const thrown = createCapabilityPort(
      bridge(async () => {
        throw new Error("private candidate content and secret");
      }, ["run.status"]),
    );
    await expect(
      thrown.execute({ type: "run.status", input: { workspaceId: "workspace-1" } }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "operation-failed",
        message: "The desktop operation could not be completed.",
        capability: "run.status",
      },
    });

    for (const message of ["private\ncontent", "x".repeat(501)]) {
      const invalidSerialized = createCapabilityPort(
        bridge(
          async () => ({
            ok: false,
            error: { code: "permission-denied" as const, message },
          }),
          ["run.status"],
        ),
      );
      await expect(
        invalidSerialized.execute({ type: "run.status", input: { workspaceId: "workspace-1" } }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: "permission-denied",
          message: "The desktop host denied this operation.",
          capability: "run.status",
        },
      });
    }

    const mismatchedCapability = createCapabilityPort(
      bridge(
        async () => ({
          ok: false,
          error: {
            code: "permission-denied" as const,
            message: "The workspace is read-only.",
            capability: "workspace.open" as const,
          },
        }),
        ["run.status"],
      ),
    );
    await expect(
      mismatchedCapability.execute({
        type: "run.status",
        input: { workspaceId: "workspace-1" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "permission-denied",
        message: "The desktop host denied this operation.",
        capability: "run.status",
      },
    });
  });

  it("adapts host-backed review load and dispatch into the desktop review port", async () => {
    const state = createFixtureReviewState();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => ({
      ok: true,
      value: command.type === "review.load" ? state : { ...state, state: "approved" },
    }));
    const port = createBridgeReviewPort(
      createCapabilityPort(bridge(invoke, ["review.load", "review.dispatch"])),
    );

    await expect(port.load()).resolves.toEqual(state);
    await expect(port.dispatch(state, { type: "approve" })).resolves.toMatchObject({
      state: "approved",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("rejects inconsistent provider failure projections from the host", async () => {
    const baseFailure = {
      code: "timeout",
      explanation: "The provider request timed out.",
      provider: "openai",
      model: "gpt-5",
      step: "critic",
      attempt: 1,
      maxAttempts: 3,
      retryAvailable: true,
      retryNotBefore: null,
      availableActions: ["retry", "return-to-review", "stop"],
      diagnostics: [],
    } as const;
    for (const providerFailure of [
      { ...baseFailure, attempt: 0 },
      { ...baseFailure, attempt: 4 },
      { ...baseFailure, availableActions: ["retry", "retry"] },
      { ...baseFailure, retryAvailable: false },
    ]) {
      const state = {
        ...createFixtureReviewState(),
        state: "provider-error" as const,
        providerFailure,
      };
      const port = createCapabilityPort(
        bridge(async () => ({ ok: true, value: state }), ["review.load"]),
      );
      await expect(
        port.execute({ type: "review.load", input: { workspaceId: state.workspaceId } }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("clears provider failure details after local recovery or stop reduction", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "provider-error" as const,
      providerFailure: {
        code: "timeout" as const,
        explanation: "The provider request timed out.",
        provider: "openai",
        model: "gpt-5",
        step: "critic" as const,
        attempt: 1,
        maxAttempts: 3,
        retryAvailable: true,
        retryNotBefore: null,
        availableActions: ["retry", "return-to-review", "stop"] as const,
        diagnostics: [],
      },
    };

    expect(reduceReviewState(state, { type: "recover-to-review" }).providerFailure).toBeNull();
    expect(reduceReviewState(state, { type: "stop" }).providerFailure).toBeNull();
  });
});
