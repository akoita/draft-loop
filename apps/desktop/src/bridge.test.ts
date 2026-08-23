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

describe("workspace model reconfiguration", () => {
  const base = {
    workspaceId: "ws-1",
    authorCompany: "anthropic",
    authorModel: "claude-haiku-4-5",
    criticCompany: "openai",
    criticModel: "gpt-5.3-codex",
  };
  const configure = (input: Record<string, unknown>) =>
    validateBridgeCommand({ type: "workspace.configure-models", input });

  it("accepts a replacement pairing, including a local critic on loopback", () => {
    expect(configure(base).type).toBe("workspace.configure-models");
    expect(
      configure({
        ...base,
        criticCompany: "local",
        criticModel: "qwen3-coder-30b",
        localEndpoint: "http://127.0.0.1:8080/v1",
      }).type,
    ).toBe("workspace.configure-models");
  });

  it("refuses what workspace creation refuses, on the same terms", () => {
    // Reconfiguration is the same decision as creation, so it must not become a
    // way around the rules creation enforces.
    for (const input of [
      { ...base, criticCompany: "bedrock" },
      { ...base, criticCompany: "local", localEndpoint: "https://models.evil.test/v1" },
      { ...base, independenceOverrideRationale: "   " },
      { ...base, authorLineage: "x".repeat(500) },
      { ...base, nope: 1 },
    ]) {
      expect(() => configure(input)).toThrow();
    }
  });
});

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

    expect(
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          extensions: [".md", ".txt"],
          multiple: false,
          target: "writing-policy",
        },
      }),
    ).toMatchObject({ input: { target: "writing-policy", multiple: false } });

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
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "recover-round-limit" },
        },
      }),
    ).toMatchObject({ input: { action: { type: "recover-round-limit" } } });
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

  it("accepts a bounded workspace round limit", () => {
    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", mode: "real", maxRounds: 6 },
      }),
    ).toEqual({
      type: "workspace.create",
      input: { name: "candidate", mode: "real", maxRounds: 6 },
    });
    for (const maxRounds of [0, 21, 2.5, "3"]) {
      expect(() =>
        validateBridgeCommand({
          type: "workspace.create",
          input: { name: "candidate", maxRounds },
        }),
      ).toThrow("invalid");
    }
  });

  it("accepts a namespaced local model id, which names weights rather than a path", () => {
    // Ollama serves ids like these, and refusing them made real local models
    // unreachable from a workspace. A model id reaches a provider only as the
    // `model` field of a JSON body: never a URL path, never a filename.
    for (const authorModel of ["hf.co/user/model:Q4", "library/llama3:8b"]) {
      expect(
        validateBridgeCommand({ type: "workspace.create", input: { name: "w", authorModel } }),
      ).toEqual({ type: "workspace.create", input: { name: "w", authorModel } });
    }
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
      "-leading-hyphen",
      // Namespaced ids are valid now; only traversal shapes are refused.
      "../../etc/passwd",
      "a/../../b",
      "a//b",
      "trailing/",
      "/leading",
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

  it("strictly validates provider-managed user-session credential status", async () => {
    const accepted = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            provider: "anthropic",
            configured: true,
            source: "user-session",
            protection: "provider-managed-session",
          },
        }),
        ["credential.status"],
      ),
    );
    await expect(
      accepted.execute({ type: "credential.status", input: { provider: "anthropic" } }),
    ).resolves.toMatchObject({
      ok: true,
      value: { source: "user-session", protection: "provider-managed-session" },
    });

    const rejected = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            provider: "anthropic",
            configured: true,
            source: "oauth-token",
            protection: "provider-managed-session",
          },
        }),
        ["credential.status"],
      ),
    );
    await expect(
      rejected.execute({ type: "credential.status", input: { provider: "anthropic" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
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

  it("carries the recorded independence claim, rationale included, back to the renderer", async () => {
    // The result normalizers keep hand-written allowlists. A field that the
    // host reports and the allowlist has never heard of would not reach the
    // trust panel, which is why this asserts the whole record survives.
    const fixture = createFixtureReviewState();
    const rationale = "One lineage on both sides.\nA deliberate self-review experiment.";
    const state = {
      ...fixture,
      providerExposure: {
        ...fixture.providerExposure,
        independentReview: {
          authorLineage: "gpt-oss-20b",
          criticLineage: "gpt-oss-20b",
          lineagesDistinct: false,
          required: true,
          overrideRationale: rationale,
        },
      },
    };
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value: state }), ["review.load"]),
    );

    await expect(
      port.execute({ type: "review.load", input: { workspaceId: state.workspaceId } }),
    ).resolves.toEqual({ ok: true, value: state });

    const withoutOverride = createCapabilityPort(
      bridge(async () => ({ ok: true, value: fixture }), ["review.load"]),
    );

    await expect(
      withoutOverride.execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        providerExposure: {
          independentReview: { lineagesDistinct: true, overrideRationale: null },
        },
      },
    });
  });

  it("rejects independence claims the host could not honestly have recorded", async () => {
    const fixture = createFixtureReviewState();
    for (const independentReview of [
      {
        authorLineage: "",
        criticLineage: "b",
        lineagesDistinct: true,
        required: true,
        overrideRationale: null,
      },
      {
        authorLineage: "a",
        criticLineage: "b",
        lineagesDistinct: "yes",
        required: true,
        overrideRationale: null,
      },
      {
        authorLineage: "a",
        criticLineage: "b",
        lineagesDistinct: true,
        required: true,
        overrideRationale: "r".repeat(501),
      },
      {
        authorLineage: "a",
        criticLineage: "b",
        lineagesDistinct: true,
        required: true,
        overrideRationale: "control\u0007char",
      },
      {
        authorLineage: "a",
        criticLineage: "b",
        lineagesDistinct: true,
        required: true,
        overrideRationale: null,
        verdict: "independent",
      },
    ]) {
      const state = {
        ...fixture,
        providerExposure: { ...fixture.providerExposure, independentReview },
      };
      const port = createCapabilityPort(
        bridge(async () => ({ ok: true, value: state }), ["review.load"]),
      );
      await expect(
        port.execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
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
  it("carries a model catalogue across the bridge and refuses a hostile one", async () => {
    const catalogue = {
      provider: "local" as const,
      models: [{ id: "llama3.2:3b" }, { id: "qwen3:8b" }],
      truncated: false,
      source: "live" as const,
      retrievedAt: "2026-08-19T09:00:00.000Z",
    };
    const port = createCapabilityPort(bridge(async () => ({ ok: true, value: catalogue })));

    await expect(
      port.execute({ type: "models.list", input: { provider: "local", refresh: true } }),
    ).resolves.toEqual({ ok: true, value: catalogue });

    for (const hostile of [
      { ...catalogue, models: [{ id: "../../etc/passwd" }] },
      { ...catalogue, models: [{ id: `a${"b".repeat(200)}` }] },
      { ...catalogue, models: [{ id: "llama3.2:3b", displayName: "Llama" }] },
      { ...catalogue, models: [{ id: "llama3.2:3b" }, { id: "llama3.2:3b" }] },
      {
        ...catalogue,
        models: Array.from({ length: 201 }, (_, index) => ({ id: `model-${index}` })),
      },
      { ...catalogue, provider: "totally-other" },
      { ...catalogue, source: "guess" },
      { ...catalogue, retrievedAt: "whenever" },
      { ...catalogue, apiKey: "sk-leaked" },
    ]) {
      const hostilePort = createCapabilityPort(bridge(async () => ({ ok: true, value: hostile })));
      await expect(
        hostilePort.execute({ type: "models.list", input: { provider: "local" } }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("carries a complete model choice into workspace creation", () => {
    const input = {
      name: "local-workspace",
      mode: "real" as const,
      authorCompany: "local" as const,
      authorModel: "qwen3-coder-30b",
      criticCompany: "anthropic" as const,
      criticModel: "claude-sonnet-4-5",
      authorLineage: "qwen3 base",
      criticLineage: "claude sonnet 4.5",
      localEndpoint: "http://127.0.0.1:11434/v1",
      independenceOverrideRationale: "Both sides were checked against the same held-out set.",
      requiredSections: ["Summary", "Experience"],
    };

    expect(validateBridgeCommand({ type: "workspace.create", input })).toEqual({
      type: "workspace.create",
      input,
    });
  });

  it("refuses a model choice the workspace could not honour", () => {
    for (const input of [
      // A company no provider adapter exists for is invalid input, not an
      // option this host happened not to offer.
      { name: "w", authorCompany: "bedrock" },
      { name: "w", criticCompany: "" },
      // "local" is a promise that nothing leaves the machine.
      { name: "w", authorCompany: "local", localEndpoint: "http://10.0.0.4:11434/v1" },
      { name: "w", localEndpoint: "http://evil.example.com/v1" },
      { name: "w", localEndpoint: "http://user:pass@127.0.0.1:11434/v1" },
      { name: "w", localEndpoint: "file:///etc/passwd" },
      { name: "w", localEndpoint: "http://127.0.0.1.evil.example.com/v1" },
      { name: "w", localEndpoint: "not a url" },
      // The domain keeps at most 200 characters of a declared lineage.
      { name: "w", authorLineage: "x".repeat(201) },
      { name: "w", criticLineage: "   " },
      { name: "w", authorLineage: "" },
      // A rationale is prose an auditor reads; an empty one claims nothing.
      { name: "w", independenceOverrideRationale: "   " },
      { name: "w", independenceOverrideRationale: "x".repeat(501) },
      { name: "w", independenceOverrideRationale: 7 },
      { name: "w", authorLineage: ["anthropic"] },
    ]) {
      expect(() => validateBridgeCommand({ type: "workspace.create", input })).toThrow("invalid");
    }
  });

  it("keeps loopback endpoints and bounded lineages usable", () => {
    for (const localEndpoint of [
      "http://localhost:11434/v1",
      "http://[::1]:1234/v1",
      "http://127.10.20.30:8080/v1",
      "https://127.0.0.1:8443/v1",
    ]) {
      expect(
        validateBridgeCommand({
          type: "workspace.create",
          input: { name: "w", localEndpoint },
        }),
      ).toEqual({ type: "workspace.create", input: { name: "w", localEndpoint } });
    }

    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "w", authorLineage: `  ${"x".repeat(196)}  ` },
      }),
    ).toEqual({ type: "workspace.create", input: { name: "w", authorLineage: "x".repeat(196) } });
  });

  it("asks the host about a candidate pairing without answering for itself", async () => {
    const answer = {
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "anthropic:claude-sonnet-4-5",
      lineagesDistinct: false,
    };
    const port = createCapabilityPort(bridge(async () => ({ ok: true, value: answer })));

    await expect(
      port.execute({
        type: "models.preview-independence",
        input: {
          author: { company: "anthropic", modelId: "claude-sonnet-4-5" },
          critic: {
            company: "bedrock",
            modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          },
        },
      }),
    ).resolves.toEqual({ ok: true, value: answer });

    for (const hostile of [
      { ...answer, lineagesDistinct: "no" },
      { ...answer, authorLineage: "" },
      { ...answer, authorLineage: `a${"b".repeat(600)}` },
      { ...answer, required: true },
    ]) {
      const hostilePort = createCapabilityPort(bridge(async () => ({ ok: true, value: hostile })));
      await expect(
        hostilePort.execute({
          type: "models.preview-independence",
          input: {
            author: { company: "anthropic", modelId: "claude-opus-5" },
            critic: { company: "openai", modelId: "gpt-5.6-luna" },
          },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("rejects an independence preview the domain could not be asked", () => {
    const valid = {
      author: { company: "anthropic", modelId: "claude-sonnet-4-5", lineage: "base sonnet" },
      critic: { company: "openai", modelId: "gpt-5.6-luna" },
    };
    expect(validateBridgeCommand({ type: "models.preview-independence", input: valid })).toEqual({
      type: "models.preview-independence",
      input: valid,
    });

    for (const input of [
      {},
      { author: valid.author },
      { author: valid.author, critic: valid.critic, required: true },
      { author: valid.author, critic: { company: "openai" } },
      { author: valid.author, critic: { company: "openai", modelId: "../../etc/passwd" } },
      { author: valid.author, critic: { ...valid.critic, lineage: "x".repeat(201) } },
      { author: valid.author, critic: { ...valid.critic, lineage: "" } },
      { author: valid.author, critic: { ...valid.critic, endpoint: "http://127.0.0.1" } },
    ]) {
      expect(() => validateBridgeCommand({ type: "models.preview-independence", input })).toThrow(
        "invalid",
      );
    }
  });

  it("rejects model discovery input the host was never meant to receive", () => {
    expect(
      validateBridgeCommand({ type: "models.list", input: { provider: "anthropic" } }),
    ).toEqual({ type: "models.list", input: { provider: "anthropic" } });

    for (const input of [
      { provider: "evil-co" },
      { provider: "local", endpoint: "http://10.0.0.1:11434/v1" },
      { provider: "local", workspaceId: "../escape" },
      { provider: "local", refresh: "yes" },
      {},
    ]) {
      expect(() => validateBridgeCommand({ type: "models.list", input })).toThrow("invalid");
    }
  });

  it("keeps candidate-knowledge paths behind the native bridge", async () => {
    expect(
      validateBridgeCommand({
        type: "knowledge.create",
        input: {
          selection: "native-dialog",
          name: "candidate-knowledge",
          displayName: "Career evidence",
        },
      }),
    ).toEqual({
      type: "knowledge.create",
      input: {
        selection: "native-dialog",
        name: "candidate-knowledge",
        displayName: "Career evidence",
      },
    });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.open",
        input: { path: "/private/candidate-data" },
      }),
    ).toThrow("invalid");

    const port = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBases: [
              {
                id: "kb-1",
                displayName: "Career evidence",
                description: "",
                state: "active",
                isDefault: true,
              },
            ],
          },
        }),
        ["knowledge.open"],
      ),
    );
    await expect(
      port.execute({ type: "knowledge.open", input: { selection: "native-dialog" } }),
    ).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        knowledgeBases: [
          {
            id: "kb-1",
            displayName: "Career evidence",
            description: "",
            state: "active",
            isDefault: true,
          },
        ],
      },
    });
  });

  it("validates bounded candidate-knowledge readiness summaries", async () => {
    const port = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            state: "active",
            sourceCount: 2,
            readyCount: 1,
            blockedCount: 1,
            blockerReasons: ["refresh-changed"],
          },
        }),
        ["knowledge.readiness"],
      ),
    );
    await expect(
      port.execute({
        type: "knowledge.readiness",
        input: { storeId: "store-1", knowledgeBaseId: "kb-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { sourceCount: 2, readyCount: 1, blockedCount: 1 },
    });
  });

  it("validates bounded path-free candidate-knowledge inspection results", async () => {
    const baseInput = { storeId: "store-1", knowledgeBaseId: "kb-1" } as const;
    for (const type of ["knowledge.sources", "knowledge.duplicates"] as const) {
      expect(validateBridgeCommand({ type, input: baseInput })).toEqual({ type, input: baseInput });
      expect(() =>
        validateBridgeCommand({
          type,
          input: { ...baseInput, storeRoot: "/private/candidate-data" },
        }),
      ).toThrow("invalid");
    }
    expect(
      validateBridgeCommand({ type: "knowledge.inventory", input: { storeId: "store-1" } }),
    ).toEqual({ type: "knowledge.inventory", input: { storeId: "store-1" } });

    const sourcePort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceCount: 1,
            sources: [
              {
                sourceId: "source-1",
                kind: "file",
                latestVersionId: "version-2",
                versionCount: 2,
              },
            ],
            truncated: false,
          },
        }),
        ["knowledge.sources"],
      ),
    );
    await expect(
      sourcePort.execute({ type: "knowledge.sources", input: baseInput }),
    ).resolves.toMatchObject({ ok: true, value: { sources: [{ versionCount: 2 }] } });

    const duplicatePort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            groupCount: 1,
            groups: [
              {
                memberCount: 2,
                members: [
                  { sourceId: "source-1", versionId: "version-1" },
                  { sourceId: "source-2", versionId: "version-2" },
                ],
                truncated: false,
              },
            ],
            truncated: false,
          },
        }),
        ["knowledge.duplicates"],
      ),
    );
    await expect(
      duplicatePort.execute({ type: "knowledge.duplicates", input: baseInput }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        groups: [
          {
            members: [
              { sourceId: "source-1", versionId: "version-1" },
              { sourceId: "source-2", versionId: "version-2" },
            ],
          },
        ],
      },
    });

    const inventoryPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            schemaVersion: 1,
            verifiedManagedFileCount: 2,
            scannedEntryCount: 3,
            unknownEntries: {
              intakeShapedFilesAtSourcesRoot: 0,
              opaqueEntriesAtSourcesRoot: 1,
              entriesInsideManagedSourceDirectories: 0,
              symbolicLinks: 0,
              otherEntries: 0,
            },
            complete: false,
            scanLimitReached: true,
          },
        }),
        ["knowledge.inventory"],
      ),
    );
    await expect(
      inventoryPort.execute({ type: "knowledge.inventory", input: { storeId: "store-1" } }),
    ).resolves.toMatchObject({ ok: true, value: { complete: false, scanLimitReached: true } });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceCount: 1,
            sources: [
              {
                sourceId: "source-1",
                kind: "file",
                latestVersionId: null,
                versionCount: 0,
                sourcePath: "/private/resume.md",
              },
            ],
            truncated: false,
          },
        }),
        ["knowledge.sources"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.sources", input: baseInput }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("validates native-only path-free candidate-knowledge file intake", async () => {
    const input = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      selection: "native-dialog",
      displayName: "Career history",
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.import-file", input })).toEqual({
      type: "knowledge.import-file",
      input,
    });
    for (const invalid of [
      { ...input, selection: "path" },
      { ...input, sourcePath: "/private/resume.md" },
      { storeId: "store-1", knowledgeBaseId: "kb-1" },
      { ...input, displayName: " " },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.import-file", input: invalid }),
      ).toThrow("invalid");
    }

    const port = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceId: "source-1",
            kind: "file",
            versionId: "version-1",
            version: 1,
            created: true,
          },
        }),
        ["knowledge.import-file"],
      ),
    );
    await expect(port.execute({ type: "knowledge.import-file", input })).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        sourceId: "source-1",
        kind: "file",
        versionId: "version-1",
        version: 1,
        created: true,
      },
    });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceId: "source-1",
            kind: "file",
            versionId: "version-1",
            version: 1,
            created: true,
            sourcePath: "/private/resume.md",
          },
        }),
        ["knowledge.import-file"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.import-file", input }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("requires approval and redacts candidate-knowledge URL intake results", async () => {
    const input = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      url: "https://example.com/private-profile?token=sensitive",
      approved: true,
      displayName: "Remote career history",
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.import-url", input })).toEqual({
      type: "knowledge.import-url",
      input,
    });
    for (const invalid of [
      { ...input, approved: false },
      { ...input, approved: undefined },
      { ...input, url: "http://example.com/profile" },
      { ...input, displayName: " " },
    ]) {
      expect(() => validateBridgeCommand({ type: "knowledge.import-url", input: invalid })).toThrow(
        "invalid",
      );
    }

    const port = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceId: "source-url-1",
            kind: "url",
            versionId: "version-url-1",
            version: 1,
            created: true,
          },
        }),
        ["knowledge.import-url"],
      ),
    );
    const imported = await port.execute({ type: "knowledge.import-url", input });
    expect(imported).toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        sourceId: "source-url-1",
        kind: "url",
        versionId: "version-url-1",
        version: 1,
        created: true,
      },
    });
    expect(JSON.stringify(imported)).not.toContain("example.com");
    expect(JSON.stringify(imported)).not.toContain("sensitive");

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            storeId: "store-1",
            knowledgeBaseId: "kb-1",
            sourceId: "source-url-1",
            kind: "url",
            versionId: "version-url-1",
            version: 1,
            created: true,
            url: input.url,
          },
        }),
        ["knowledge.import-url"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.import-url", input }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("carries an explicit path-free knowledge selection and combination approval", async () => {
    const input = {
      workspaceId: "workspace-1",
      entries: [
        { storeId: "store-2", knowledgeBaseId: "kb-2" },
        { storeId: "store-1", knowledgeBaseId: "kb-1" },
      ],
      combinationApproved: true,
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.select", input })).toEqual({
      type: "knowledge.select",
      input,
    });

    const port = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: { workspaceId: "workspace-1", entries: input.entries },
        }),
        ["knowledge.select"],
      ),
    );
    await expect(port.execute({ type: "knowledge.select", input })).resolves.toEqual({
      ok: true,
      value: { workspaceId: "workspace-1", entries: input.entries },
    });

    for (const invalidInput of [
      { ...input, entries: [] },
      { ...input, entries: [input.entries[0], input.entries[0]] },
      { ...input, combinationApproved: "yes" },
      {
        ...input,
        entries: [{ ...input.entries[0], storeRoot: "/private/candidate-data" }],
      },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.select", input: invalidInput }),
      ).toThrow("invalid");
    }
  });

  it("validates path-free CKB maintenance commands and explicit archive confirmation", () => {
    expect(
      validateBridgeCommand({
        type: "knowledge.create-base",
        input: {
          storeId: "store-1",
          displayName: "Public projects",
          description: "Selected public work",
        },
      }),
    ).toMatchObject({ type: "knowledge.create-base", input: { storeId: "store-1" } });
    expect(
      validateBridgeCommand({
        type: "knowledge.rename-base",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2", displayName: "Open source" },
      }),
    ).toMatchObject({ type: "knowledge.rename-base", input: { knowledgeBaseId: "kb-2" } });
    expect(
      validateBridgeCommand({
        type: "knowledge.archive-base",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2", confirmed: true },
      }),
    ).toEqual({
      type: "knowledge.archive-base",
      input: { storeId: "store-1", knowledgeBaseId: "kb-2", confirmed: true },
    });

    for (const command of [
      {
        type: "knowledge.create-base",
        input: { storeId: "store-1", displayName: "", storeRoot: "/private/store" },
      },
      {
        type: "knowledge.rename-base",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2", displayName: " " },
      },
      {
        type: "knowledge.archive-base",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2" },
      },
    ]) {
      expect(() => validateBridgeCommand(command)).toThrow("invalid");
    }
  });
});
