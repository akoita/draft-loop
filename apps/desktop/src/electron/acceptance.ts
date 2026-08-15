import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type {
  BridgeCommand,
  BridgeResult,
  ExportResult,
  ReviewStateResult,
  RunStatus,
  SelectedFile,
  SourceAddUrlResult,
  WorkspaceResult,
} from "../bridge.js";
import type { NativeHost } from "./host.js";

export type PackagedAcceptancePhase = "prepare" | "resume";

export interface PackagedAcceptanceOptions {
  readonly host: NativeHost;
  readonly phase: PackagedAcceptancePhase;
  readonly workspaceRoot: string;
  readonly candidatePath: string;
  readonly evidencePath: string;
  readonly appVersion: string;
  readonly artifactChecksum: string;
  readonly jobUrl: string;
}

async function invoke<Value>(
  host: NativeHost,
  command: BridgeCommand,
  step: string,
): Promise<Value> {
  const result: BridgeResult<unknown> = await host.invoke(command);
  if (!result.ok) {
    throw new Error(`${step} failed (${result.error.code}): ${result.error.message}`);
  }
  return result.value as Value;
}

function requireState(actual: string, expected: string, step: string): void {
  if (actual !== expected) {
    throw new Error(`${step} returned state ${actual}; expected ${expected}.`);
  }
}

async function waitForReviewState(
  host: NativeHost,
  workspaceId: string,
  runId: string,
  expected: string,
  step: string,
): Promise<ReviewStateResult> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const review = await invoke<ReviewStateResult>(
      host,
      { type: "review.load", input: { workspaceId, runId } },
      `${step} progress`,
    );
    if (review.state === expected) return review;
    if (!["drafting", "reviewing", "revising"].includes(review.state)) {
      requireState(review.state, expected, step);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${step} did not reach ${expected} before the acceptance timeout.`);
}

function workspaceFile(root: string, value: string): string {
  const candidate = resolve(root, value);
  const child = relative(resolve(root), candidate);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Acceptance path escaped the workspace: ${value}.`);
  }
  return candidate;
}

async function requireNonEmptyFile(filename: string, label: string): Promise<void> {
  const details = await stat(filename);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`${label} is missing or empty.`);
  }
}

async function prepare(options: PackagedAcceptanceOptions): Promise<void> {
  const workspace = await invoke<WorkspaceResult>(
    options.host,
    {
      type: "workspace.create",
      input: { name: basename(options.workspaceRoot), mode: "demo" },
    },
    "workspace creation",
  );
  const workspaceId = workspace.workspace.id;

  const imported = await invoke<{ readonly files: readonly SelectedFile[] }>(
    options.host,
    {
      type: "file.select",
      input: {
        workspaceId,
        extensions: [".md"],
        multiple: false,
        target: "evidence",
      },
    },
    "sanitized candidate import",
  );
  if (imported.files.length !== 1 || !imported.files[0]?.relativePath.startsWith("evidence/")) {
    throw new Error("The sanitized candidate was not imported into workspace evidence.");
  }
  await requireNonEmptyFile(options.candidatePath, "Sanitized candidate input");

  const jobSource = await invoke<SourceAddUrlResult>(
    options.host,
    {
      type: "source.add-url",
      input: { workspaceId, url: options.jobUrl, target: "job-description", approved: true },
    },
    "approved sanitized job URL import",
  );
  if (jobSource.originalUrl !== options.jobUrl || jobSource.sourcePath !== "job.md") {
    throw new Error("The approved job URL did not produce the workspace job description.");
  }

  const initial = await invoke<ReviewStateResult>(
    options.host,
    { type: "review.load", input: { workspaceId } },
    "acceptance review load",
  );
  if (!initial.setup.ready || initial.setup.evidenceSourceCount < 1) {
    throw new Error("Sanitized workspace inputs were not ready for a run.");
  }
  if (
    !initial.providerTransmissionPreflight.required ||
    initial.providerTransmissionPreflight.acknowledged
  ) {
    throw new Error("The acceptance workflow did not expose an unacknowledged provider preflight.");
  }

  const acknowledged = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: "pending",
        action: {
          type: "acknowledge-provider-transmission",
          fingerprint: initial.providerTransmissionPreflight.fingerprint,
        },
      },
    },
    "provider preflight acknowledgement",
  );
  if (!acknowledged.providerTransmissionPreflight.acknowledged) {
    throw new Error("Provider preflight acknowledgement was not persisted.");
  }

  const beginning = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: "pending", action: { type: "start" } },
    },
    "sanitized author-critic run",
  );
  requireState(beginning.state, "drafting", "sanitized author-critic run acknowledgement");
  if (beginning.runId === "pending") {
    throw new Error("Acceptance run did not receive an identifier.");
  }
  const started = await waitForReviewState(
    options.host,
    workspaceId,
    beginning.runId,
    "awaiting-approval",
    "sanitized author-critic run",
  );
  if (started.artifact.claims.length === 0) {
    throw new Error("Acceptance run did not produce an evidence-backed artifact.");
  }

  const revision = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: started.runId,
        action: { type: "request-revision" },
      },
    },
    "revision request",
  );
  requireState(revision.state, "revising", "revision request");

  const provenance = workspaceFile(options.workspaceRoot, ".draft-loop/source-provenance.json");
  const provenanceText = await readFile(provenance, "utf8");
  if (!provenanceText.includes(options.jobUrl)) {
    throw new Error("The approved job URL was not retained in source provenance.");
  }
  await requireNonEmptyFile(
    workspaceFile(options.workspaceRoot, imported.files[0]?.relativePath ?? ""),
    "Imported candidate evidence",
  );
}

async function resumeAndExport(options: PackagedAcceptanceOptions): Promise<void> {
  const opened = await invoke<WorkspaceResult>(
    options.host,
    { type: "workspace.open", input: { selection: "native-dialog" } },
    "workspace reopen",
  );
  const workspaceId = opened.workspace.id;
  const status = await invoke<RunStatus>(
    options.host,
    { type: "run.status", input: { workspaceId } },
    "persisted run status",
  );
  if (status.runId === null) throw new Error("Persisted acceptance workspace has no run.");
  requireState(status.state, "revising", "persisted run status");

  const interrupted = await invoke<ReviewStateResult>(
    options.host,
    { type: "review.load", input: { workspaceId, runId: status.runId } },
    "interrupted run projection",
  );
  if (interrupted.execution.status !== "interrupted") {
    throw new Error("Persisted active run was not explained as interrupted after restart.");
  }

  const resumed = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: status.runId, action: { type: "resume" } },
    },
    "run resume",
  );
  requireState(resumed.state, "revising", "run resume acknowledgement");
  if (resumed.execution.status !== "running") {
    throw new Error("Resumed run did not expose active background execution.");
  }
  const completed = await waitForReviewState(
    options.host,
    workspaceId,
    resumed.runId,
    "awaiting-approval",
    "run resume",
  );
  if (completed.artifact.version < 2 || completed.findings.length !== 0) {
    throw new Error("Resumed acceptance run did not produce a clean revision.");
  }

  const cancellationName = `${basename(options.workspaceRoot)}-cancellation`;
  const cancellationRoot = resolve(dirname(options.workspaceRoot), cancellationName);
  const cancellationWorkspace = await invoke<WorkspaceResult>(
    options.host,
    { type: "workspace.create", input: { name: cancellationName, mode: "demo" } },
    "cancellation workspace creation",
  );
  const cancellationInitial = await invoke<ReviewStateResult>(
    options.host,
    { type: "review.load", input: { workspaceId: cancellationWorkspace.workspace.id } },
    "cancellation workspace load",
  );
  const cancellationAcknowledged = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: {
        workspaceId: cancellationWorkspace.workspace.id,
        runId: "pending",
        action: {
          type: "acknowledge-provider-transmission",
          fingerprint: cancellationInitial.providerTransmissionPreflight.fingerprint,
        },
      },
    },
    "cancellation provider acknowledgement",
  );
  const cancellationBeginning = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: {
        workspaceId: cancellationWorkspace.workspace.id,
        runId: cancellationAcknowledged.runId,
        action: { type: "start" },
      },
    },
    "cancellation run start",
  );
  if (cancellationBeginning.execution.status !== "running") {
    throw new Error("Cancellation fixture did not expose active execution.");
  }
  const stopped = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: {
        workspaceId: cancellationWorkspace.workspace.id,
        runId: cancellationBeginning.runId,
        action: { type: "stop" },
      },
    },
    "in-flight run cancellation",
  );
  requireState(stopped.state, "stopped", "in-flight run cancellation");
  await rm(cancellationRoot, { recursive: true, force: true });

  await invoke<WorkspaceResult>(
    options.host,
    { type: "workspace.open", input: { selection: "native-dialog" } },
    "acceptance workspace reopen after cancellation",
  );

  const approved = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: completed.runId, action: { type: "approve" } },
    },
    "final approval",
  );
  requireState(approved.state, "approved", "final approval");
  if (approved.approval !== "approved") throw new Error("Final approval was not persisted.");

  const markdown = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: completed.runId, action: { type: "export" } },
    },
    "Markdown export",
  );
  const markdownPath = markdown.exportPath;
  if (markdownPath === null) throw new Error("Markdown export did not return a path.");
  await requireNonEmptyFile(workspaceFile(options.workspaceRoot, markdownPath), "Markdown export");

  const exported = await Promise.all(
    (["docx", "pdf"] as const).map((format) =>
      invoke<ExportResult>(
        options.host,
        {
          type: "export.write",
          input: {
            workspaceId,
            runId: completed.runId,
            format,
            relativePath: `exports/acceptance.${format}`,
          },
        },
        `${format.toUpperCase()} export`,
      ),
    ),
  );
  for (const result of exported) {
    await requireNonEmptyFile(
      workspaceFile(options.workspaceRoot, result.relativePath),
      `${result.format.toUpperCase()} export`,
    );
  }

  const history = workspaceFile(options.workspaceRoot, ".draft-loop/history.sqlite");
  const workspaceConfig = workspaceFile(options.workspaceRoot, ".draft-loop/workspace.json");
  const provenance = workspaceFile(options.workspaceRoot, ".draft-loop/source-provenance.json");
  const acknowledgement = workspaceFile(
    options.workspaceRoot,
    ".draft-loop/provider-transmission-acknowledgement.json",
  );
  await Promise.all([
    requireNonEmptyFile(history, "Durable run history"),
    requireNonEmptyFile(workspaceConfig, "Workspace configuration"),
    requireNonEmptyFile(provenance, "Source provenance"),
    requireNonEmptyFile(acknowledgement, "Provider preflight acknowledgement"),
  ]);

  await mkdir(dirname(options.evidencePath), { recursive: true });
  await access(resolve(options.workspaceRoot));
  await writeAcceptanceEvidence(options);
}

async function writeAcceptanceEvidence(options: PackagedAcceptanceOptions): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(options.artifactChecksum)) {
    throw new Error("Acceptance artifact checksum is missing or malformed.");
  }
  await writeFile(
    options.evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        stage: "installed-app-acceptance",
        generatedAt: new Date().toISOString(),
        appVersion: options.appVersion,
        artifactChecksum: options.artifactChecksum,
        platform: platform(),
        osRelease: release(),
        architecture: arch(),
        inputMode: "safely-sanitized-local-candidate-and-deterministic-job-url",
        providerMode: "offline-fixture-with-provider-preflight",
        checks: {
          installLaunch: true,
          workspaceCreation: true,
          candidateImport: true,
          approvedJobUrl: true,
          provenance: true,
          providerPreflight: true,
          authorCriticRun: true,
          observableProgress: true,
          inFlightCancellation: true,
          revision: true,
          restartResume: true,
          interruptedRunExplanation: true,
          approval: true,
          exportMarkdown: true,
          exportDocx: true,
          exportPdf: true,
          durableHistory: true,
        },
        limitations: [
          "Provider calls use the offline fixture agent path; no live provider request is made.",
          "Credential lifecycle results are recorded by the separate credential acceptance workflow.",
          "Provider recovery transitions are covered by deterministic host tests and remain a linked stage dependency.",
        ],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export async function runPackagedAcceptance(options: PackagedAcceptanceOptions): Promise<void> {
  if (options.phase === "prepare") {
    await prepare(options);
    return;
  }
  await resumeAndExport(options);
}
