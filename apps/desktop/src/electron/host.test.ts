import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";

function descriptor(root: string): WorkspaceDescriptor {
  return {
    id: "workspace-native",
    root,
    jobDescriptionPath: "job.md",
    sourceDirectory: "evidence",
    language: "en",
    outputFormat: "markdown",
    requiredSections: ["Summary", "Experience"],
    maxRounds: 2,
    maxCostUsd: 0.25,
    author: { company: "anthropic", model: "claude-sonnet-4-5" },
    critic: { company: "openai", model: "gpt-5" },
    fixtureMode: true,
  };
}

function service(root: string) {
  const workspace = descriptor(root);
  const snapshot = {
    schemaVersion: 1,
    runId: "run-native",
    workspaceId: workspace.id,
    contextSnapshotId: "context-native",
    state: "awaiting-approval",
    round: 1,
    currentStep: null,
    budget: { maxRounds: 2, maxCostUsd: 0.25 },
    artifact: {
      schemaVersion: 1,
      id: "artifact-native",
      version: 1,
      parentVersionId: null,
      createdAt: "2026-08-12T10:00:00.000Z",
      language: "en",
      sections: [
        {
          id: "summary",
          title: "Summary",
          kind: "summary",
          order: 0,
          blocks: [
            { id: "summary-block", type: "paragraph", text: "Local draft", claimIds: ["claim-1"] },
          ],
        },
      ],
      claims: [
        {
          id: "claim-1",
          text: "Local draft",
          sectionId: "summary",
          blockId: "summary-block",
          substantive: true,
          status: "verified",
          evidence: [{ sourcePath: "evidence/resume.md", sourceChecksum: "abc", excerpt: "local" }],
        },
      ],
      decisions: [],
    },
    findings: [
      {
        code: "unsupported-claim",
        severity: "error",
        category: "factuality",
        message: "Review the local claim.",
        claimId: "claim-1",
      },
    ],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: [],
    totalCostUsd: 0,
    approval: "pending",
    startedAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    lastError: null,
  } as never;
  return {
    service: {
      initialize: vi.fn(async () => workspace),
      readWorkspace: vi.fn(async () => workspace),
      start: vi.fn(async () => snapshot),
      resume: vi.fn(async () => snapshot),
      lifecycle: vi.fn(async () => snapshot),
      status: vi.fn(async () => snapshot),
      export: vi.fn(
        async (command) => command.outputPath ?? join(root, "exports", "run-native.md"),
      ),
    } satisfies ApplicationService,
    snapshot,
  };
}

describe("native host", () => {
  it("keeps workspace selection native and persists review decisions locally", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-"));
    const root = join(parent, "native-workspace");
    const externalEvidence = join(parent, "resume.md");
    await writeFile(externalEvidence, "local evidence", "utf8");
    const fixture = service(root);
    const dialogs = {
      chooseDirectory: vi.fn(async (mode: "open" | "create") =>
        mode === "create" ? parent : root,
      ),
      chooseFiles: vi.fn(async () => [externalEvidence]),
    };

    try {
      const host = createNativeHost({ dialogs, applicationService: fixture.service });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "native-workspace" },
      });
      expect(created).toEqual({
        ok: true,
        value: { workspace: { id: "workspace-native", name: "native-workspace" } },
      });

      const started = await host.invoke({
        type: "run.start",
        input: { workspaceId: "workspace-native" },
      });
      expect(started).toMatchObject({
        ok: true,
        value: { runId: "run-native", state: "awaiting-approval" },
      });

      const selected = await host.invoke({
        type: "file.select",
        input: { workspaceId: "workspace-native", extensions: [".md"], multiple: false },
      });
      expect(selected).toMatchObject({
        ok: true,
        value: {
          files: [{ relativePath: "evidence/imported/resume.md", mediaType: "text/markdown" }],
        },
      });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      expect(review).toMatchObject({ ok: true, value: { findings: [{ decision: "pending" }] } });
      const findingId = (
        review as { readonly value: { readonly findings: readonly [{ readonly id: string }] } }
      ).value.findings[0].id;
      await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "finding-decision", findingId, decision: "overridden" },
        },
      });

      const restarted = createNativeHost({ dialogs, applicationService: fixture.service });
      await restarted.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const reloaded = await restarted.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      expect(reloaded).toMatchObject({
        ok: true,
        value: { findings: [{ decision: "overridden" }] },
      });
      expect(await readFile(join(root, ".draft-loop", "review-overrides.json"), "utf8")).toContain(
        "overridden",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects bridge commands that would escape the export boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-export-"));
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const result = await host.invoke({
        type: "export.write",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          format: "markdown",
          relativePath: "../outside.md",
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the real local driver through approval, export, and restart", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-alpha-"));
    const root = join(parent, "alpha-workspace");
    const dialogs = {
      chooseDirectory: vi.fn(async (mode: "open" | "create") =>
        mode === "create" ? parent : root,
      ),
      chooseFiles: vi.fn(async () => []),
    };

    try {
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "alpha-workspace" },
      });
      expect(created).toMatchObject({ ok: true, value: { workspace: { id: expect.any(String) } } });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;

      const started = await host.invoke({ type: "run.start", input: { workspaceId } });
      expect(started).toMatchObject({ ok: true, value: { state: "awaiting-approval" } });
      const review = await host.invoke({ type: "review.load", input: { workspaceId } });
      const reviewValue = (review as { readonly value: DesktopReviewState }).value;
      expect(reviewValue.findings).toHaveLength(1);
      await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: {
            type: "finding-decision",
            findingId: reviewValue.findings[0]?.id ?? "missing",
            decision: "overridden",
          },
        },
      });
      const approved = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: { type: "approve" },
        },
      });
      expect(approved).toMatchObject({
        ok: true,
        value: { approval: "approved", state: "approved" },
      });
      const exported = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: { type: "export" },
        },
      });
      expect(exported).toMatchObject({ ok: true, value: { approval: "approved" } });

      const restarted = createNativeHost({ dialogs });
      await restarted.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const recovered = await restarted.invoke({
        type: "review.load",
        input: { workspaceId, runId: reviewValue.runId },
      });
      expect(recovered).toMatchObject({
        ok: true,
        value: {
          approval: "approved",
          findings: [{ decision: "overridden" }],
        },
      });
      expect(await readFile(join(root, "exports", `${reviewValue.runId}.md`), "utf8")).toContain(
        "Evidence-backed",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
