import { access } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import type {
  BridgeCommand,
  BridgeResult,
  ReviewStateResult,
  RunStatus,
  WorkspaceResult,
} from "../bridge.js";
import type { NativeHost } from "./host.js";

export type PackagedSmokePhase = "prepare" | "resume";

export interface PackagedSmokeOptions {
  readonly host: NativeHost;
  readonly phase: PackagedSmokePhase;
  readonly workspaceRoot: string;
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

function requireValue<T>(value: T | null | undefined, step: string): T {
  if (value === null || value === undefined) throw new Error(`${step} did not return a value.`);
  return value;
}

function requireState(actual: string, expected: string, step: string): void {
  if (actual !== expected) {
    throw new Error(`${step} returned state ${actual}; expected ${expected}.`);
  }
}

async function prepare(host: NativeHost, workspaceRoot: string): Promise<void> {
  const created = await invoke<WorkspaceResult>(
    host,
    {
      type: "workspace.create",
      input: { name: basename(workspaceRoot) },
    },
    "workspace creation",
  );
  const workspaceId = created.workspace.id;
  const started = await invoke<RunStatus>(
    host,
    { type: "run.start", input: { workspaceId } },
    "run start",
  );
  requireState(started.state, "awaiting-approval", "run start");
  if (started.runId === null) throw new Error("Run start did not return a run identifier.");
  const review = await invoke<ReviewStateResult>(
    host,
    { type: "review.load", input: { workspaceId, runId: started.runId } },
    "initial review load",
  );
  if (review.runId !== started.runId) {
    throw new Error("Initial review load returned a different run.");
  }
  if (review.findings.length === 0) throw new Error("Initial review has no deterministic finding.");

  const revision = await invoke<ReviewStateResult>(
    host,
    {
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: review.runId,
        action: { type: "request-revision" },
      },
    },
    "revision request",
  );
  requireState(revision.state, "revising", "revision request");
  console.log(`packaged smoke prepare passed: workspace=${workspaceId} run=${review.runId}`);
}

async function resume(host: NativeHost, workspaceRoot: string): Promise<void> {
  const opened = await invoke<WorkspaceResult>(
    host,
    { type: "workspace.open", input: { selection: "native-dialog" } },
    "workspace reopen",
  );
  const workspaceId = opened.workspace.id;
  const status = await invoke<RunStatus>(
    host,
    { type: "run.status", input: { workspaceId } },
    "persisted run status",
  );
  if (status.runId === null) throw new Error("Persisted workspace has no run to resume.");
  requireState(status.state, "revising", "persisted run status");

  const resumed = await invoke<RunStatus>(
    host,
    { type: "run.resume", input: { workspaceId, runId: status.runId } },
    "run resume",
  );
  requireState(resumed.state, "awaiting-approval", "run resume");

  const review = await invoke<ReviewStateResult>(
    host,
    { type: "review.load", input: { workspaceId, runId: status.runId } },
    "resumed review load",
  );
  if (review.artifact.version < 2) throw new Error("Resumed review did not create a revision.");
  if (review.findings.length !== 0)
    throw new Error("Resumed review still has unresolved findings.");

  const approved = await invoke<ReviewStateResult>(
    host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: status.runId, action: { type: "approve" } },
    },
    "approval",
  );
  requireState(approved.state, "approved", "approval");
  if (approved.approval !== "approved") throw new Error("Approval was not persisted.");

  const exported = await invoke<ReviewStateResult>(
    host,
    {
      type: "review.dispatch",
      input: { workspaceId, runId: status.runId, action: { type: "export" } },
    },
    "local export",
  );
  const exportPath = requireValue(exported.exportPath, "local export");
  await access(exportPath);
  const exportRelative = relative(resolve(workspaceRoot), resolve(exportPath));
  if (exportRelative === "" || exportRelative.startsWith("..") || isAbsolute(exportRelative)) {
    throw new Error("Export escaped the smoke workspace.");
  }
  console.log(`packaged smoke resume passed: workspace=${workspaceId} run=${status.runId}`);
}

export async function runPackagedSmoke(options: PackagedSmokeOptions): Promise<void> {
  const workspaceRoot = resolve(options.workspaceRoot);
  if (options.phase === "prepare") {
    await prepare(options.host, workspaceRoot);
    return;
  }
  await resume(options.host, workspaceRoot);
}
