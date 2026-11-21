import { describe, expect, it, vi } from "vitest";
import {
  bridgeCapabilities,
  createCapabilityPort,
  modelCompanies,
  modelDiscoveryProviders,
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

    const entered = validateBridgeCommand({
      type: "opportunity.edit",
      input: {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: { candidateEmployer: "Example Systems" },
      },
    });
    expect(entered).toMatchObject({ input: { patch: { candidateEmployer: "Example Systems" } } });

    for (const input of [
      {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: { candidateEmployer: "   " },
      },
      {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: { candidateEmployer: 7 },
      },
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

  it("lets an excerpt-bearing brief entry round-trip through the edit validator and the result allowlist", async () => {
    const excerpt = "Experience with TypeScript is required.";
    const validated = validateBridgeCommand({
      type: "opportunity.edit",
      input: {
        workspaceId: "workspace-1",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: {
          responsibilities: [
            {
              id: "resp-1",
              text: "Build",
              sourceIds: ["job-1"],
              excerpt: "Build platform services",
            },
          ],
          requirements: [
            { id: "req-1", text: "TS", priority: "high", sourceIds: ["job-1"], excerpt },
            { id: "req-2", text: "SQL", priority: "low", sourceIds: ["job-1"] },
          ],
        },
      },
    });
    expect(validated).toMatchObject({
      input: {
        patch: {
          responsibilities: [{ excerpt: "Build platform services" }],
          requirements: [{ excerpt }, {}],
        },
      },
    });
    const requirements = (validated as { input: { patch: { requirements: readonly object[] } } })
      .input.patch.requirements;
    expect(requirements[1]).not.toHaveProperty("excerpt");

    for (const bad of ["", "   ", "x".repeat(301), 7]) {
      expect(() =>
        validateBridgeCommand({
          type: "opportunity.edit",
          input: {
            workspaceId: "workspace-1",
            briefId: "brief-1",
            expectedVersion: 1,
            patch: {
              requirements: [
                { id: "req-1", text: "TS", priority: "high", sourceIds: ["job-1"], excerpt: bad },
              ],
            },
          },
        }),
      ).toThrow("invalid");
    }

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
          kind: "pasted-content",
          classification: "job-posting",
          status: "available",
          checksum: "a".repeat(64),
          capturedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      role: null,
      employer: null,
      responsibilities: [
        { id: "resp-1", text: "Build", sourceIds: ["job-1"], excerpt: "Build platform services" },
      ],
      requirements: [{ id: "req-1", text: "TS", priority: "high", sourceIds: ["job-1"], excerpt }],
      priorities: [],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [],
    };
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true as const, value }), ["opportunity.get"]),
    );
    await expect(
      port.execute({
        type: "opportunity.get",
        input: { workspaceId: "workspace-1", briefId: "brief-1" },
      }),
    ).resolves.toEqual({ ok: true, value });
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
    expect(() => validateBridgeCommand({ type: "shell.exec", input: {} })).toThrow("not supported");

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
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "approve", readinessOverrideRationale: "  Checked by hand. " },
        },
      }),
    ).toMatchObject({
      input: { action: { type: "approve", readinessOverrideRationale: "Checked by hand." } },
    });
    for (const readinessOverrideRationale of ["   ", "x".repeat(501), 42]) {
      expect(() =>
        validateBridgeCommand({
          type: "review.dispatch",
          input: {
            workspaceId: "workspace-1",
            runId: "run-1",
            action: { type: "approve", readinessOverrideRationale },
          },
        }),
      ).toThrow("invalid");
    }

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

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: {
            type: "start",
            candidateProfile: { profileId: "profile-1", version: 2 },
          },
        },
      }),
    ).toEqual({
      type: "review.dispatch",
      input: {
        workspaceId: "workspace-1",
        runId: "pending",
        action: {
          type: "start",
          candidateProfile: { profileId: "profile-1", version: 2 },
        },
      },
    });

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start", pageTarget: "one-page" },
        },
      }),
    ).toMatchObject({ input: { action: { type: "start", pageTarget: "one-page" } } });
    for (const pageTarget of ["three-page", "", 1, null]) {
      expect(() =>
        validateBridgeCommand({
          type: "review.dispatch",
          input: {
            workspaceId: "workspace-1",
            runId: "pending",
            action: { type: "start", pageTarget },
          },
        }),
      ).toThrow();
    }

    for (const candidateProfile of [
      null,
      {},
      { profileId: "profile-1" },
      { version: 2 },
      { profileId: "profile-1", version: 0 },
      { profileId: "profile-1", version: 1.5 },
      { profileId: "profile-1", version: "2" },
      { profileId: "profile-1", version: 2, root: "/private/profile" },
      { profileId: "../private", version: 2 },
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "review.dispatch",
          input: {
            workspaceId: "workspace-1",
            runId: "pending",
            action: { type: "start", candidateProfile },
          },
        }),
      ).toThrow("invalid");
    }

    expect(() =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start", root: "/private/profile" },
        },
      }),
    ).toThrow("invalid");

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
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "set-autopilot", enabled: true },
        },
      }),
    ).toMatchObject({ input: { action: { type: "set-autopilot", enabled: true } } });
    for (const action of [
      { type: "set-autopilot" },
      { type: "set-autopilot", enabled: "yes" },
      { type: "set-autopilot", enabled: true, rounds: 9 },
    ]) {
      expect(() =>
        validateBridgeCommand({
          type: "review.dispatch",
          input: { workspaceId: "workspace-1", runId: "run-1", action },
        }),
      ).toThrow();
    }
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

  it("accepts Mistral as a workspace company and model-discovery provider", () => {
    expect(modelCompanies).toContain("mistral");
    expect(modelDiscoveryProviders).toContain("mistral");
    expect(validateBridgeCommand({ type: "models.list", input: { provider: "mistral" } })).toEqual({
      type: "models.list",
      input: { provider: "mistral" },
    });
    const pair = {
      authorCompany: "mistral",
      authorModel: "mistral-large-4",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    };
    expect(
      validateBridgeCommand({
        type: "workspace.configure-models",
        input: { workspaceId: "ws-1", ...pair },
      }),
    ).toEqual({
      type: "workspace.configure-models",
      input: { workspaceId: "ws-1", ...pair },
    });
    expect(() =>
      validateBridgeCommand({
        type: "workspace.configure-models",
        input: { workspaceId: "ws-1", ...pair, authorCompany: "mistral-ai" },
      }),
    ).toThrow("invalid");
  });

  it("reports unavailable browser capabilities without filesystem access", async () => {
    const result = await createBrowserCapabilityPort().execute({
      type: "knowledge.import-file",
      input: { storeId: "store-1", knowledgeBaseId: "kb-1", selection: "native-dialog" },
    });

    expect(result).toEqual(unavailableResult("knowledge.import-file"));
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
            capability: "application.list" as const,
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

  it("keeps canonical profile commands strict, path-free, and explicitly approved", async () => {
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
      {
        type: "profile.catalog" as const,
        input: { workspaceId: "workspace-1" },
      },
    ];

    for (const command of commands) {
      expect(validateBridgeCommand(command)).toEqual(command);
    }
    const catalogInput = {
      type: "profile.catalog" as const,
      input: { workspaceId: "workspace-1" },
    };
    const catalog = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            workspaceId: "workspace-1",
            profiles: [{ profileId: "profile-1", version: 2, reviewedAt: "2026-09-30T12:00:00Z" }],
          },
        }),
        ["profile.catalog"],
      ),
    );
    await expect(catalog.execute(catalogInput)).resolves.toMatchObject({
      ok: true,
      value: { workspaceId: "workspace-1", profiles: [{ profileId: "profile-1", version: 2 }] },
    });
    const withDrafts = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: {
            workspaceId: "workspace-1",
            profiles: [],
            summaries: [
              {
                profileId: "profile-1",
                latestVersion: 1,
                status: "draft",
                updatedAt: "2026-09-30T12:00:00Z",
              },
            ],
          },
        }),
        ["profile.catalog"],
      ),
    );
    await expect(
      withDrafts.execute({
        type: "profile.catalog",
        input: { workspaceId: "workspace-1", includeDrafts: true },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { summaries: [{ profileId: "profile-1", latestVersion: 1, status: "draft" }] },
    });
    await expect(
      withDrafts.execute({
        type: "profile.catalog",
        input: { workspaceId: "workspace-1", includeDrafts: false } as never,
      }),
    ).resolves.toMatchObject({ ok: false });
    const foreignCatalog = createCapabilityPort(
      bridge(
        async () => ({ ok: true, value: { workspaceId: "workspace-other", profiles: [] } }),
        ["profile.catalog"],
      ),
    );
    await expect(foreignCatalog.execute(catalogInput)).resolves.toMatchObject({
      ok: false,
      error: { code: "operation-failed" },
    });
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

  it("accepts full extraction on profile.derive and the source counts on its result", async () => {
    // The interface, the validator allowlist and the result allowlist each name these fields.
    const derive = {
      type: "profile.derive" as const,
      input: { workspaceId: "workspace-1", profileId: "profile-1", fullExtraction: true },
    };
    expect(validateBridgeCommand(derive)).toEqual(derive);
    expect(() =>
      validateBridgeCommand({
        ...derive,
        input: { ...derive.input, fullExtraction: "yes" },
      }),
    ).toThrow("invalid");

    const record = {
      workspaceId: "workspace-1",
      profileId: "profile-1",
      version: 1,
      parentVersion: null,
      status: "draft",
      createdAt: "2026-08-28T08:00:00.000Z",
      updatedAt: "2026-08-28T08:00:00.000Z",
      reviewedAt: null,
      checksum: "a".repeat(64),
      facts: [],
      issues: [],
    };
    const respond = (value: unknown) =>
      createCapabilityPort(bridge(async () => ({ ok: true, value }), ["profile.derive"])).execute(
        derive,
      );
    await expect(
      respond({ ...record, reusedSourceCount: 3, extractedSourceCount: 1 }),
    ).resolves.toEqual({
      ok: true,
      value: { ...record, reusedSourceCount: 3, extractedSourceCount: 1 },
    });
    await expect(respond(record)).resolves.toEqual({ ok: true, value: record });
    for (const drifted of [
      { ...record, reusedSourceCount: 3 },
      { ...record, reusedSourceCount: -1, extractedSourceCount: 1 },
      { ...record, reusedSourceCount: 1.5, extractedSourceCount: 1 },
      { ...record, reusedSourceCount: "3", extractedSourceCount: 1 },
      { ...record, reusedSourceCount: 1, extractedSourceCount: 1, sourcePaths: ["/private"] },
    ]) {
      await expect(respond(drifted)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("validates and normalizes profile progress and cancel commands at runtime", async () => {
    const progress = {
      type: "profile.progress" as const,
      input: { workspaceId: "workspace-1", profileId: "profile-1" },
    };
    const cancel = {
      type: "profile.cancel" as const,
      input: { workspaceId: "workspace-1", profileId: "profile-1" },
    };
    expect(validateBridgeCommand(progress)).toEqual(progress);
    expect(validateBridgeCommand(cancel)).toEqual(cancel);
    expect(bridgeCapabilities).toEqual(
      expect.arrayContaining(["profile.progress", "profile.cancel"]),
    );
    for (const type of ["profile.progress", "profile.cancel"] as const) {
      for (const input of [
        { workspaceId: "workspace-1" },
        { workspaceId: "workspace-1", profileId: "profile:unsafe" },
        { workspaceId: "workspace-1", profileId: "profile-1", root: "/private" },
        { workspaceId: "workspace-1", profileId: "profile-1", providerTransmissionApproved: true },
        "profile-1",
      ]) {
        expect(() => validateBridgeCommand({ type, input })).toThrow("invalid");
      }
    }

    const respond = (value: unknown, type: "profile.progress" | "profile.cancel") =>
      createCapabilityPort(bridge(async () => ({ ok: true, value }), [type])).execute(
        type === "profile.progress" ? progress : cancel,
      );
    await expect(respond({ active: false }, "profile.progress")).resolves.toEqual({
      ok: true,
      value: { active: false },
    });
    await expect(respond({ active: true }, "profile.progress")).resolves.toEqual({
      ok: true,
      value: { active: true },
    });
    await expect(
      respond({ active: true, completedCalls: 1, plannedCalls: 3 }, "profile.progress"),
    ).resolves.toEqual({ ok: true, value: { active: true, completedCalls: 1, plannedCalls: 3 } });
    await expect(respond({ active: true, queued: true }, "profile.progress")).resolves.toEqual({
      ok: true,
      value: { active: true, queued: true },
    });
    for (const malformed of [
      { active: "yes" },
      { active: false, queued: true },
      { active: true, queued: false },
      { active: true, queued: true, completedCalls: 0, plannedCalls: 3 },
      { active: true, completedCalls: 1 },
      { active: false, completedCalls: 1, plannedCalls: 3 },
      { active: true, completedCalls: 4, plannedCalls: 3 },
      { active: true, completedCalls: -1, plannedCalls: 3 },
      { active: true, completedCalls: 0, plannedCalls: 0 },
      { active: true, completedCalls: 0.5, plannedCalls: 3 },
      { active: true, completedCalls: 1, plannedCalls: 3, path: "/private" },
    ]) {
      await expect(respond(malformed, "profile.progress")).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
    await expect(respond({ cancelled: true }, "profile.cancel")).resolves.toEqual({
      ok: true,
      value: { cancelled: true },
    });
    for (const malformed of [{}, { cancelled: "true" }, { cancelled: true, path: "/private" }]) {
      await expect(respond(malformed, "profile.cancel")).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("validates opportunity.cancel at runtime and normalizes its result", async () => {
    const cancel = {
      type: "opportunity.cancel" as const,
      input: { workspaceId: "workspace-1" },
    };
    expect(validateBridgeCommand(cancel)).toEqual(cancel);
    expect(bridgeCapabilities).toContain("opportunity.cancel");
    for (const input of [{}, { workspaceId: "workspace-1", briefId: "brief-1" }, "workspace-1"]) {
      expect(() => validateBridgeCommand({ type: "opportunity.cancel", input })).toThrow("invalid");
    }
    const respond = (value: unknown) =>
      createCapabilityPort(
        bridge(async () => ({ ok: true, value }), ["opportunity.cancel"]),
      ).execute(cancel);
    await expect(respond({ cancelled: false })).resolves.toEqual({
      ok: true,
      value: { cancelled: false },
    });
    for (const malformed of [{}, { cancelled: "true" }, { cancelled: true, path: "/private" }]) {
      await expect(respond(malformed)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
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

  it("carries a fact's exact source quote through results and edits, but never an issue reference's", async () => {
    const record = canonicalCandidateProfileResult();
    const fact = (record.facts as Record<string, unknown>[])[0] ?? {};
    const reference = (fact.provenance as Record<string, unknown>[])[0] ?? {};
    const quote = "Linked from my approved profile page.";
    const quoted = { ...record, facts: [{ ...fact, provenance: [{ ...reference, quote }] }] };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: quoted }));
    const port = createCapabilityPort(bridge(invoke, ["profile.get", "profile.edit"]));

    await expect(
      port.execute({
        type: "profile.get",
        input: { workspaceId: "workspace-1", profileId: "profile-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { facts: [{ provenance: [{ quote }] }] },
    });

    const edit = (patch: unknown) =>
      port.execute({
        type: "profile.edit",
        input: { workspaceId: "workspace-1", profileId: "profile-1", expectedVersion: 1, patch },
      } as never);
    await expect(
      edit({ facts: [{ ...fact, provenance: [{ ...reference, quote }] }] }),
    ).resolves.toMatchObject({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "profile.edit",
      input: expect.objectContaining({
        patch: { facts: [{ ...fact, provenance: [{ ...reference, quote }] }] },
      }),
    });

    for (const badQuote of ["", "x".repeat(2001), 7]) {
      await expect(
        edit({ facts: [{ ...fact, provenance: [{ ...reference, quote: badQuote }] }] }),
      ).resolves.toMatchObject({ ok: false });
    }
    const issue = {
      id: "issue-1",
      code: "omission",
      severity: "warning",
      status: "open",
      message: "Review required.",
      factIds: [],
      sourceRefs: [{ ...reference, quote }],
    };
    await expect(edit({ issues: [issue] })).resolves.toMatchObject({ ok: false });
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

  it("accepts bounded artifact-bound readiness and rejects malformed blocker details", async () => {
    const fixture = createFixtureReviewState();
    const approvalReadiness = {
      artifactId: fixture.artifact.id,
      artifactVersion: fixture.artifact.version,
      applicationReady: false,
      blockers: [
        { code: "unmet-rubric-threshold", dimension: "relevance", score: 0, threshold: 0.8 },
      ],
    } as const;
    const safeState = { ...fixture, approvalReadiness };
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value: safeState }), ["review.load"]),
    );
    await expect(
      port.execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } }),
    ).resolves.toEqual({ ok: true, value: safeState });

    for (const malformed of [
      { ...approvalReadiness, privateRationale: "must not cross the bridge" },
      {
        ...approvalReadiness,
        blockers: [
          {
            code: "unmet-rubric-threshold",
            dimension: "relevance",
            score: Number.POSITIVE_INFINITY,
            threshold: 0.8,
          },
        ],
      },
      {
        ...approvalReadiness,
        blockers: [
          { code: "unmet-rubric-threshold", dimension: "relevance", score: 0.8, threshold: 0.8 },
        ],
      },
    ]) {
      const hostilePort = createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: { ...fixture, approvalReadiness: malformed } }),
          ["review.load"],
        ),
      );
      await expect(
        hostilePort.execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }

    const legacyPort = createCapabilityPort(
      bridge(async () => ({ ok: true, value: fixture }), ["review.load"]),
    );
    await expect(
      legacyPort.execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } }),
    ).resolves.toEqual({ ok: true, value: fixture });
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

  it("accepts a critic fallback from the host and rejects a malformed one (#3123)", async () => {
    const fixture = createFixtureReviewState();
    const fallback = {
      fromProvider: "openai",
      fromModel: "gpt-6.1-terra",
      toProvider: "anthropic",
      toModel: "claude-haiku-5-5",
      errorClass: "quota-exhausted",
      round: 2,
      sameCompanyAsAuthor: true,
    };
    const load = (criticFallback: unknown) =>
      createCapabilityPort(
        bridge(async () => ({ ok: true, value: { ...fixture, criticFallback } }), ["review.load"]),
      ).execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } });

    await expect(load(fallback)).resolves.toMatchObject({ ok: true });
    await expect(load(null)).resolves.toMatchObject({ ok: true });
    for (const bad of [
      { ...fallback, extra: 1 },
      { ...fallback, errorClass: "<b>quota</b>" },
      { ...fallback, round: -1 },
      { ...fallback, toModel: "has spaces" },
      { ...fallback, sameCompanyAsAuthor: "yes" },
    ]) {
      await expect(load(bad)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("accepts Claude's refusal fallbacks and rejects malformed ones (#3120)", async () => {
    const fixture = createFixtureReviewState();
    const entry = {
      step: "revision",
      round: 2,
      fromModel: "claude-sonnet-5-5",
      toModel: "claude-sonnet-5",
      category: "cyber",
    };
    const load = (refusalFallbacks: unknown) =>
      createCapabilityPort(
        bridge(
          async () => ({ ok: true, value: { ...fixture, refusalFallbacks } }),
          ["review.load"],
        ),
      ).execute({ type: "review.load", input: { workspaceId: fixture.workspaceId } });

    await expect(load([entry, { ...entry, category: null }])).resolves.toMatchObject({ ok: true });
    await expect(load([])).resolves.toMatchObject({ ok: true });
    for (const bad of [
      entry,
      [{ ...entry, extra: 1 }],
      [{ ...entry, step: "planner" }],
      [{ ...entry, category: "<b>cyber</b>" }],
      [{ ...entry, round: -1 }],
      [{ ...entry, fromModel: "has spaces" }],
    ]) {
      await expect(load(bad)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("rejects inconsistent provider failure projections from the host", async () => {
    const baseFailure = {
      code: "timeout",
      explanation: "The provider request timed out.",
      provider: "openai",
      model: "gpt-5",
      step: "critic",
      role: "critic",
      attempt: 1,
      maxAttempts: 3,
      retryAvailable: true,
      automaticRetry: false,
      retryNotBefore: null,
      availableActions: ["retry", "return-to-review", "stop"],
      diagnostics: [],
    } as const;
    for (const providerFailure of [
      { ...baseFailure, attempt: 0 },
      { ...baseFailure, attempt: 4 },
      { ...baseFailure, availableActions: ["retry", "retry"] },
      { ...baseFailure, retryAvailable: false },
      // A step the host retries itself is never offered to the person as well.
      { ...baseFailure, automaticRetry: true },
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
        role: "critic" as const,
        attempt: 1,
        maxAttempts: 3,
        retryAvailable: true,
        automaticRetry: false,
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

  it("accepts Z.ai as a model company", () => {
    expect(validateBridgeCommand({ type: "models.list", input: { provider: "zai" } })).toEqual({
      type: "models.list",
      input: { provider: "zai" },
    });
    expect(
      validateBridgeCommand({
        type: "workspace.configure-models",
        input: {
          workspaceId: "ws-1",
          authorCompany: "zai",
          authorModel: "zai-org/GLM-5.3-Flash",
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
        },
      }),
    ).toMatchObject({
      type: "workspace.configure-models",
      input: {
        authorCompany: "zai",
        authorModel: "zai-org/GLM-5.3-Flash",
      },
    });
  });

  it("accepts Google and the exact Gemini author through the runtime validators", async () => {
    expect(validateBridgeCommand({ type: "models.list", input: { provider: "google" } })).toEqual({
      type: "models.list",
      input: { provider: "google" },
    });
    const pair = {
      authorCompany: "google",
      authorModel: "gemini-3.7-flash",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    };
    expect(
      validateBridgeCommand({
        type: "workspace.configure-models",
        input: { workspaceId: "ws-1", ...pair },
      }),
    ).toEqual({
      type: "workspace.configure-models",
      input: { workspaceId: "ws-1", ...pair },
    });

    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: { workspaceId: "ws-1", ...pair, localEndpoint: null },
    }));
    const port = createCapabilityPort(bridge(invoke, ["workspace.configure-models"]));
    await expect(
      port.execute({
        type: "workspace.configure-models",
        input: { workspaceId: "ws-1", ...pair },
      } as never),
    ).resolves.toEqual({
      ok: true,
      value: { workspaceId: "ws-1", ...pair, localEndpoint: null },
    });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { workspaceId: "ws-1", ...pair, authorCompany: "bedrock", localEndpoint: null },
    });
    await expect(
      port.execute({
        type: "workspace.configure-models",
        input: { workspaceId: "ws-1", ...pair },
      } as never),
    ).resolves.toMatchObject({ ok: false });
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

  it("passes the per-file add outcome through and rejects an unknown or inconsistent one", async () => {
    const input = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      selection: "native-dialog",
    } as const;
    const base = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      kind: "file",
      versionId: "version-1",
      version: 1,
    } as const;
    const executeWith = (value: unknown) =>
      createCapabilityPort(
        bridge(async () => ({ ok: true, value }), ["knowledge.import-file"]),
      ).execute({ type: "knowledge.import-file", input });

    for (const accepted of [
      { created: true, outcome: "added" },
      { created: true, outcome: "new-version" },
      { created: false, outcome: "already-present" },
    ]) {
      await expect(executeWith({ ...base, ...accepted })).resolves.toEqual({
        ok: true,
        value: { ...base, ...accepted },
      });
    }
    // Hosts that predate the field stay valid.
    await expect(executeWith({ ...base, created: true })).resolves.toEqual({
      ok: true,
      value: { ...base, created: true },
    });

    for (const rejected of [
      { created: true, outcome: "duplicate" },
      { created: true, outcome: "already-present" },
      { created: false, outcome: "added" },
      { created: false, outcome: "new-version" },
      { created: true, outcome: "added", sourcePath: "/private/resume.md" },
    ]) {
      await expect(executeWith({ ...base, ...rejected })).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("requires explicit approval and strict workspace identity for workspace source intake", async () => {
    const input = {
      workspaceId: "workspace-1",
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      approved: true,
    } as const;
    expect(validateBridgeCommand({ type: "knowledge.import-workspace-sources", input })).toEqual({
      type: "knowledge.import-workspace-sources",
      input,
    });
    for (const invalid of [
      { ...input, approved: false },
      {
        workspaceId: input.workspaceId,
        storeId: input.storeId,
        knowledgeBaseId: input.knowledgeBaseId,
      },
      { ...input, sourceDirectory: "/private/candidate-sources" },
      { ...input, extra: "unexpected" },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.import-workspace-sources", input: invalid }),
      ).toThrow("invalid");
    }

    const value = {
      storeId: input.storeId,
      knowledgeBaseId: input.knowledgeBaseId,
      status: "complete",
      directoryId: "directory-1",
      scannedEntryCount: 1,
      discoveredFileCount: 1,
      skippedEntryCount: 0,
      sourceCount: 1,
      sources: [{ sourceId: "source-1", versionId: "version-1", version: 1, created: true }],
      sourcesTruncated: false,
    } as const;
    const port = createCapabilityPort(
      bridge(async () => ({ ok: true, value }), ["knowledge.import-workspace-sources"]),
    );
    await expect(
      port.execute({ type: "knowledge.import-workspace-sources", input }),
    ).resolves.toEqual({ ok: true, value });

    const leakingPort = createCapabilityPort(
      bridge(
        async () => ({
          ok: true,
          value: { ...value, sourceDirectory: "/private/candidate-sources" },
        }),
        ["knowledge.import-workspace-sources"],
      ),
    );
    await expect(
      leakingPort.execute({ type: "knowledge.import-workspace-sources", input }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
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

  it("restores the saved knowledge store through a strict path-free command", async () => {
    const input = { workspaceId: "workspace-1" };
    expect(validateBridgeCommand({ type: "knowledge.current", input })).toEqual({
      type: "knowledge.current",
      input,
    });
    expect(bridgeCapabilities).toContain("knowledge.current");
    for (const invalidInput of [
      {},
      { workspaceId: "workspace-1", storeRoot: "/private/candidate-data" },
      "workspace-1",
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.current", input: invalidInput }),
      ).toThrow("invalid");
    }

    const store = {
      storeId: "store-1",
      knowledgeBases: [
        {
          id: "kb-1",
          displayName: "Engineering",
          description: "",
          state: "active",
          isDefault: true,
        },
      ],
    };
    const respond = async (value: unknown) =>
      createCapabilityPort(
        bridge(async () => ({ ok: true, value }), ["knowledge.current"]),
      ).execute({ type: "knowledge.current", input });
    const accepted = [
      { store, selectedKnowledgeBaseIds: ["kb-1"] },
      { store, selectedKnowledgeBaseIds: [] },
      { store: null, selectedKnowledgeBaseIds: [] },
      { store: null, selectedKnowledgeBaseIds: [], unavailable: true },
    ];
    for (const value of accepted) {
      await expect(respond(value)).resolves.toEqual({ ok: true, value });
    }
    const rejected = [
      { store, selectedKnowledgeBaseIds: ["kb-unknown"] },
      { store, selectedKnowledgeBaseIds: ["kb-1", "kb-1"] },
      { store, selectedKnowledgeBaseIds: [], unavailable: true },
      { store, selectedKnowledgeBaseIds: [], unavailable: false },
      { store: null, selectedKnowledgeBaseIds: ["kb-1"] },
      { store: null, selectedKnowledgeBaseIds: [], unavailable: false },
      { store: null },
      { selectedKnowledgeBaseIds: [] },
      { store: { ...store, storeRoot: "/private/candidate-data" }, selectedKnowledgeBaseIds: [] },
      { store: null, selectedKnowledgeBaseIds: [], storeRoot: "/private/candidate-data" },
    ];
    for (const value of rejected) {
      await expect(respond(value)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
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
