import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type {
  BridgeCommand,
  BridgeResult,
  CredentialStatus,
  FileSelectResult,
  ReviewStateResult,
  SelectedFile,
  WorkspaceResult,
} from "../bridge.js";
import type { NativeHost } from "./host.js";

const defaultTimeoutMs = 180_000;
const defaultPollIntervalMs = 100;
const liveProgressStates = new Set<ReviewStateResult["state"]>([
  "collecting",
  "drafting",
  "reviewing",
  "revising",
]);

export interface LiveProviderE2EOptions {
  readonly host: NativeHost;
  readonly workspaceRoot: string;
  readonly jobPath: string;
  readonly candidatePath: string;
  readonly evidencePath: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface LiveProviderE2EReport {
  readonly schemaVersion: 1;
  readonly stage: "desktop-live-e2e";
  readonly providerMode: "live";
  readonly models: {
    readonly author: { readonly company: string; readonly model: string };
    readonly critic: { readonly company: string; readonly model: string };
  };
  readonly counts: {
    readonly evidenceSources: number;
    readonly claims: number;
    readonly evidenceLinkedClaims: number;
    readonly findings: number;
    readonly acceptedFindings: number;
    readonly events: number;
  };
  readonly checks: {
    readonly realMode: boolean;
    readonly workspaceReady: boolean;
    readonly providerTransmissionAcknowledged: boolean;
    readonly reviewComplete: boolean;
    readonly hasSummary: boolean;
    readonly hasExperience: boolean;
    readonly hasEvidenceLinkedClaims: boolean;
    readonly approved: boolean;
    readonly exported: boolean;
    readonly exportExists: boolean;
  };
  readonly elapsedMs: number;
  readonly totalCostUsd: number;
  readonly artifactVersion: number;
}

export class LiveProviderE2EError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LiveProviderE2EError";
  }
}

async function invoke<Value>(
  host: NativeHost,
  command: BridgeCommand,
  step: string,
): Promise<Value> {
  const result: BridgeResult<unknown> = await host.invoke(command);
  if (!result.ok) {
    throw new LiveProviderE2EError(`Live provider E2E ${step} failed (${result.error.code}).`);
  }
  return result.value as Value;
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new LiveProviderE2EError(`Live provider E2E ${message}.`);
}

async function requireNonEmptyFile(filename: string, label: string): Promise<void> {
  try {
    const details = await stat(filename);
    requireCondition(details.isFile() && details.size > 0, `${label} is missing or empty`);
  } catch (error) {
    if (error instanceof LiveProviderE2EError) throw error;
    throw new LiveProviderE2EError(`Live provider E2E ${label} is missing or empty.`);
  }
}

function normalizedDiagnosticCode(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/gu, "_")
    .slice(0, 80);
  return normalized.length === 0 ? "unknown" : normalized;
}

function providerFailureError(state: ReviewStateResult): LiveProviderE2EError {
  const failure = state.providerFailure;
  if (failure === null) {
    return new LiveProviderE2EError(
      "Live provider E2E provider failure code=unknown step=unknown diagnostics=none.",
    );
  }
  const diagnostics = failure.diagnostics
    .map((diagnostic) => normalizedDiagnosticCode(diagnostic.code))
    .slice(0, 20)
    .join(",");
  return new LiveProviderE2EError(
    `Live provider E2E provider failure code=${failure.code} step=${failure.step} diagnostics=${diagnostics || "none"}.`,
  );
}

function validateTiming(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result <= 0) {
    throw new LiveProviderE2EError(`Live provider E2E ${label} must be a positive integer.`);
  }
  return result;
}

async function waitForApproval(
  host: NativeHost,
  workspaceId: string,
  runId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<ReviewStateResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = await invoke<ReviewStateResult>(
      host,
      { type: "review.load", input: { workspaceId, runId } },
      "provider run polling",
    );
    if (state.state === "awaiting-approval") return state;
    if (state.state === "provider-error") throw providerFailureError(state);
    requireCondition(
      liveProgressStates.has(state.state),
      `provider run stopped in state ${state.state}`,
    );
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.min(pollIntervalMs, remaining)),
    );
  }
  throw new LiveProviderE2EError(
    "Live provider E2E timed out before the run reached awaiting-approval.",
  );
}

function selectedFile(
  result: FileSelectResult,
  predicate: (file: SelectedFile) => boolean,
  label: string,
): SelectedFile {
  requireCondition(result.files.length === 1, `${label} did not select exactly one file`);
  const file = result.files[0];
  requireCondition(file !== undefined && predicate(file), `${label} was not imported correctly`);
  return file;
}

function hasCompletedArtifact(state: ReviewStateResult): boolean {
  return (
    state.artifact.sections.length > 0 &&
    state.artifact.sections.every(
      (section) => section.title.trim().length > 0 && section.blocks.length > 0,
    ) &&
    state.artifact.claims.length > 0
  );
}

function hasCompletedProviderEvents(state: ReviewStateResult): boolean {
  const labels = new Set(state.events.map((event) => event.label.toLowerCase()));
  return labels.has("author execution completed") && labels.has("critic execution completed");
}

function createReport(
  state: ReviewStateResult,
  elapsedMs: number,
  exportExists: boolean,
): LiveProviderE2EReport {
  const evidenceLinkedClaims = state.artifact.claims.filter((claim) => claim.evidence.length > 0);
  const acceptedFindings = state.findings.filter((finding) => finding.decision === "accepted");
  return {
    schemaVersion: 1,
    stage: "desktop-live-e2e",
    providerMode: "live",
    models: {
      author: state.providerExposure.author,
      critic: state.providerExposure.critic,
    },
    counts: {
      evidenceSources: state.setup.evidenceSourceCount,
      claims: state.artifact.claims.length,
      evidenceLinkedClaims: evidenceLinkedClaims.length,
      findings: state.findings.length,
      acceptedFindings: acceptedFindings.length,
      events: state.events.length,
    },
    checks: {
      realMode: !state.setup.fixtureMode,
      workspaceReady: state.setup.ready,
      providerTransmissionAcknowledged: state.providerTransmissionPreflight.acknowledged,
      reviewComplete: state.reviewComplete,
      hasSummary: state.artifact.sections.some((section) => section.title === "Summary"),
      hasExperience: state.artifact.sections.some((section) => section.title === "Experience"),
      hasEvidenceLinkedClaims: evidenceLinkedClaims.length > 0,
      approved: state.approval === "approved",
      exported: state.state === "exported",
      exportExists,
    },
    elapsedMs,
    totalCostUsd: state.totalCostUsd,
    artifactVersion: state.artifact.version,
  };
}

async function writeEvidenceReport(filename: string, report: LiveProviderE2EReport): Promise<void> {
  try {
    const output = resolve(filename);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(output, 0o600);
  } catch {
    throw new LiveProviderE2EError("Live provider E2E evidence report could not be written.");
  }
}

export async function runLiveProviderE2E(options: LiveProviderE2EOptions): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = validateTiming(options.timeoutMs, defaultTimeoutMs, "timeout");
  const pollIntervalMs = validateTiming(
    options.pollIntervalMs,
    defaultPollIntervalMs,
    "poll interval",
  );
  const workspaceRoot = resolve(options.workspaceRoot);
  await requireNonEmptyFile(resolve(options.jobPath), "Synthetic job input");
  await requireNonEmptyFile(resolve(options.candidatePath), "Synthetic candidate input");

  for (const provider of ["anthropic", "openai"] as const) {
    const credential = await invoke<CredentialStatus>(
      options.host,
      { type: "credential.status", input: { provider } },
      `${provider} credential check`,
    );
    requireCondition(credential.configured, `${provider} credential is not configured`);
  }

  const workspace = await invoke<WorkspaceResult>(
    options.host,
    {
      type: "workspace.create",
      input: { name: basename(workspaceRoot) || "draft-loop-live-e2e", mode: "real" },
    },
    "workspace creation",
  );
  const workspaceId = workspace.workspace.id;

  const job = await invoke<FileSelectResult>(
    options.host,
    {
      type: "file.select",
      input: {
        workspaceId,
        extensions: [".md"],
        multiple: false,
        target: "job-description",
      },
    },
    "synthetic job import",
  );
  selectedFile(
    job,
    (file) => file.relativePath === "job.md" && file.byteLength > 0,
    "Synthetic job",
  );

  const candidate = await invoke<FileSelectResult>(
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
    "synthetic candidate import",
  );
  selectedFile(
    candidate,
    (file) => file.relativePath.startsWith("evidence/") && file.byteLength > 0,
    "Synthetic candidate",
  );

  const initial = await invoke<ReviewStateResult>(
    options.host,
    { type: "review.load", input: { workspaceId } },
    "workspace readiness check",
  );
  requireCondition(!initial.setup.fixtureMode, "workspace unexpectedly uses fixture mode");
  requireCondition(
    initial.setup.ready &&
      initial.setup.jobDescriptionReady &&
      initial.setup.evidenceSourceCount > 0,
    "synthetic workspace is not ready",
  );
  requireCondition(
    initial.providerTransmissionPreflight.required &&
      !initial.providerTransmissionPreflight.acknowledged,
    "provider transmission preflight was not required",
  );

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
    "provider transmission acknowledgement",
  );
  requireCondition(
    acknowledged.providerTransmissionPreflight.acknowledged,
    "provider transmission acknowledgement was not persisted",
  );

  const started = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: "pending", action: { type: "start" } },
    },
    "live provider run start",
  );
  requireCondition(started.runId !== "pending", "live provider run did not receive an identifier");
  requireCondition(started.state === "drafting", "live provider run did not start drafting");

  let completed = await waitForApproval(
    options.host,
    workspaceId,
    started.runId,
    timeoutMs,
    pollIntervalMs,
  );
  requireCondition(!completed.setup.fixtureMode, "provider run returned fixture mode");
  requireCondition(hasCompletedArtifact(completed), "provider run returned an incomplete artifact");
  requireCondition(
    completed.artifact.sections.some((section) => section.title === "Summary"),
    "provider artifact is missing Summary",
  );
  requireCondition(
    completed.artifact.sections.some((section) => section.title === "Experience"),
    "provider artifact is missing Experience",
  );
  requireCondition(
    completed.artifact.claims.some((claim) => claim.evidence.length > 0),
    "provider artifact has no evidence-linked claims",
  );
  requireCondition(completed.reviewComplete, "provider review is incomplete");
  requireCondition(
    completed.providerExposure.author.company.trim().toLowerCase() === "anthropic" &&
      completed.providerExposure.author.model.trim().length > 0,
    "provider author identity is not Anthropic",
  );
  requireCondition(
    completed.providerExposure.critic.company.trim().toLowerCase() === "openai" &&
      completed.providerExposure.critic.model.trim().length > 0,
    "provider critic identity is not OpenAI",
  );
  requireCondition(
    hasCompletedProviderEvents(completed),
    "provider execution events are incomplete",
  );

  for (const finding of completed.findings) {
    completed = await invoke<ReviewStateResult>(
      options.host,
      {
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: completed.runId,
          action: { type: "finding-decision", findingId: finding.id, decision: "accepted" },
        },
      },
      "finding acceptance",
    );
  }
  requireCondition(
    completed.findings.every((finding) => finding.decision === "accepted"),
    "projected findings were not accepted",
  );

  const approved = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: completed.runId, action: { type: "approve" } },
    },
    "final approval",
  );
  requireCondition(
    approved.state === "approved" && approved.approval === "approved",
    "approval was not persisted",
  );

  const exported = await invoke<ReviewStateResult>(
    options.host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: completed.runId, action: { type: "export" } },
    },
    "Markdown export",
  );
  requireCondition(exported.exportPath !== null, "Markdown export did not return a path");
  await requireNonEmptyFile(exported.exportPath, "Markdown export");

  const persisted = await invoke<ReviewStateResult>(
    options.host,
    { type: "review.load", input: { workspaceId, runId: completed.runId } },
    "export persistence check",
  );
  requireCondition(
    persisted.state === "exported" &&
      persisted.approval === "approved" &&
      persisted.exportPath !== null,
    "approved export was not persisted",
  );
  await requireNonEmptyFile(persisted.exportPath, "persisted Markdown export");
  requireCondition(Number.isFinite(persisted.totalCostUsd), "provider cost is not finite");

  const report = createReport(persisted, Math.max(0, Date.now() - startedAt), true);
  await writeEvidenceReport(options.evidencePath, report);
}
