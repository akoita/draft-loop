import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost, type NativeHostDialogs } from "./host.js";

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
      queryEvidence: vi.fn(async () => []),
    } satisfies ApplicationService,
    snapshot,
  };
}

describe("native host", () => {
  it("creates a real workspace without synthetic candidate or job content", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-real-"));
    const root = join(parent, "real-workspace");
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
        },
      });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "real-workspace", mode: "real" },
      });
      expect(created).toMatchObject({ ok: true });
      expect(await readFile(join(root, "job.md"), "utf8")).toBe("");
      await expect(readFile(join(root, "evidence", "resume.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("fetches an approved URL into local evidence with provenance only", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-url-"));
    const root = join(parent, "url-workspace");
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
        },
        urlHostnameResolver: async () => ["93.184.216.34"],
        urlFetcher: async () =>
          new Response("Public project evidence", {
            headers: { "content-type": "text/plain" },
          }),
      });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "url-workspace", mode: "real" },
      });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;
      const added = await host.invoke({
        type: "source.add-url",
        input: {
          workspaceId,
          url: "https://example.com/projects/draft-loop",
          target: "evidence",
          approved: true,
        },
      });
      expect(added).toMatchObject({
        ok: true,
        value: {
          originalUrl: "https://example.com/projects/draft-loop",
          kind: "portfolio",
          extractionStatus: "generic-fallback",
          mediaType: "text/plain",
        },
      });
      const provenance = await readFile(
        join(root, ".draft-loop", "source-provenance.json"),
        "utf8",
      );
      expect(provenance).toContain("https://example.com/projects/draft-loop");
      expect(provenance).toContain('"role": "evidence"');
      expect(provenance).toContain('"extractedFactCount": "0"');
      const files = await readdir(join(root, "evidence", "imported"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(root, "evidence", "imported", files[0] ?? ""), "utf8")).toBe(
        "Public project evidence\n",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

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
          action: {
            type: "finding-decision",
            findingId,
            decision: "overridden",
            rationale: "The user verified this claim outside the fixture.",
          },
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
        value: {
          findings: [{ decision: "overridden" }],
          events: expect.arrayContaining([
            expect.objectContaining({ label: "Finding decision recorded: overridden" }),
          ]),
        },
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
            rationale: "The user verified this claim outside the fixture.",
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

  it("extracts and normalizes job description file imports with matching markdown metadata", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-job-select-"));
    const jobSource = join(parent, "Senior_Role.txt");
    await writeFile(jobSource, "Senior Data Engineer with distributed systems experience.", "utf8");

    try {
      const dialogs: NativeHostDialogs = {
        chooseDirectory: async () => parent,
        chooseFiles: async () => [jobSource],
      };
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "job-import-test" },
      });
      expect(created).toMatchObject({ ok: true, value: { workspace: { id: expect.any(String) } } });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;

      const selected = await host.invoke({
        type: "file.select",
        input: {
          workspaceId,
          target: "job-description",
          multiple: false,
        },
      });

      expect(selected).toEqual({
        ok: true,
        value: {
          files: [
            expect.objectContaining({
              name: "job.md",
              relativePath: "job.md",
              mediaType: "text/markdown",
            }),
          ],
        },
      });

      const loaded = await host.invoke({
        type: "review.load",
        input: { workspaceId },
      });
      expect(loaded).toMatchObject({
        ok: true,
        value: {
          setup: expect.objectContaining({
            jobDescriptionReady: true,
          }),
        },
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
