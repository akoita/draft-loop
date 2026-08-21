import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  BridgeCommand,
  BridgeResult,
  FileSelectResult,
  ReviewStateResult,
} from "../bridge.js";
import { createFixtureReviewState } from "../model.js";
import type { NativeHost } from "./host.js";
import { runLiveProviderE2E } from "./live-e2e.js";

interface StubPaths {
  readonly root: string;
  readonly workspace: string;
  readonly job: string;
  readonly candidate: string;
  readonly report: string;
  readonly export: string;
}

function liveState(): ReviewStateResult {
  const fixture = createFixtureReviewState();
  return {
    ...fixture,
    workspaceId: "workspace-live",
    runId: "pending",
    state: "collecting",
    approval: "pending",
    reviewComplete: true,
    providerExposure: {
      ...fixture.providerExposure,
      author: { company: "anthropic", model: "claude-test" },
      critic: { company: "openai", model: "gpt-test" },
      transmissionAllowed: false,
      sensitiveData: true,
      requestedRetention: "ephemeral-request",
    },
    providerTransmissionPreflight: {
      ...fixture.providerTransmissionPreflight,
      dataClass: "candidate-application-material",
      required: true,
      acknowledged: false,
      acknowledgedAt: null,
      author: {
        company: "anthropic",
        model: "claude-test",
        endpoint: "https://api.anthropic.com/v1/messages",
      },
      critic: {
        company: "openai",
        model: "gpt-test",
        endpoint: "https://api.openai.com/v1/responses",
      },
      retentionPreference: "ephemeral-request",
    },
    events: [
      ...fixture.events,
      {
        id: "author-complete",
        label: "author execution completed",
        state: "drafting",
        createdAt: "2026-08-16T10:00:00.000Z",
      },
      {
        id: "critic-complete",
        label: "critic execution completed",
        state: "reviewing",
        createdAt: "2026-08-16T10:00:01.000Z",
      },
    ],
    exportPath: null,
    setup: {
      ...fixture.setup,
      fixtureMode: false,
      jobDescriptionReady: true,
      evidenceSourceCount: 1,
      ready: true,
    },
    providerFailure: null,
  };
}

function createStubHost(
  paths: StubPaths,
  failWithProviderError = false,
): {
  readonly host: NativeHost;
  readonly commands: BridgeCommand[];
} {
  const commands: BridgeCommand[] = [];
  let state = liveState();
  let pollCount = 0;
  const host: NativeHost = {
    capabilities: [],
    invoke: async (value) => {
      const command = value as BridgeCommand;
      commands.push(command);
      if (command.type === "credential.status") {
        return {
          ok: true,
          value: {
            provider: command.input.provider,
            configured: true,
            source: "app",
            protection: "os-backed",
          },
        } satisfies BridgeResult<unknown>;
      }
      if (command.type === "workspace.create") {
        return {
          ok: true,
          value: { workspace: { id: "workspace-live", name: "workspace" } },
        } satisfies BridgeResult<unknown>;
      }
      if (command.type === "file.select") {
        const fileSelect: FileSelectResult = {
          files: [
            command.input.target === "job-description"
              ? {
                  id: "job",
                  name: "job.md",
                  relativePath: "job.md",
                  mediaType: "text/markdown",
                  byteLength: 24,
                }
              : {
                  id: "candidate",
                  name: "candidate.md",
                  relativePath: "evidence/candidate.md",
                  mediaType: "text/markdown",
                  byteLength: 30,
                },
          ],
        };
        return { ok: true, value: fileSelect } satisfies BridgeResult<unknown>;
      }
      if (command.type === "review.load") {
        if (state.state === "drafting") {
          pollCount += 1;
          if (failWithProviderError) {
            state = {
              ...state,
              state: "provider-error",
              providerFailure: {
                code: "invalid-response",
                explanation: "not exposed by the live runner",
                provider: "anthropic",
                model: "claude-test",
                step: "author",
                attempt: 1,
                maxAttempts: 1,
                retryAvailable: false,
                retryNotBefore: null,
                availableActions: ["stop"],
                diagnostics: [{ code: "schema.invalid", path: "response.output" }],
              },
            };
          } else if (pollCount > 1) {
            state = { ...state, state: "awaiting-approval" };
          }
        }
        return { ok: true, value: state } satisfies BridgeResult<unknown>;
      }
      if (command.type === "review.dispatch") {
        const action = command.input.action;
        switch (action.type) {
          case "acknowledge-provider-transmission":
            state = {
              ...state,
              providerTransmissionPreflight: {
                ...state.providerTransmissionPreflight,
                acknowledged: true,
                acknowledgedAt: "2026-08-16T10:00:00.000Z",
              },
            };
            break;
          case "start":
            state = { ...state, runId: "run-live", state: "drafting" };
            break;
          case "finding-decision":
            state = {
              ...state,
              findings: state.findings.map((finding) =>
                finding.id === action.findingId
                  ? { ...finding, decision: action.decision }
                  : finding,
              ),
            };
            break;
          case "approve":
            state = { ...state, state: "approved", approval: "approved" };
            break;
          case "export":
            await writeFile(paths.export, "# Synthetic approved export\n", "utf8");
            state = { ...state, state: "exported", exportPath: paths.export };
            break;
          default:
            break;
        }
        return { ok: true, value: state } satisfies BridgeResult<unknown>;
      }
      throw new Error(`Unexpected command: ${command.type}`);
    },
  };
  return { host, commands };
}

async function createPaths(): Promise<StubPaths> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-live-e2e-test-"));
  const paths = {
    root,
    workspace: join(root, "workspace"),
    job: join(root, "job.md"),
    candidate: join(root, "candidate.md"),
    report: join(root, "report.json"),
    export: join(root, "export.md"),
  } satisfies StubPaths;
  await writeFile(paths.job, "Synthetic job from jobs.example.test\n", "utf8");
  await writeFile(paths.candidate, "Synthetic candidate evidence\n", "utf8");
  return paths;
}

describe("live provider E2E runner", () => {
  it("uses the real-mode command sequence and writes only sanitized evidence", async () => {
    const paths = await createPaths();
    const { host, commands } = createStubHost(paths);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await runLiveProviderE2E({
        host,
        workspaceRoot: paths.workspace,
        jobPath: paths.job,
        candidatePath: paths.candidate,
        evidencePath: paths.report,
        timeoutMs: 1_000,
        pollIntervalMs: 1,
      });

      const reportText = await readFile(paths.report, "utf8");
      const report = JSON.parse(reportText) as {
        readonly checks: Readonly<Record<string, boolean>>;
        readonly models: {
          readonly author: { readonly company: string; readonly model: string };
          readonly critic: { readonly company: string; readonly model: string };
        };
        readonly counts: Readonly<Record<string, number>>;
      };
      expect(report.checks.realMode).toBe(true);
      expect(report.checks.reviewComplete).toBe(true);
      expect(report.checks.approved).toBe(true);
      expect(report.checks.exported).toBe(true);
      expect(report.checks.exportExists).toBe(true);
      expect(report.models.author.company).toBe("anthropic");
      expect(report.models.critic.company).toBe("openai");
      expect(report.counts.acceptedFindings).toBe(1);
      expect(report.counts.findings).toBe(2);
      expect(reportText).not.toContain("Synthetic job from jobs.example.test");
      expect(reportText).not.toContain("Synthetic candidate evidence");
      expect(reportText).not.toContain(paths.root);
      expect((await stat(paths.report)).mode & 0o777).toBe(0o600);
      expect(fetchSpy).not.toHaveBeenCalled();

      expect(commands.map((command) => command.type)).toEqual([
        "credential.status",
        "credential.status",
        "workspace.create",
        "file.select",
        "file.select",
        "review.load",
        "review.dispatch",
        "review.dispatch",
        "review.load",
        "review.load",
        "review.dispatch",
        "review.dispatch",
        "review.dispatch",
        "review.dispatch",
        "review.load",
      ]);
      expect(commands[0]).toMatchObject({
        type: "credential.status",
        input: { provider: "anthropic" },
      });
      expect(commands[1]).toMatchObject({
        type: "credential.status",
        input: { provider: "openai" },
      });
      expect(commands[2]).toMatchObject({
        type: "workspace.create",
        input: { mode: "real" },
      });
      expect(commands[3]).toMatchObject({
        type: "file.select",
        input: { target: "job-description" },
      });
      expect(commands[4]).toMatchObject({
        type: "file.select",
        input: { target: "evidence" },
      });
      expect(
        commands.filter(
          (command) =>
            command.type === "review.dispatch" && command.input.action.type === "finding-decision",
        ),
      ).toEqual([
        {
          type: "review.dispatch",
          input: {
            workspaceId: "workspace-live",
            runId: "run-live",
            action: {
              type: "finding-decision",
              findingId: "finding-unsupported-claim",
              decision: "rejected",
            },
          },
        },
        {
          type: "review.dispatch",
          input: {
            workspaceId: "workspace-live",
            runId: "run-live",
            action: {
              type: "finding-decision",
              findingId: "finding-coverage",
              decision: "accepted",
            },
          },
        },
      ]);
    } finally {
      fetchSpy.mockRestore();
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("reports provider failures without provider response content or paths", async () => {
    const paths = await createPaths();
    const { host } = createStubHost(paths, true);
    try {
      const failure = await runLiveProviderE2E({
        host,
        workspaceRoot: paths.workspace,
        jobPath: paths.job,
        candidatePath: paths.candidate,
        evidencePath: paths.report,
        timeoutMs: 1_000,
        pollIntervalMs: 1,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : "";
      expect(message).toContain("code=invalid-response step=author diagnostics=schema.invalid");
      expect(message).not.toContain(paths.root);
      expect(message).not.toContain("provider response leaked");
      await expect(stat(paths.report)).rejects.toThrow();
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });
});
