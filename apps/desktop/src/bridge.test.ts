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

function canonicalCandidateProfileResult(
  version = 1,
  status: "draft" | "reviewed" = "draft",
): Record<string, unknown> {
  const capturedAt = "2026-08-28T10:00:00.000Z";
  return {
    workspaceId: "workspace-1",
    profileId: "profile-1",
    version,
    parentVersion: version === 1 ? null : version - 1,
    status,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    reviewedAt: status === "reviewed" ? capturedAt : null,
    checksum: "b".repeat(64),
    facts: [
      {
        id: "fact-link",
        category: "approved-link",
        field: "url",
        value: "https://approved.example.test/me",
        provenance: [
          {
            storeId: "store-1",
            knowledgeBaseId: "knowledge-1",
            sourceId: "source-1",
            versionId: "version-1",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
  };
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

  it("keeps opportunity intake strict and path-free while preserving approval intent", () => {
    const command = validateBridgeCommand({
      type: "opportunity.create",
      input: {
        workspaceId: "workspace-1",
        providerTransmissionApproved: true,
        sources: [
          {
            id: "job-url",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://jobs.example.test/roles/1",
            approved: true,
          },
          {
            id: "candidate-notes",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "Use a direct tone.\nDo not claim production experience.",
            instructions: {
              tone: "direct",
              forbiddenLanguage: ["world-class"],
            },
          },
          {
            id: "local-job",
            kind: "local-file",
            classification: "company-context",
            selection: "native-dialog",
          },
        ],
      },
    });
    expect(command).toEqual({
      type: "opportunity.create",
      input: {
        workspaceId: "workspace-1",
        providerTransmissionApproved: true,
        sources: [
          {
            id: "job-url",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://jobs.example.test/roles/1",
            approved: true,
          },
          {
            id: "candidate-notes",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "Use a direct tone.\nDo not claim production experience.",
            instructions: {
              tone: "direct",
              forbiddenLanguage: ["world-class"],
            },
          },
          {
            id: "local-job",
            kind: "local-file",
            classification: "company-context",
            selection: "native-dialog",
          },
        ],
      },
    });

    expect(
      validateBridgeCommand({
        type: "opportunity.create",
        input: {
          workspaceId: "workspace-1",
          sources: [
            {
              id: "pasted-job",
              kind: "pasted-content",
              classification: "company-context",
              content: "Local draft only.",
            },
          ],
        },
      }),
    ).toEqual({
      type: "opportunity.create",
      input: {
        workspaceId: "workspace-1",
        sources: [
          {
            id: "pasted-job",
            kind: "pasted-content",
            classification: "company-context",
            content: "Local draft only.",
          },
        ],
      },
    });
    expect(
      validateBridgeCommand({
        type: "opportunity.create",
        input: {
          workspaceId: "workspace-1",
          providerTransmissionApproved: false,
          sources: [
            {
              id: "pasted-job",
              kind: "pasted-content",
              classification: "company-context",
              content: "Local draft only.",
            },
          ],
        },
      }),
    ).toMatchObject({
      type: "opportunity.create",
      input: { providerTransmissionApproved: false },
    });

    for (const input of [
      {
        workspaceId: "workspace-1",
        sources: [],
      },
      {
        workspaceId: "workspace-1",
        providerTransmissionApproved: true,
        sources: [
          {
            id: "local-job",
            kind: "local-file",
            classification: "job-posting",
            selection: "native-dialog",
            path: "/private/should-not-cross",
          },
        ],
      },
      {
        workspaceId: "workspace-1",
        providerTransmissionApproved: true,
        sources: [
          {
            id: "job-url",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://jobs.example.test/roles/1",
            approved: false,
          },
        ],
      },
    ]) {
      expect(() => validateBridgeCommand({ type: "opportunity.create", input })).toThrow("invalid");
    }
  });

  it("validates bounded opportunity edits and requires an expected version", () => {
    expect(
      validateBridgeCommand({
        type: "opportunity.edit",
        input: {
          workspaceId: "workspace-1",
          briefId: "brief-1",
          expectedVersion: 1,
          patch: {
            role: { value: "Senior platform engineer", sourceIds: ["job-1"] },
            requirements: [
              {
                id: "req-1",
                text: "Experience with TypeScript",
                priority: "high",
                sourceIds: ["job-1"],
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      type: "opportunity.edit",
      input: { expectedVersion: 1, patch: { role: { value: "Senior platform engineer" } } },
    });

    for (const input of [
      { workspaceId: "workspace-1", briefId: "brief-1", patch: {} },
      {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: { role: { value: "x", sourceIds: ["missing"] }, unknown: true },
      },
      {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 0,
        patch: {},
      },
    ]) {
      expect(() => validateBridgeCommand({ type: "opportunity.edit", input })).toThrow("invalid");
    }
    expect(() =>
      validateBridgeCommand({
        type: "opportunity.review",
        input: { workspaceId: "workspace-1", briefId: "brief-1" },
      }),
    ).toThrow("invalid");
  });

  it("dispatches and normalizes only bounded opportunity metadata", async () => {
    const value = {
      workspaceId: "workspace-1",
      briefId: "brief-1",
      version: 1,
      priorVersion: null,
      status: "draft",
      createdAt: "2026-08-28T10:00:00.000Z",
      reviewedAt: null,
      checksum: null,
      sources: [
        {
          id: "job-1",
          kind: "approved-url",
          classification: "job-posting",
          status: "available",
          checksum: "a".repeat(64),
          capturedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      role: { value: "Senior platform engineer", sourceIds: ["job-1"] },
      employer: { value: "Example Corp", sourceIds: ["job-1"] },
      responsibilities: [{ id: "resp-1", text: "Build platform services", sourceIds: ["job-1"] }],
      requirements: [
        {
          id: "req-1",
          text: "Experience with TypeScript",
          priority: "high",
          sourceIds: ["job-1"],
        },
      ],
      priorities: [{ id: "priority-1", text: "Reliability", sourceIds: ["job-1"] }],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [],
    };
    const invoke = vi.fn(async () => ({ ok: true as const, value }));
    const port = createCapabilityPort(bridge(invoke, ["opportunity.get"]));
    await expect(
      port.execute({
        type: "opportunity.get",
        input: { workspaceId: "workspace-1", briefId: "brief-1" },
      }),
    ).resolves.toEqual({ ok: true, value });
    expect(invoke).toHaveBeenCalledWith({
      type: "opportunity.get",
      input: { workspaceId: "workspace-1", briefId: "brief-1" },
    });

    const leaking = createCapabilityPort(
      bridge(
        async () => ({
          ok: true as const,
          value: {
            ...value,
            sources: [{ ...value.sources[0], originalUrl: "https://private.example.test" }],
          },
        }),
        ["opportunity.get"],
      ),
    );
    await expect(
      leaking.execute({
        type: "opportunity.get",
        input: { workspaceId: "workspace-1", briefId: "brief-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
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

  it("accepts a lowercase writing-policy override checksum only on direct run.start", () => {
    const checksum = "a".repeat(64);
    expect(
      validateBridgeCommand({
        type: "run.start",
        input: {
          workspaceId: "workspace-1",
          opportunityBrief: { briefId: "brief-1", version: 2 },
          writingPolicyOverrideChecksum: checksum,
        },
      }),
    ).toEqual({
      type: "run.start",
      input: {
        workspaceId: "workspace-1",
        opportunityBrief: { briefId: "brief-1", version: 2 },
        writingPolicyOverrideChecksum: checksum,
      },
    });
    for (const invalidChecksum of [
      "A".repeat(64),
      "a".repeat(63),
      `${"a".repeat(63)}g`,
      `${"a".repeat(64)}x`,
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "run.start",
          input: { workspaceId: "workspace-1", writingPolicyOverrideChecksum: invalidChecksum },
        }),
      ).toThrow("invalid");
    }
  });

  it("keeps opportunity policy selection single-file and text-only", () => {
    expect(
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          target: "writing-policy-override",
          multiple: false,
          extensions: [".md", ".txt"],
        },
      }),
    ).toMatchObject({
      type: "file.select",
      input: { target: "writing-policy-override", multiple: false },
    });
    expect(() =>
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          target: "writing-policy-override",
          multiple: true,
          extensions: [".md"],
        },
      }),
    ).toThrow("invalid");
    expect(() =>
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          target: "writing-policy-override",
          multiple: false,
          extensions: [".pdf"],
        },
      }),
    ).toThrow("invalid");
  });

  it("round-trips safe writing-policy metadata and rejects content or broken lineage", async () => {
    const baseChecksum = "a".repeat(64);
    const overrideChecksum = "b".repeat(64);
    const base = {
      checksum: baseChecksum,
      version: "sha256:aaaaaaaaaaaa",
      schemaVersion: 1,
      createdAt: "2026-08-28T10:00:00.000Z",
      priorChecksum: null,
    };
    const override = {
      checksum: overrideChecksum,
      version: "sha256:bbbbbbbbbbbb",
      schemaVersion: 1,
      createdAt: "2026-08-28T10:01:00.000Z",
      priorChecksum: baseChecksum,
    };
    const state = createFixtureReviewState();
    const safeState = {
      ...state,
      writingPolicy: {
        effective: override,
        lineage: {
          kind: "opportunity-override" as const,
          base: { version: base.version, checksum: base.checksum },
          override: { version: override.version, checksum: override.checksum },
        },
        base,
        override,
      },
      setup: {
        ...state.setup,
        writingPolicy: base,
        writingPolicyHistory: [base, override],
        reviewedOpportunity: { briefId: "brief-1", version: 2 },
        pendingWritingPolicyOverride: {
          checksum: override.checksum,
          version: override.version,
          opportunityBrief: { briefId: "brief-1", version: 2 },
        },
      },
    };
    const port = createCapabilityPort(
      bridge(async (command) => {
        if (command.type === "review.load") return { ok: true, value: safeState };
        return {
          ok: true,
          value: {
            workspaceId: "workspace-1",
            runId: null,
            state: "collecting",
            round: 0,
            approval: "pending",
          },
        };
      }),
    );
    await expect(port.execute({ type: "review.load", input: {} })).resolves.toMatchObject({
      ok: true,
      value: {
        writingPolicy: {
          effective: { checksum: overrideChecksum },
          lineage: { kind: "opportunity-override" },
        },
      },
    });

    const contentBearing = {
      ...safeState,
      setup: { ...safeState.setup, writingPolicy: { ...base, content: "private policy" } },
    };
    const rejectingPort = createCapabilityPort(
      bridge(async (command) =>
        command.type === "review.load"
          ? { ok: true, value: contentBearing }
          : { ok: false, error: { code: "not-found", message: "unused" } },
      ),
    );
    await expect(rejectingPort.execute({ type: "review.load", input: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: "operation-failed" },
    });

    const brokenLineage = {
      ...safeState,
      writingPolicy: {
        ...safeState.writingPolicy,
        lineage: {
          kind: "opportunity-override" as const,
          base: { version: base.version, checksum: base.checksum.toUpperCase() },
          override: { version: override.version, checksum: override.checksum },
        },
      },
    };
    const brokenPort = createCapabilityPort(
      bridge(async (command) =>
        command.type === "review.load"
          ? { ok: true, value: brokenLineage }
          : { ok: false, error: { code: "not-found", message: "unused" } },
      ),
    );
    await expect(brokenPort.execute({ type: "review.load", input: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: "operation-failed" },
    });
  });

  it("validates an optional exact reviewed opportunity selection only on run.start", () => {
    expect(
      validateBridgeCommand({
        type: "run.start",
        input: { workspaceId: "workspace-1" },
      }),
    ).toEqual({ type: "run.start", input: { workspaceId: "workspace-1" } });

    expect(
      validateBridgeCommand({
        type: "run.start",
        input: {
          workspaceId: "workspace-1",
          opportunityBrief: { briefId: "brief-1", version: 3 },
        },
      }),
    ).toEqual({
      type: "run.start",
      input: {
        workspaceId: "workspace-1",
        opportunityBrief: { briefId: "brief-1", version: 3 },
      },
    });

    for (const opportunityBrief of [
      null,
      {},
      { briefId: "brief-1" },
      { version: 1 },
      { briefId: "brief-1", version: 0 },
      { briefId: "brief-1", version: -1 },
      { briefId: "brief-1", version: 1.5 },
      { briefId: "brief-1", version: "1" },
      { briefId: "brief-1", version: 1, path: "/private/brief" },
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "run.start",
          input: { workspaceId: "workspace-1", opportunityBrief },
        }),
      ).toThrow("invalid");
    }

    expect(() =>
      validateBridgeCommand({
        type: "run.start",
        input: {
          workspaceId: "workspace-1",
          opportunityBrief: { briefId: "../private", version: 1 },
        },
      }),
    ).toThrow("invalid");

    expect(
      validateBridgeCommand({
        type: "run.start",
        input: {
          workspaceId: "workspace-1",
          candidateProfile: { profileId: "profile-1", version: 2 },
        },
      }),
    ).toEqual({
      type: "run.start",
      input: {
        workspaceId: "workspace-1",
        candidateProfile: { profileId: "profile-1", version: 2 },
      },
    });

    for (const candidateProfile of [
      null,
      {},
      { profileId: "profile-1" },
      { version: 1 },
      { profileId: "profile-1", version: 0 },
      { profileId: "profile-1", version: 1.5 },
      { profileId: "profile-1", version: "1" },
      { profileId: "profile-1", version: 1, path: "/private/profile" },
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "run.start",
          input: { workspaceId: "workspace-1", candidateProfile },
        }),
      ).toThrow("invalid");
    }

    expect(() =>
      validateBridgeCommand({
        type: "run.start",
        input: {
          workspaceId: "workspace-1",
          candidateProfile: { profileId: "../private", version: 1 },
        },
      }),
    ).toThrow("invalid");
    expect(() =>
      validateBridgeCommand({
        type: "run.resume",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          opportunityBrief: { briefId: "brief-1", version: 1 },
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

  it("strictly validates and normalizes provider authentication mode commands", async () => {
    expect(
      validateBridgeCommand({
        type: "provider-auth.status",
        input: { provider: "openai" },
      }),
    ).toEqual({ type: "provider-auth.status", input: { provider: "openai" } });
    expect(
      validateBridgeCommand({
        type: "provider-auth.set",
        input: { provider: "openai", mode: "user-session" },
      }),
    ).toEqual({
      type: "provider-auth.set",
      input: { provider: "openai", mode: "user-session" },
    });
    for (const input of [
      { provider: "openai", mode: "oauth" },
      { provider: "openai", mode: "user-session", extra: true },
      { provider: "local", mode: "api-key" },
    ]) {
      expect(() => validateBridgeCommand({ type: "provider-auth.set", input })).toThrow("invalid");
    }

    const port = createCapabilityPort(
      bridge(
        async (command) => ({
          ok: true,
          value:
            command.type === "provider-auth.set"
              ? {
                  provider: "openai",
                  activeMode: "api-key",
                  preferredMode: "user-session",
                  restartRequired: true,
                  environmentOverride: false,
                }
              : {
                  provider: "openai",
                  activeMode: "api-key",
                  preferredMode: "api-key",
                  restartRequired: false,
                  environmentOverride: false,
                },
        }),
        ["provider-auth.status", "provider-auth.set"],
      ),
    );
    await expect(
      port.execute({ type: "provider-auth.status", input: { provider: "openai" } }),
    ).resolves.toEqual({
      ok: true,
      value: {
        provider: "openai",
        activeMode: "api-key",
        preferredMode: "api-key",
        restartRequired: false,
        environmentOverride: false,
      },
    });
    await expect(
      port.execute({
        type: "provider-auth.set",
        input: { provider: "openai", mode: "user-session" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { activeMode: "api-key", preferredMode: "user-session", restartRequired: true },
    });

    const reviewPort = createBridgeReviewPort(
      createCapabilityPort(
        bridge(
          async (command) => ({
            ok: true,
            value: {
              provider: "openai",
              activeMode: "api-key",
              preferredMode: command.type === "provider-auth.set" ? "user-session" : "api-key",
              restartRequired: command.type === "provider-auth.set",
              environmentOverride: false,
            },
          }),
          ["provider-auth.status", "provider-auth.set"],
        ),
      ),
    );
    await expect(reviewPort.getProviderAuthModeStatus?.("openai")).resolves.toMatchObject({
      activeMode: "api-key",
    });
    await expect(reviewPort.setProviderAuthMode?.("openai", "user-session")).resolves.toMatchObject(
      {
        preferredMode: "user-session",
        restartRequired: true,
      },
    );

    const hostile = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            provider: "openai",
            activeMode: "api-key",
            preferredMode: "api-key",
            restartRequired: false,
            environmentOverride: false,
            secret: "must not cross",
          },
        }),
        ["provider-auth.status"],
      ),
    );
    await expect(
      hostile.execute({ type: "provider-auth.status", input: { provider: "openai" } }),
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

  it("adapts opportunity capabilities with the active workspace identity", async () => {
    const state = createFixtureReviewState();
    const record = {
      workspaceId: state.workspaceId,
      briefId: "brief-1",
      version: 1,
      priorVersion: null,
      status: "draft",
      createdAt: "2026-08-28T10:00:00.000Z",
      reviewedAt: null,
      checksum: null,
      sources: [
        {
          id: "candidate-guidance",
          kind: "candidate-input",
          classification: "candidate-instruction",
          status: "available",
          checksum: "a".repeat(64),
          capturedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      role: null,
      employer: null,
      responsibilities: [],
      requirements: [],
      priorities: [],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [],
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "review.load") return { ok: true, value: state };
      if (command.type === "opportunity.list") {
        return {
          ok: true,
          value: { workspaceId: state.workspaceId, briefId: "brief-1", versions: [record] },
        };
      }
      return { ok: true, value: record };
    });
    const port = createBridgeReviewPort(
      createCapabilityPort(
        bridge(invoke, [
          "review.load",
          "opportunity.create",
          "opportunity.get",
          "opportunity.list",
          "opportunity.edit",
          "opportunity.review",
        ]),
      ),
    );

    await expect(
      port.createOpportunity?.({
        sources: [
          {
            id: "candidate-guidance",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "Use a direct tone.",
          },
        ],
        providerTransmissionApproved: false,
      }),
    ).resolves.toEqual(record);
    await expect(port.getOpportunity?.("brief-1")).resolves.toEqual(record);
    await expect(port.listOpportunityVersions?.("brief-1")).resolves.toMatchObject({
      versions: [record],
    });
    await expect(
      port.editOpportunity?.({ briefId: "brief-1", expectedVersion: 1, patch: {} }),
    ).resolves.toEqual(record);
    await expect(port.reviewOpportunity?.("brief-1", 1)).resolves.toEqual(record);

    const operationCalls = invoke.mock.calls
      .map(([command]) => command)
      .filter((command) => command.type.startsWith("opportunity."));
    expect(operationCalls).toEqual([
      {
        type: "opportunity.create",
        input: {
          workspaceId: state.workspaceId,
          sources: [
            {
              id: "candidate-guidance",
              kind: "candidate-input",
              classification: "candidate-instruction",
              content: "Use a direct tone.",
            },
          ],
          providerTransmissionApproved: false,
        },
      },
      {
        type: "opportunity.get",
        input: { workspaceId: state.workspaceId, briefId: "brief-1" },
      },
      {
        type: "opportunity.list",
        input: { workspaceId: state.workspaceId, briefId: "brief-1" },
      },
      {
        type: "opportunity.edit",
        input: {
          workspaceId: state.workspaceId,
          briefId: "brief-1",
          expectedVersion: 1,
          patch: {},
        },
      },
      {
        type: "opportunity.review",
        input: { workspaceId: state.workspaceId, briefId: "brief-1", expectedVersion: 1 },
      },
    ]);
  });

  it("keeps canonical profile commands strict, path-free, and explicitly approved", () => {
    const reference = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "source-1",
      versionId: "version-1",
      kind: "candidate-provided",
    } as const;
    const fact = {
      id: "fact-link",
      category: "approved-link",
      field: "url",
      value: "https://approved.example.test/me",
      provenance: [reference],
    } as const;
    const commands = [
      {
        type: "profile.derive" as const,
        input: {
          workspaceId: "workspace-1",
          profileId: "profile-1",
          providerTransmissionApproved: true,
        },
      },
      {
        type: "profile.get" as const,
        input: { workspaceId: "workspace-1", profileId: "profile-1", version: 2 },
      },
      {
        type: "profile.list" as const,
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      },
      {
        type: "profile.edit" as const,
        input: {
          workspaceId: "workspace-1",
          profileId: "profile-1",
          expectedVersion: 1,
          patch: { facts: [fact] },
        },
      },
      {
        type: "profile.review" as const,
        input: { workspaceId: "workspace-1", profileId: "profile-1", expectedVersion: 1 },
      },
    ];

    for (const command of commands) {
      expect(validateBridgeCommand(command)).toEqual(command);
    }
    expect(
      validateBridgeCommand({
        type: "profile.derive",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).toEqual({
      type: "profile.derive",
      input: { workspaceId: "workspace-1", profileId: "profile-1" },
    });

    for (const input of [
      { workspaceId: "workspace-1", profileId: "profile-1", root: "/private" },
      { workspaceId: "workspace-1", profileId: "profile-1", storeRoot: "/private" },
      { workspaceId: "workspace-1", profileId: "profile:unsafe" },
      {
        workspaceId: "workspace-1",
        profileId: "profile-1",
        expectedVersion: 1,
        patch: { facts: [{ ...fact, path: "/private" }] },
      },
      {
        workspaceId: "workspace-1",
        profileId: "profile-1",
        expectedVersion: 1,
        patch: { facts: [{ ...fact, sourceUrl: "https://private.example.test" }] },
      },
    ]) {
      const type = "expectedVersion" in input ? "profile.edit" : "profile.derive";
      expect(() => validateBridgeCommand({ type, input })).toThrow("invalid");
    }
  });

  it("normalizes canonical profile results while rejecting malformed lineage and leaked fields", async () => {
    const record = canonicalCandidateProfileResult();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "profile.list") {
        return {
          ok: true,
          value: {
            workspaceId: "workspace-1",
            profileId: "profile-1",
            versions: [record],
          },
        };
      }
      return { ok: true, value: record };
    });
    const port = createCapabilityPort(
      bridge(invoke, [
        "profile.derive",
        "profile.get",
        "profile.list",
        "profile.edit",
        "profile.review",
      ]),
    );

    await expect(
      port.execute({
        type: "profile.derive",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        profileId: "profile-1",
        facts: [{ category: "approved-link", value: "https://approved.example.test/me" }],
      },
    });
    await expect(
      port.execute({
        type: "profile.list",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { versions: [{ version: 1 }] } });

    const malformedHistoryPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            workspaceId: "workspace-1",
            profileId: "profile-1",
            versions: [record, { ...record, version: 3, parentVersion: 2 }],
          },
        }),
        ["profile.list"],
      ),
    );
    await expect(
      malformedHistoryPort.execute({
        type: "profile.list",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });

    const leakedFactPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            ...record,
            facts: [
              { ...(record.facts as readonly Record<string, unknown>[])[0], path: "/private" },
            ],
          },
        }),
        ["profile.get"],
      ),
    );
    await expect(
      leakedFactPort.execute({
        type: "profile.get",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });

    const leakedSelectionPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: { ...record, candidateKnowledgeSelection: { entries: [] } },
        }),
        ["profile.get"],
      ),
    );
    await expect(
      leakedSelectionPort.execute({
        type: "profile.get",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
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

  it("keeps portable backup paths native and validates bounded integrity results", async () => {
    const exportInput = {
      storeId: "store-1",
      selection: "native-dialog",
      name: "candidate-backup",
      approved: true,
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.backup-export", input: exportInput })).toEqual({
      type: "knowledge.backup-export",
      input: exportInput,
    });
    expect(
      validateBridgeCommand({
        type: "knowledge.backup-inspect",
        input: { selection: "native-dialog" },
      }),
    ).toEqual({ type: "knowledge.backup-inspect", input: { selection: "native-dialog" } });
    for (const input of [
      { ...exportInput, approved: false },
      { ...exportInput, destination: "/private/backup" },
      { ...exportInput, name: "../backup" },
    ]) {
      expect(() => validateBridgeCommand({ type: "knowledge.backup-export", input })).toThrow(
        "invalid",
      );
    }

    const portableResult = {
      format: "draft-loop-candidate-knowledge-backup",
      schemaVersion: 1,
      status: "exported",
      descriptorSchemaVersion: 1,
      storeId: "store-1",
      createdAt: "2026-08-24T20:00:00.000Z",
      manifestChecksum: "a".repeat(64),
      knowledgeBaseCount: 1,
      sourceCount: 2,
      versionCount: 3,
      contentObjectCount: 3,
      contentBytes: 128,
      integrity: "integrity-verified-not-authenticity",
    };
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value: portableResult }), ["knowledge.backup-export"]),
    );
    await expect(
      port.execute({ type: "knowledge.backup-export", input: exportInput }),
    ).resolves.toEqual({ ok: true, value: portableResult });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: { ...portableResult, destination: "/private/backup" },
        }),
        ["knowledge.backup-export"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.backup-export", input: exportInput }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("keeps restore selections native and accepts only the fail-if-existing policy", async () => {
    const restoreInput = {
      packageSelection: "native-dialog",
      destinationSelection: "native-dialog",
      name: "restored-candidate-store",
      collision: "fail-if-destination-exists",
    } as const;
    expect(
      validateBridgeCommand({ type: "knowledge.backup-restore", input: restoreInput }),
    ).toEqual({ type: "knowledge.backup-restore", input: restoreInput });
    for (const input of [
      { ...restoreInput, collision: "overwrite" },
      { ...restoreInput, packagePath: "/private/backup" },
      { ...restoreInput, destinationSelection: "path" },
      { ...restoreInput, name: "../restored" },
    ]) {
      expect(() => validateBridgeCommand({ type: "knowledge.backup-restore", input })).toThrow(
        "invalid",
      );
    }

    const restoredResult = {
      status: "restored",
      format: "draft-loop-candidate-knowledge-backup",
      schemaVersion: 1,
      storeId: "store-1",
      manifestChecksum: "a".repeat(64),
      knowledgeBaseCount: 1,
      sourceCount: 2,
      versionCount: 3,
      contentObjectCount: 3,
      contentBytes: 128,
      integrity: "integrity-verified-not-authenticity",
    } as const;
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value: restoredResult }), ["knowledge.backup-restore"]),
    );
    await expect(
      port.execute({ type: "knowledge.backup-restore", input: restoreInput }),
    ).resolves.toEqual({ ok: true, value: restoredResult });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...restoredResult, destination: "/private/store" } }),
        ["knowledge.backup-restore"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.backup-restore", input: restoreInput }),
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

  it("validates bounded path-free candidate-knowledge directory intake", async () => {
    const input = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      selection: "native-dialog",
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.import-directory", input })).toEqual({
      type: "knowledge.import-directory",
      input,
    });
    for (const invalid of [
      { ...input, selection: "path" },
      { ...input, directoryPath: "/private/career" },
      { storeId: "store-1", knowledgeBaseId: "kb-1" },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.import-directory", input: invalid }),
      ).toThrow("invalid");
    }

    const value = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      status: "complete",
      directoryId: "directory-1",
      scannedEntryCount: 3,
      discoveredFileCount: 2,
      skippedEntryCount: 1,
      sourceCount: 2,
      sources: [
        { sourceId: "source-1", versionId: "version-1", version: 1, created: true },
        { sourceId: "source-2", versionId: "version-2", version: 1, created: true },
      ],
      sourcesTruncated: false,
    } as const;
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value }), ["knowledge.import-directory"]),
    );
    await expect(port.execute({ type: "knowledge.import-directory", input })).resolves.toEqual({
      ok: true,
      value,
    });

    for (const invalidValue of [
      { ...value, status: "partial" },
      { ...value, directoryId: undefined },
      { ...value, sourceCount: 1 },
      { ...value, discoveredFileCount: 1 },
      { ...value, scannedEntryCount: 4, discoveredFileCount: 3 },
      { ...value, sourcesTruncated: true },
      { ...value, sources: [value.sources[0], value.sources[0]] },
      { ...value, directoryPath: "/private/career" },
    ]) {
      const invalidPort = createCapabilityPort(
        bridge(async () => ({ ok: true, value: invalidValue }), ["knowledge.import-directory"]),
      );
      await expect(
        invalidPort.execute({ type: "knowledge.import-directory", input }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }

    const { directoryId: _directoryId, ...valueWithoutDirectoryId } = value;
    const partialValue = {
      ...valueWithoutDirectoryId,
      status: "partial" as const,
      sourceCount: 1,
      sources: [value.sources[0]],
    };
    const partialPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: partialValue }), ["knowledge.import-directory"]),
    );
    await expect(
      partialPort.execute({ type: "knowledge.import-directory", input }),
    ).resolves.toMatchObject({ ok: true, value: { status: "partial", sourceCount: 1 } });
  });

  it("validates guarded path-free directory-root rebind controls", async () => {
    const previewInput = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      directoryId: "directory-1",
      selection: "native-dialog",
    } as const;
    const applyInput = { ...previewInput, confirmed: true } as const;
    expect(
      validateBridgeCommand({ type: "knowledge.directory-rebind-preview", input: previewInput }),
    ).toEqual({ type: "knowledge.directory-rebind-preview", input: previewInput });
    expect(
      validateBridgeCommand({ type: "knowledge.directory-rebind-apply", input: applyInput }),
    ).toEqual({ type: "knowledge.directory-rebind-apply", input: applyInput });
    for (const invalid of [
      { ...previewInput, directoryPath: "/private/moved-career" },
      { ...previewInput, selection: "path" },
      { ...previewInput, directoryId: " " },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.directory-rebind-preview", input: invalid }),
      ).toThrow("invalid");
    }

    const checkedAt = "2026-08-24T10:00:00.000Z";
    const previewValue = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      directoryId: "directory-1",
      checkedAt,
      status: "ready",
      memberCount: 2,
      scannedEntryCount: 3,
      discoveredFileCount: 2,
      skippedEntryCount: 1,
    } as const;
    const previewPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: previewValue }),
        ["knowledge.directory-rebind-preview"],
      ),
    );
    await expect(
      previewPort.execute({ type: "knowledge.directory-rebind-preview", input: previewInput }),
    ).resolves.toEqual({ ok: true, value: previewValue });

    const applyValue = { ...previewValue, status: "rebound" as const };
    const applyPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: applyValue }), ["knowledge.directory-rebind-apply"]),
    );
    await expect(
      applyPort.execute({ type: "knowledge.directory-rebind-apply", input: applyInput }),
    ).resolves.toEqual({ ok: true, value: applyValue });

    for (const { capability, value } of [
      {
        capability: "knowledge.directory-rebind-preview" as const,
        value: { ...previewValue, status: "rebound" },
      },
      {
        capability: "knowledge.directory-rebind-apply" as const,
        value: { ...applyValue, status: "ready" },
      },
      {
        capability: "knowledge.directory-rebind-preview" as const,
        value: { ...previewValue, discoveredFileCount: 1 },
      },
      {
        capability: "knowledge.directory-rebind-preview" as const,
        value: { ...previewValue, directoryPath: "/private/moved-career" },
      },
    ]) {
      const invalidPort = createCapabilityPort(
        bridge(async () => ({ ok: true, value }), [capability]),
      );
      const command =
        capability === "knowledge.directory-rebind-apply"
          ? { type: capability, input: applyInput }
          : { type: capability, input: previewInput };
      await expect(invalidPort.execute(command)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("validates bounded path-free directory refresh controls", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", directoryId: "directory-1" };
    expect(validateBridgeCommand({ type: "knowledge.directory-refresh-preview", input })).toEqual({
      type: "knowledge.directory-refresh-preview",
      input,
    });
    expect(
      validateBridgeCommand({
        type: "knowledge.directory-refresh-apply",
        input: { ...input, confirmed: true },
      }),
    ).toEqual({
      type: "knowledge.directory-refresh-apply",
      input: { ...input, confirmed: true },
    });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.directory-refresh-preview",
        input: { ...input, directoryPath: "/private/career" },
      }),
    ).toThrow("invalid");

    const previewValue = {
      ...input,
      checkedAt: "2026-08-24T10:00:00.000Z",
      members: [
        { sourceId: "source-1", status: "changed" },
        { sourceId: "source-2", status: "changed" },
      ],
      memberCount: 2,
      membersTruncated: false,
      newSourceCount: 1,
      scannedEntryCount: 4,
      discoveredFileCount: 3,
      skippedEntryCount: 1,
    } as const;
    const previewPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: previewValue }),
        ["knowledge.directory-refresh-preview"],
      ),
    );
    await expect(
      previewPort.execute({ type: "knowledge.directory-refresh-preview", input }),
    ).resolves.toEqual({ ok: true, value: previewValue });

    const applyValue = {
      ...previewValue,
      status: "partial" as const,
      refreshedSourceIds: ["source-1"],
      refreshedSourceCount: 1,
      refreshedSourceIdsTruncated: false,
      failedSourceId: "source-2",
      failedStatus: "changed" as const,
    };
    const applyPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: applyValue }), ["knowledge.directory-refresh-apply"]),
    );
    await expect(
      applyPort.execute({
        type: "knowledge.directory-refresh-apply",
        input: { ...input, confirmed: true },
      }),
    ).resolves.toEqual({ ok: true, value: applyValue });

    for (const invalidValue of [
      { ...previewValue, membersTruncated: true },
      { ...previewValue, members: [previewValue.members[0], previewValue.members[0]] },
      { ...previewValue, checkedAt: "not-a-time" },
      { ...previewValue, sourcePath: "/private/career" },
    ]) {
      const port = createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: invalidValue }),
          ["knowledge.directory-refresh-preview"],
        ),
      );
      await expect(
        port.execute({ type: "knowledge.directory-refresh-preview", input }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
    for (const invalidValue of [
      { ...applyValue, status: "complete" },
      { ...applyValue, refreshedSourceIdsTruncated: true },
      { ...applyValue, failedStatus: undefined },
      { ...applyValue, refreshedSourceIds: ["source-2"] },
    ]) {
      const port = createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: invalidValue }),
          ["knowledge.directory-refresh-apply"],
        ),
      );
      await expect(
        port.execute({
          type: "knowledge.directory-refresh-apply",
          input: { ...input, confirmed: true },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("validates guarded path-free directory member move controls", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", directoryId: "directory-1" };
    expect(validateBridgeCommand({ type: "knowledge.directory-moved-candidates", input })).toEqual({
      type: "knowledge.directory-moved-candidates",
      input,
    });
    const moveInput = { ...input, sourceId: "source-1", confirmed: true };
    expect(
      validateBridgeCommand({ type: "knowledge.directory-member-move", input: moveInput }),
    ).toEqual({ type: "knowledge.directory-member-move", input: moveInput });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.directory-moved-candidates",
        input: { ...input, directoryPath: "/private" },
      }),
    ).toThrow("invalid");
    const preview = {
      ...input,
      checkedAt: "2026-08-24T10:00:00.000Z",
      candidates: [{ sourceId: "source-1", status: "moved-candidate" }],
      candidateCount: 1,
      candidatesTruncated: false,
      newSourceCount: 1,
      scannedEntryCount: 2,
      discoveredFileCount: 1,
      skippedEntryCount: 1,
    } as const;
    const previewPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: preview }), ["knowledge.directory-moved-candidates"]),
    );
    await expect(
      previewPort.execute({ type: "knowledge.directory-moved-candidates", input }),
    ).resolves.toEqual({ ok: true, value: preview });
    const moved = {
      ...input,
      sourceId: "source-1",
      checkedAt: preview.checkedAt,
      status: "moved" as const,
    };
    const movePort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: moved }), ["knowledge.directory-member-move"]),
    );
    await expect(
      movePort.execute({ type: "knowledge.directory-member-move", input: moveInput }),
    ).resolves.toEqual({ ok: true, value: moved });
    for (const invalid of [
      { ...preview, candidateCount: 2 },
      { ...preview, candidates: [preview.candidates[0], preview.candidates[0]] },
      { ...preview, rootPath: "/private" },
    ]) {
      const port = createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: invalid }),
          ["knowledge.directory-moved-candidates"],
        ),
      );
      await expect(
        port.execute({ type: "knowledge.directory-moved-candidates", input }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("validates confirmed path-free directory member additions", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", directoryId: "directory-1" };
    const addInput = { ...input, confirmed: true } as const;
    expect(
      validateBridgeCommand({ type: "knowledge.directory-add-members", input: addInput }),
    ).toEqual({ type: "knowledge.directory-add-members", input: addInput });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.directory-add-members",
        input: { ...addInput, directoryPath: "/private/career" },
      }),
    ).toThrow("invalid");
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.directory-add-members",
        input: { ...addInput, confirmed: "yes" },
      }),
    ).toThrow("invalid");

    const addedValue = {
      ...input,
      checkedAt: "2026-08-24T10:00:00.000Z",
      members: [{ sourceId: "existing-source", status: "current" }],
      memberCount: 1,
      membersTruncated: false,
      newSourceCount: 2,
      scannedEntryCount: 3,
      discoveredFileCount: 2,
      skippedEntryCount: 1,
      status: "complete" as const,
      addedSourceIds: ["new-source-1", "new-source-2"],
      addedSourceCount: 2,
      addedSourceIdsTruncated: false,
    } as const;
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value: addedValue }), ["knowledge.directory-add-members"]),
    );
    await expect(
      port.execute({ type: "knowledge.directory-add-members", input: addInput }),
    ).resolves.toEqual({ ok: true, value: addedValue });

    for (const invalidValue of [
      { ...addedValue, addedSourceIds: ["new-source-1", "new-source-1"] },
      { ...addedValue, addedSourceCount: 1 },
      { ...addedValue, addedSourceIdsTruncated: true },
      { ...addedValue, status: "partial" },
      { ...addedValue, addedSourceIds: ["new-source-1"], addedSourceCount: 1 },
      { ...addedValue, sourcePath: "/private/career" },
    ]) {
      const invalidPort = createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: invalidValue }),
          ["knowledge.directory-add-members"],
        ),
      );
      await expect(
        invalidPort.execute({ type: "knowledge.directory-add-members", input: addInput }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("validates confirmed path-free directory reconciliation controls", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", directoryId: "directory-1" };
    expect(
      validateBridgeCommand({ type: "knowledge.directory-reconciliation-preview", input }),
    ).toEqual({ type: "knowledge.directory-reconciliation-preview", input });
    const applyInput = { ...input, approvedRetirementSourceIds: ["source-1"], confirmed: true };
    expect(
      validateBridgeCommand({
        type: "knowledge.directory-reconciliation-apply",
        input: applyInput,
      }),
    ).toEqual({ type: "knowledge.directory-reconciliation-apply", input: applyInput });
    const preview = {
      ...input,
      checkedAt: "2026-08-24T10:00:00.000Z",
      members: [{ sourceId: "source-1", status: "missing" }],
      memberCount: 1,
      membersTruncated: false,
      currentCount: 0,
      changedCount: 0,
      alreadyRetiredCount: 0,
      conflictedCount: 0,
      movedCandidateCount: 0,
      missingCount: 1,
      newSourceCount: 0,
      scanStatus: "complete",
      scannedEntryCount: 0,
      discoveredFileCount: 0,
      skippedEntryCount: 0,
    } as const;
    const previewPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: preview }),
        ["knowledge.directory-reconciliation-preview"],
      ),
    );
    await expect(
      previewPort.execute({ type: "knowledge.directory-reconciliation-preview", input }),
    ).resolves.toEqual({ ok: true, value: preview });
    const applied = {
      ...input,
      checkedAt: preview.checkedAt,
      status: "applied",
      retiredSourceIds: ["source-1"],
      retiredSourceCount: 1,
      retiredSourceIdsTruncated: false,
      alreadyRetiredSourceIds: [],
      alreadyRetiredSourceCount: 0,
      alreadyRetiredSourceIdsTruncated: false,
    } as const;
    const applyPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: applied }),
        ["knowledge.directory-reconciliation-apply"],
      ),
    );
    await expect(
      applyPort.execute({ type: "knowledge.directory-reconciliation-apply", input: applyInput }),
    ).resolves.toEqual({ ok: true, value: applied });
  });

  it("validates path-free candidate-knowledge file-version append", async () => {
    const input = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      selection: "native-dialog",
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.append-file-version", input })).toEqual({
      type: "knowledge.append-file-version",
      input,
    });
    for (const invalid of [
      { ...input, selection: "path" },
      { ...input, sourcePath: "/private/resume.md" },
      { storeId: "store-1", knowledgeBaseId: "kb-1", selection: "native-dialog" },
      { ...input, sourceId: " " },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.append-file-version", input: invalid }),
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
            versionId: "version-2",
            version: 2,
            created: false,
          },
        }),
        ["knowledge.append-file-version"],
      ),
    );
    await expect(port.execute({ type: "knowledge.append-file-version", input })).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        sourceId: "source-1",
        kind: "file",
        versionId: "version-2",
        version: 2,
        created: false,
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
            versionId: "version-2",
            version: 2,
            created: true,
            sourcePath: "/private/resume.md",
          },
        }),
        ["knowledge.append-file-version"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.append-file-version", input }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("validates path-free candidate-knowledge source status and refresh results", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", sourceId: "source-1" } as const;
    for (const type of [
      "knowledge.source-origin-status",
      "knowledge.source-refresh-state",
      "knowledge.refresh-file",
    ] as const) {
      expect(validateBridgeCommand({ type, input })).toEqual({ type, input });
      expect(() =>
        validateBridgeCommand({ type, input: { ...input, sourcePath: "/private" } }),
      ).toThrow("invalid");
    }
    expect(
      validateBridgeCommand({
        type: "knowledge.refresh-url",
        input: { ...input, approved: true },
      }),
    ).toEqual({ type: "knowledge.refresh-url", input: { ...input, approved: true } });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.refresh-url",
        input: { ...input, approved: false },
      }),
    ).toThrow("invalid");

    const checkedAt = "2026-08-24T10:00:00.000Z";
    const originPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...input, checkedAt, status: "changed" } }),
        ["knowledge.source-origin-status"],
      ),
    );
    await expect(
      originPort.execute({ type: "knowledge.source-origin-status", input }),
    ).resolves.toEqual({ ok: true, value: { ...input, checkedAt, status: "changed" } });

    const unobservedPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...input, status: "unobserved" } }),
        ["knowledge.source-refresh-state"],
      ),
    );
    await expect(
      unobservedPort.execute({ type: "knowledge.source-refresh-state", input }),
    ).resolves.toEqual({ ok: true, value: { ...input, status: "unobserved" } });

    const statePort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            ...input,
            status: "current",
            checkedAt,
            observedVersionId: "version-2",
            lastRefreshedAt: checkedAt,
            lastRefreshedVersionId: "version-2",
          },
        }),
        ["knowledge.source-refresh-state"],
      ),
    );
    await expect(
      statePort.execute({ type: "knowledge.source-refresh-state", input }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "current", observedVersionId: "version-2" },
    });

    const refreshedPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: { ...input, checkedAt, status: "refreshed", versionId: "version-2" },
        }),
        ["knowledge.refresh-file"],
      ),
    );
    await expect(refreshedPort.execute({ type: "knowledge.refresh-file", input })).resolves.toEqual(
      {
        ok: true,
        value: { ...input, checkedAt, status: "refreshed", versionId: "version-2" },
      },
    );

    for (const { capability, value } of [
      {
        capability: "knowledge.refresh-file" as const,
        value: { ...input, checkedAt, status: "refreshed" },
      },
      {
        capability: "knowledge.refresh-file" as const,
        value: { ...input, checkedAt, status: "current", versionId: "version-2" },
      },
      {
        capability: "knowledge.source-refresh-state" as const,
        value: { ...input, status: "current", observedVersionId: "version-2" },
      },
      {
        capability: "knowledge.source-origin-status" as const,
        value: { ...input, checkedAt, status: "changed", sourcePath: "/private/resume.md" },
      },
    ]) {
      const leakingPort = createCapabilityPort(
        bridge(async () => ({ ok: true, value }), [capability]),
      );
      await expect(leakingPort.execute({ type: capability, input })).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("validates native source rebind and confirmed retirement controls", async () => {
    const input = { storeId: "store-1", knowledgeBaseId: "kb-1", sourceId: "source-1" } as const;
    const rebindInput = { ...input, selection: "native-dialog" } as const;
    expect(validateBridgeCommand({ type: "knowledge.rebind-file", input: rebindInput })).toEqual({
      type: "knowledge.rebind-file",
      input: rebindInput,
    });
    expect(() =>
      validateBridgeCommand({
        type: "knowledge.rebind-file",
        input: { ...rebindInput, sourcePath: "/private/resume.md" },
      }),
    ).toThrow("invalid");
    expect(validateBridgeCommand({ type: "knowledge.source-retirement-state", input })).toEqual({
      type: "knowledge.source-retirement-state",
      input,
    });
    expect(
      validateBridgeCommand({
        type: "knowledge.retire-source",
        input: { ...input, confirmed: false },
      }),
    ).toEqual({ type: "knowledge.retire-source", input: { ...input, confirmed: false } });

    const boundAt = "2026-08-24T10:00:00.000Z";
    const rebindPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...input, status: "rebound", boundAt } }),
        ["knowledge.rebind-file"],
      ),
    );
    await expect(
      rebindPort.execute({ type: "knowledge.rebind-file", input: rebindInput }),
    ).resolves.toEqual({ ok: true, value: { ...input, status: "rebound", boundAt } });

    const activePort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...input, status: "active" } }),
        ["knowledge.source-retirement-state"],
      ),
    );
    await expect(
      activePort.execute({ type: "knowledge.source-retirement-state", input }),
    ).resolves.toEqual({ ok: true, value: { ...input, status: "active" } });

    const retired = { ...input, status: "retired", retiredAt: boundAt, reason: "user-requested" };
    const retiredPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: retired }), ["knowledge.retire-source"]),
    );
    await expect(
      retiredPort.execute({
        type: "knowledge.retire-source",
        input: { ...input, confirmed: true },
      }),
    ).resolves.toEqual({ ok: true, value: retired });

    for (const { capability, value } of [
      {
        capability: "knowledge.rebind-file" as const,
        value: { ...input, status: "rebound", boundAt, sourcePath: "/private/resume.md" },
      },
      {
        capability: "knowledge.source-retirement-state" as const,
        value: { ...input, status: "active", retiredAt: boundAt },
      },
      {
        capability: "knowledge.retire-source" as const,
        value: { ...input, status: "retired", retiredAt: boundAt },
      },
      {
        capability: "knowledge.retire-source" as const,
        value: { ...input, status: "retired", retiredAt: "not-a-time", reason: "user-requested" },
      },
    ]) {
      const invalidPort = createCapabilityPort(
        bridge(async () => ({ ok: true, value }), [capability]),
      );
      const command =
        capability === "knowledge.rebind-file"
          ? { type: capability, input: rebindInput }
          : capability === "knowledge.retire-source"
            ? { type: capability, input: { ...input, confirmed: true } }
            : { type: capability, input };
      await expect(invalidPort.execute(command)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
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
    expect(
      validateBridgeCommand({
        type: "knowledge.delete-base-preview",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2" },
      }),
    ).toEqual({
      type: "knowledge.delete-base-preview",
      input: { storeId: "store-1", knowledgeBaseId: "kb-2" },
    });
    expect(
      validateBridgeCommand({
        type: "knowledge.delete-base",
        input: {
          storeId: "store-1",
          knowledgeBaseId: "kb-2",
          confirmationToken: "a".repeat(64),
          confirmed: true,
        },
      }),
    ).toMatchObject({ type: "knowledge.delete-base", input: { confirmed: true } });

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
      {
        type: "knowledge.delete-base",
        input: {
          storeId: "store-1",
          knowledgeBaseId: "kb-2",
          confirmationToken: "not-a-token",
          confirmed: true,
        },
      },
    ]) {
      expect(() => validateBridgeCommand(command)).toThrow("invalid");
    }
  });

  it("normalizes bounded, path-free CKB deletion previews and results", async () => {
    const token = "a".repeat(64);
    const classes = [
      "raw-sources",
      "normalized-facts",
      "indexes",
      "run-snapshots",
      "exports",
      "backups",
    ].map((retentionClass, index) => ({
      class: retentionClass,
      rule: "retain-until-deletion",
      expireAfterDays: null,
      status: index === 0 ? "delete" : "not-materialized",
      ownershipStatus: index === 0 ? "owned" : "not-materialized",
      managedCount: index === 0 ? 1 : 0,
      eligibleCount: index === 0 ? 1 : 0,
      preservedCount: 0,
      unmanagedCount: 0,
      unknownCount: 0,
      countCapped: false,
      preservationReasons: index === 0 ? [] : ["not-materialized"],
    }));
    const preview = {
      schemaVersion: 1,
      knowledgeBaseId: "kb-2",
      archivedAt: "2026-08-26T10:00:00.000Z",
      status: "ready",
      policyRevision: 1,
      overrideRevision: 0,
      sourceCount: 1,
      versionCount: 1,
      managedArtifactCount: 1,
      managedArtifactBytes: 42,
      preservedUnknownCount: 0,
      preservedUnmanagedCount: 0,
      countCapped: false,
      blockers: [],
      classes,
      confirmationToken: token,
    };
    const previewPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: preview }), ["knowledge.delete-base-preview"]),
    );
    await expect(
      previewPort.execute({
        type: "knowledge.delete-base-preview",
        input: { storeId: "store-1", knowledgeBaseId: "kb-2" },
      }),
    ).resolves.toEqual({ ok: true, value: preview });

    const deletion = {
      schemaVersion: 1,
      status: "deleted",
      knowledgeBaseId: "kb-2",
      operationId: "delete-1",
      auditId: "audit-1",
      confirmationToken: token,
      completedAt: "2026-08-26T10:01:00.000Z",
      managedArtifactCount: 1,
      managedArtifactBytes: 42,
      preservedUnknownCount: 0,
      preservedUnmanagedCount: 0,
      countCapped: false,
    };
    const deletionPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: deletion }), ["knowledge.delete-base"]),
    );
    await expect(
      deletionPort.execute({
        type: "knowledge.delete-base",
        input: {
          storeId: "store-1",
          knowledgeBaseId: "kb-2",
          confirmationToken: token,
          confirmed: true,
        },
      }),
    ).resolves.toEqual({ ok: true, value: deletion });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { ...deletion, audit: { path: "/private/store" } } }),
        ["knowledge.delete-base"],
      ),
    );
    await expect(
      leakingPort.execute({
        type: "knowledge.delete-base",
        input: {
          storeId: "store-1",
          knowledgeBaseId: "kb-2",
          confirmationToken: token,
          confirmed: true,
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });
});
