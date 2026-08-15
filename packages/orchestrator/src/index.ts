import {
  type ContextSnapshot,
  type RetrievalOptions,
  type RetrievalPort,
  type ScoredEvidenceChunk,
  SemanticValidationError,
  validateContextSnapshotInput,
  type WorkflowState,
  type Workspace,
} from "@draft-loop/domain";
import {
  evaluateReadiness,
  type ReadinessEvaluation,
  type ReadinessScoreVector,
} from "@draft-loop/evaluations";
import type { DraftArtifact, WorkspaceInput } from "@draft-loop/schemas";
import type {
  AuditEventInput,
  JsonValue,
  RunSnapshotRecordInput,
  StoragePort,
} from "@draft-loop/storage";
import {
  type ValidationCategory,
  type ValidationIssue,
  validateDraftArtifact,
} from "@draft-loop/validation";

export type RunState = WorkflowState | "provider-error";
export type OrchestrationStep = "author" | "critic" | "revision" | null;
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecutionStatus = "completed" | "failed";

export interface RunBudget {
  readonly maxRounds: number;
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
}

export interface CritiqueFinding {
  readonly id: string;
  readonly code: string;
  readonly category: ValidationCategory;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly claimId?: string;
  readonly sectionId?: string;
  readonly requirementId?: string;
}

export interface Critique {
  readonly findings: readonly CritiqueFinding[];
}

export interface AgentExecution<T> {
  readonly output: T;
  readonly provider: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly outputChecksum: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
  readonly completedAt: string;
}

export interface AuthorRequest {
  readonly executionId: string;
  readonly runId: string;
  readonly round: number;
  readonly context: ContextSnapshot;
  readonly currentArtifact: DraftArtifact | null;
  readonly findings: readonly ValidationIssue[];
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
  readonly signal?: AbortSignal;
}

export interface CriticRequest {
  readonly executionId: string;
  readonly runId: string;
  readonly round: number;
  readonly context: ContextSnapshot;
  readonly artifact: DraftArtifact;
  readonly deterministicFindings: readonly ValidationIssue[];
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
  readonly signal?: AbortSignal;
}

export interface AuthorAgent {
  readonly execute: (request: AuthorRequest) => Promise<AgentExecution<DraftArtifact>>;
}

export interface CriticAgent {
  readonly execute: (request: CriticRequest) => Promise<AgentExecution<Critique>>;
}

export interface ExecutionRecord<T = DraftArtifact | Critique> {
  readonly id: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly round: number;
  readonly step: Exclude<OrchestrationStep, null>;
  readonly status: ExecutionStatus;
  readonly output?: T;
  readonly provider: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly outputChecksum?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
  readonly completedAt: string;
  readonly errorCode?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly retryable?: boolean;
}

export interface RunError {
  readonly code: string;
  readonly message: string;
  readonly provider: string;
  readonly modelId: string;
  readonly step: Exclude<OrchestrationStep, null>;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryable: boolean;
  /** Absolute, content-free time before which a retry must not be attempted. */
  readonly retryNotBefore?: string;
  readonly providerRequestId: string | null;
  readonly diagnostics?: readonly RunErrorDiagnostic[];
}

export interface RunErrorDiagnostic {
  readonly code: string;
  readonly path: string;
}

export interface RunSnapshot {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly workspaceId: string;
  readonly contextSnapshotId: string;
  readonly state: RunState;
  readonly round: number;
  readonly currentStep: OrchestrationStep;
  readonly budget: RunBudget;
  readonly artifact: DraftArtifact | null;
  readonly findings: readonly ValidationIssue[];
  readonly latestEvaluation: ReadinessEvaluation | null;
  readonly scoreHistory: readonly ReadinessScoreVector[];
  readonly executionHistory: readonly ExecutionRecord[];
  readonly totalCostUsd: number;
  readonly approval: ApprovalStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: RunError | null;
}

export type RunEventType =
  | "run.created"
  | "state.changed"
  | "step.started"
  | "step.completed"
  | "execution.reused"
  | "provider.failed"
  | "provider.recovered"
  | "budget.exhausted"
  | "user.paused"
  | "user.stopped"
  | "user.approved"
  | "user.exported"
  | "user.revision-requested";

export interface RunEventInput {
  readonly id: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly type: RunEventType;
  readonly state: RunState;
  readonly round: number;
  readonly step: OrchestrationStep;
  readonly createdAt: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RunEvent extends RunEventInput {
  readonly sequence: number;
}

export interface RunStore {
  readonly loadRun: (runId: string) => Promise<RunSnapshot | undefined>;
  readonly saveRun: (snapshot: RunSnapshot) => Promise<void>;
  readonly saveExecution: (execution: ExecutionRecord) => Promise<void>;
  readonly findCompletedExecution: (
    runId: string,
    round: number,
    step: Exclude<OrchestrationStep, null>,
  ) => Promise<ExecutionRecord | undefined>;
  readonly appendEvent: (event: RunEventInput) => Promise<RunEvent>;
  readonly listEvents: (runId: string) => Promise<readonly RunEvent[]>;
}

export interface OrchestrationRequest {
  readonly runId: string;
  readonly workspace: Workspace;
  readonly context: ContextSnapshot;
  readonly budget: RunBudget;
  readonly initialArtifact?: DraftArtifact;
  /** Kept as an optional compatibility field for the original scaffold. */
  readonly input?: WorkspaceInput;
}

export interface ResumeOptions {
  readonly context?: ContextSnapshot;
  readonly budget?: RunBudget;
  readonly signal?: AbortSignal;
}

export interface OrchestrationEngine {
  /** Persist a new run without invoking an author or critic. */
  readonly begin: (request: OrchestrationRequest) => Promise<RunSnapshot>;
  readonly start: (request: OrchestrationRequest) => Promise<RunSnapshot>;
  readonly resume: (runId: string, options?: ResumeOptions) => Promise<RunSnapshot>;
  readonly pause: (runId: string) => Promise<RunSnapshot>;
  readonly stop: (runId: string) => Promise<RunSnapshot>;
  readonly recoverToReview: (runId: string) => Promise<RunSnapshot>;
  readonly approve: (runId: string) => Promise<RunSnapshot>;
  readonly markExported: (runId: string) => Promise<RunSnapshot>;
  readonly requestRevision: (runId: string) => Promise<RunSnapshot>;
  readonly events: (runId: string) => Promise<readonly RunEvent[]>;
}

export interface OrchestrationEngineOptions {
  readonly author: AuthorAgent;
  readonly critic: CriticAgent;
  readonly store: RunStore;
  readonly now?: () => string;
  readonly contextResolver?: (contextSnapshotId: string) => Promise<ContextSnapshot | undefined>;
  readonly retrieval?: RetrievalPort;
}

export interface StorageRunStore extends RunStore {}

interface AuditStorage extends StoragePort {
  readonly appendAuditEvent: (input: AuditEventInput) => Promise<unknown>;
  readonly listAuditEvents: (workspaceId: string) => Promise<readonly AuditRecord[]>;
  readonly saveRunSnapshot?: (input: RunSnapshotRecordInput) => Promise<unknown>;
  readonly getLatestRunSnapshot?: (runId: string) => Promise<
    | {
        readonly payload: JsonValue;
      }
    | undefined
  >;
}

interface AuditRecord {
  readonly eventType: string;
  readonly entityId: string;
  readonly payload: JsonValue;
}

const terminalStates: ReadonlySet<RunState> = new Set(["approved", "exported", "stopped"]);
export const MAX_ORCHESTRATION_ATTEMPTS = 3;
const stepStates: Readonly<Record<Exclude<OrchestrationStep, null>, RunState>> = {
  author: "drafting",
  critic: "reviewing",
  revision: "revising",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freeze(child);
  }
  return value;
}

function immutable<T>(value: T): T {
  return freeze(clone(value));
}

function nonEmpty(value: string, field: string): string {
  if (value.trim() === "") {
    throw new Error(`${field} must not be empty.`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function validateBudget(budget: RunBudget): RunBudget {
  const maxRounds = positiveInteger(budget.maxRounds, "maxRounds");
  for (const [name, value] of [
    ["maxCostUsd", budget.maxCostUsd],
    ["maxDurationMs", budget.maxDurationMs],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${name} must be a finite non-negative number.`);
    }
  }
  return immutable({
    maxRounds,
    ...(budget.maxCostUsd === undefined ? {} : { maxCostUsd: budget.maxCostUsd }),
    ...(budget.maxDurationMs === undefined ? {} : { maxDurationMs: budget.maxDurationMs }),
  });
}

function executionId(
  runId: string,
  round: number,
  step: Exclude<OrchestrationStep, null>,
  attempt: number,
): string {
  return `${runId}:${round}:${step}:attempt:${attempt}`;
}

function executionOutputIsArtifact(
  execution: ExecutionRecord,
): execution is ExecutionRecord<DraftArtifact> {
  return execution.step === "author" || execution.step === "revision";
}

function executionOutputIsCritique(
  execution: ExecutionRecord,
): execution is ExecutionRecord<Critique> {
  return execution.step === "critic";
}

function structurallyValidCritique(output: unknown): output is Critique {
  return (
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output) &&
    Array.isArray((output as { readonly findings?: unknown }).findings)
  );
}

export function hasCompletedIndependentCritique(
  snapshot: Pick<RunSnapshot, "runId" | "contextSnapshotId" | "round" | "executionHistory">,
): boolean {
  return (
    Array.isArray(snapshot.executionHistory) &&
    snapshot.executionHistory.some(
      (execution) =>
        execution.runId === snapshot.runId &&
        execution.contextSnapshotId === snapshot.contextSnapshotId &&
        execution.round === snapshot.round &&
        execution.step === "critic" &&
        execution.status === "completed" &&
        structurallyValidCritique(execution.output),
    )
  );
}

const providerErrorCodes = new Set([
  "authentication",
  "permission",
  "rate-limit",
  "quota-exhausted",
  "timeout",
  "cancelled",
  "transient",
  "invalid-request",
  "invalid-response",
  "policy",
  "unknown",
  "provider-error",
]);

const userRetryableProviderErrorCodes = new Set([
  "authentication",
  "rate-limit",
  "timeout",
  "transient",
  "invalid-response",
]);

function safeProviderRequestId(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) return null;
  if (
    /(?:^sk[-_]|api[-_]?key|token|secret|password|credential|authorization|bearer)/iu.test(value)
  ) {
    return null;
  }
  return value;
}

const maxRetryAfterMs = 60_000;

function safeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(maxRetryAfterMs, Math.round(value));
}

function retryNotBefore(value: unknown, now: string): string | undefined {
  const delay = safeRetryAfterMs(value);
  const nowMs = Date.parse(now);
  if (delay === undefined || !Number.isFinite(nowMs) || delay === 0) return undefined;
  return new Date(nowMs + delay).toISOString();
}

function providerFailure(
  value: unknown,
  context: ContextSnapshot,
  step: Exclude<OrchestrationStep, null>,
  attempt: number,
  now: string,
): RunError {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as {
          readonly code?: unknown;
          readonly retryable?: unknown;
          readonly retryAfterMs?: unknown;
          readonly requestId?: unknown;
          readonly diagnostics?: unknown;
        })
      : {};
  const selection =
    step === "critic" ? context.modelConfiguration.critic : context.modelConfiguration.author;
  const candidateCode =
    typeof candidate.code === "string" && candidate.code.trim() !== ""
      ? candidate.code
      : "provider-error";
  const code = providerErrorCodes.has(candidateCode) ? candidateCode : "provider-error";
  const retryable =
    userRetryableProviderErrorCodes.has(code) && attempt < MAX_ORCHESTRATION_ATTEMPTS;
  // A provider may omit Retry-After. Keep a short durable cooldown for rate
  // limits so an immediate manual click cannot start another retry burst.
  const retryAt = retryNotBefore(
    candidate.retryAfterMs ?? (code === "rate-limit" ? 5_000 : undefined),
    now,
  );
  const diagnostics = Array.isArray(candidate.diagnostics)
    ? candidate.diagnostics.slice(0, 8).flatMap((diagnostic): RunErrorDiagnostic[] => {
        if (typeof diagnostic !== "object" || diagnostic === null) return [];
        const value = diagnostic as { readonly code?: unknown; readonly path?: unknown };
        if (
          typeof value.code !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(value.code) ||
          typeof value.path !== "string" ||
          !/^[A-Za-z0-9_.-]{0,160}$/u.test(value.path)
        ) {
          return [];
        }
        return [{ code: value.code, path: value.path }];
      })
    : [];
  return {
    code,
    message: retryable
      ? "The provider request failed. You can retry safely."
      : "The provider request failed. Retry is not available.",
    provider: selection.company,
    modelId: selection.modelId,
    step,
    attempt,
    maxAttempts: MAX_ORCHESTRATION_ATTEMPTS,
    retryable,
    ...(retryAt === undefined ? {} : { retryNotBefore: retryAt }),
    providerRequestId: safeProviderRequestId(candidate.requestId),
    diagnostics,
  };
}

function executionFailure(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted !== true) return error;
  const reason = signal.reason;
  const name =
    typeof reason === "object" && reason !== null && "name" in reason
      ? String(reason.name)
      : "AbortError";
  return { code: name === "TimeoutError" ? "timeout" : "cancelled", retryable: false };
}

function validateCritique(value: Critique): readonly ValidationIssue[] {
  if (!Array.isArray(value.findings)) {
    return [
      { code: "invalid-critique", severity: "error", message: "Critique findings are required." },
    ];
  }
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  value.findings.forEach((finding, index) => {
    if (typeof finding.id !== "string" || finding.id.trim() === "") {
      issues.push({
        code: "invalid-critique-finding",
        severity: "error",
        message: `Critique finding ${index + 1} has no stable id.`,
      });
    } else if (seen.has(finding.id)) {
      issues.push({
        code: "duplicate-critique-finding",
        severity: "error",
        message: "Critique finding ids must be unique.",
      });
    } else {
      seen.add(finding.id);
    }
    if (finding.severity !== "error" && finding.severity !== "warning") {
      issues.push({
        code: "invalid-critique-severity",
        severity: "error",
        message: "Critique finding severity is invalid.",
      });
    }
    if (typeof finding.message !== "string" || finding.message.trim() === "") {
      issues.push({
        code: "invalid-critique-message",
        severity: "error",
        message: "Critique finding message is required.",
      });
    }
  });
  return issues;
}

function readinessContext(context: ContextSnapshot) {
  return {
    requirements: [...context.requirements],
    outputConstraints: {
      ...context.outputConstraints,
      requiredSections: [...context.outputConstraints.requiredSections],
    },
    readinessRubric: context.readinessRubric,
  };
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly runEvents = new Map<string, RunEvent[]>();

  public async loadRun(runId: string): Promise<RunSnapshot | undefined> {
    const value = this.runs.get(runId);
    return value === undefined ? undefined : immutable(value);
  }

  public async saveRun(snapshot: RunSnapshot): Promise<void> {
    this.runs.set(snapshot.runId, immutable(snapshot));
  }

  public async saveExecution(execution: ExecutionRecord): Promise<void> {
    const existing = this.executions.get(execution.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(execution)) {
      throw new Error(`Execution ${execution.id} is immutable.`);
    }
    this.executions.set(execution.id, immutable(execution));
  }

  public async findCompletedExecution(
    runId: string,
    round: number,
    step: Exclude<OrchestrationStep, null>,
  ): Promise<ExecutionRecord | undefined> {
    const candidates = [...this.executions.values()]
      .filter(
        (execution) =>
          execution.runId === runId &&
          execution.round === round &&
          execution.step === step &&
          execution.status === "completed",
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const value = candidates.at(-1);
    return value === undefined ? undefined : immutable(value);
  }

  public async appendEvent(input: RunEventInput): Promise<RunEvent> {
    const events = this.runEvents.get(input.runId) ?? [];
    const event = immutable({ ...input, sequence: events.length + 1 });
    events.push(event);
    this.runEvents.set(input.runId, events);
    return immutable(event);
  }

  public async listEvents(runId: string): Promise<readonly RunEvent[]> {
    return immutable(this.runEvents.get(runId) ?? []);
  }
}

export function createStorageRunStore(storage: AuditStorage): StorageRunStore {
  const runKey = (runId: string): string => `draft-loop:orchestration:run:${runId}`;
  const executionKey = (runId: string, id: string): string =>
    `draft-loop:orchestration:execution:${runId}:${id}`;
  const latestKey = (
    runId: string,
    round: number,
    step: Exclude<OrchestrationStep, null>,
  ): string => `draft-loop:orchestration:latest:${runId}:${round}:${step}`;

  const listEvents = async (runId: string): Promise<readonly RunEvent[]> => {
    const snapshotValue = await storage.get(runKey(runId));
    if (snapshotValue === undefined) return [];
    const workspaceId = (JSON.parse(snapshotValue) as RunSnapshot).workspaceId;
    const events = await storage.listAuditEvents(workspaceId);
    return immutable(
      events
        .filter((event) => event.eventType === "orchestration.event" && event.entityId === runId)
        .map((event) => event.payload as unknown as RunEvent)
        .sort((left, right) => left.sequence - right.sequence),
    );
  };

  const store: StorageRunStore = {
    async loadRun(runId) {
      const value = await storage.get(runKey(runId));
      if (value !== undefined) return immutable(JSON.parse(value) as RunSnapshot);
      const projected = await storage.getLatestRunSnapshot?.(runId);
      return projected === undefined
        ? undefined
        : immutable(projected.payload as unknown as RunSnapshot);
    },
    async saveRun(snapshot) {
      await storage.set(runKey(snapshot.runId), JSON.stringify(snapshot));
      await storage.saveRunSnapshot?.({
        workspaceId: snapshot.workspaceId,
        runId: snapshot.runId,
        contextSnapshotId: snapshot.contextSnapshotId,
        state: snapshot.state,
        round: snapshot.round,
        currentStep: snapshot.currentStep,
        budget: asJson(snapshot.budget),
        artifactId: snapshot.artifact?.id ?? null,
        approval: snapshot.approval,
        totalCostUsd: snapshot.totalCostUsd,
        startedAt: snapshot.startedAt,
        updatedAt: snapshot.updatedAt,
        lastError: snapshot.lastError === null ? null : asJson(snapshot.lastError),
        payload: asJson(snapshot),
      });
    },
    async saveExecution(execution) {
      const key = executionKey(execution.runId, execution.id);
      const serialized = JSON.stringify(execution);
      const existing = await storage.get(key);
      if (existing !== undefined && existing !== serialized) {
        throw new Error(`Execution ${execution.id} is immutable.`);
      }
      await storage.set(key, serialized);
      if (execution.status === "completed") {
        await storage.set(
          latestKey(execution.runId, execution.round, execution.step),
          execution.id,
        );
      }
    },
    async findCompletedExecution(runId, round, step) {
      const id = await storage.get(latestKey(runId, round, step));
      if (id === undefined) return undefined;
      const value = await storage.get(executionKey(runId, id));
      return value === undefined ? undefined : immutable(JSON.parse(value) as ExecutionRecord);
    },
    async appendEvent(input) {
      const events = await listEvents(input.runId);
      const event = immutable({ ...input, sequence: events.length + 1 });
      await storage.appendAuditEvent({
        id: `orchestration-event:${input.runId}:${event.sequence}`,
        workspaceId: input.workspaceId,
        eventType: "orchestration.event",
        entityType: "run",
        entityId: input.runId,
        payload: asJson(event),
        createdAt: input.createdAt,
      });
      return event;
    },
    async listEvents(runId) {
      return listEvents(runId);
    },
  };
  return store;
}

function initialSnapshot(request: OrchestrationRequest, now: string): RunSnapshot {
  const budget = validateBudget(request.budget);
  return immutable({
    schemaVersion: 1,
    runId: nonEmpty(request.runId, "runId"),
    workspaceId: request.workspace.id,
    contextSnapshotId: request.context.id,
    state: "drafting",
    round: 1,
    currentStep: "author",
    budget,
    artifact: request.initialArtifact ?? null,
    findings: [],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: [],
    totalCostUsd: 0,
    approval: "pending",
    startedAt: now,
    updatedAt: now,
    lastError: null,
  });
}

function validateOrchestrationRequest(request: OrchestrationRequest): void {
  if (request.context.workspaceId !== request.workspace.id) {
    throw new Error("The context snapshot must belong to the requested workspace.");
  }
  const validation = validateContextSnapshotInput(request.context);
  if (!validation.valid) {
    throw new SemanticValidationError(validation.issues);
  }
}

export function createOrchestrationEngine(
  options: OrchestrationEngineOptions,
): OrchestrationEngine & OrchestrationPort {
  const clock = options.now ?? (() => new Date().toISOString());

  const save = async (snapshot: RunSnapshot): Promise<RunSnapshot> => {
    const immutableSnapshot = immutable(snapshot);
    await options.store.saveRun(immutableSnapshot);
    return immutableSnapshot;
  };

  const emit = async (
    snapshot: RunSnapshot,
    type: RunEventType,
    details?: RunEventInput["details"],
  ): Promise<RunEvent> => {
    const prior = await options.store.listEvents(snapshot.runId);
    return options.store.appendEvent({
      id: `${snapshot.runId}:event:${prior.length + 1}`,
      runId: snapshot.runId,
      workspaceId: snapshot.workspaceId,
      type,
      state: snapshot.state,
      round: snapshot.round,
      step: snapshot.currentStep,
      createdAt: snapshot.updatedAt,
      ...(details === undefined ? {} : { details }),
    });
  };

  const saveAndEmit = async (
    snapshot: RunSnapshot,
    type: RunEventType,
    details?: RunEventInput["details"],
  ): Promise<RunSnapshot> => {
    const saved = await save(snapshot);
    await emit(saved, type, details);
    return saved;
  };

  const budgetReason = (snapshot: RunSnapshot, now: string): string | undefined => {
    if (snapshot.round > snapshot.budget.maxRounds) return "maximum rounds exhausted";
    if (
      snapshot.budget.maxCostUsd !== undefined &&
      snapshot.totalCostUsd >= snapshot.budget.maxCostUsd
    )
      return "maximum cost budget exhausted";
    if (
      snapshot.budget.maxDurationMs !== undefined &&
      Date.parse(now) - Date.parse(snapshot.startedAt) >= snapshot.budget.maxDurationMs
    )
      return "maximum duration budget exhausted";
    return undefined;
  };

  const transitionToAwaitingApproval = async (
    snapshot: RunSnapshot,
    reason: string,
  ): Promise<RunSnapshot> => {
    const updated = {
      ...snapshot,
      state: "awaiting-approval" as const,
      currentStep: null,
      approval: "pending" as const,
      updatedAt: clock(),
      lastError: null,
    };
    await saveAndEmit(updated, "state.changed", { to: "awaiting-approval", reason });
    return updated;
  };

  const recordFailure = async (snapshot: RunSnapshot, failure: RunError): Promise<RunSnapshot> => {
    const updated = {
      ...snapshot,
      state: "provider-error" as const,
      updatedAt: clock(),
      lastError: failure,
    };
    await saveAndEmit(updated, "provider.failed", {
      code: failure.code,
      provider: failure.provider,
      modelId: failure.modelId,
      step: failure.step,
      attempt: failure.attempt,
      maxAttempts: failure.maxAttempts,
      retryable: failure.retryable,
      providerRequestId: failure.providerRequestId,
    });
    return updated;
  };

  const executeStep = async (
    snapshot: RunSnapshot,
    context: ContextSnapshot,
    signal?: AbortSignal,
  ): Promise<RunSnapshot> => {
    if (snapshot.currentStep === null) return snapshot;
    const step = snapshot.currentStep;
    const now = clock();
    const reason = budgetReason(snapshot, now);
    if (reason !== undefined) {
      const exhausted = {
        ...snapshot,
        state: "budget-exhausted" as const,
        updatedAt: now,
        currentStep: null,
      };
      await saveAndEmit(exhausted, "budget.exhausted", { reason });
      return transitionToAwaitingApproval(exhausted, reason);
    }

    const existing = await options.store.findCompletedExecution(
      snapshot.runId,
      snapshot.round,
      step,
    );
    if (existing !== undefined) {
      await emit(snapshot, "execution.reused", { executionId: existing.id, step });
      const alreadyRecorded = snapshot.executionHistory.some(({ id }) => id === existing.id);
      const replaySnapshot = alreadyRecorded
        ? snapshot
        : {
            ...snapshot,
            executionHistory: [...snapshot.executionHistory, existing],
            totalCostUsd: snapshot.totalCostUsd + (existing.estimatedUsd ?? 0),
            updatedAt: clock(),
          };
      const saved = alreadyRecorded ? replaySnapshot : await save(replaySnapshot);
      return completeStep(saved, context, existing);
    }

    const attempt =
      snapshot.executionHistory.filter(
        (execution) =>
          execution.runId === snapshot.runId &&
          execution.round === snapshot.round &&
          execution.step === step,
      ).length + 1;
    if (attempt > MAX_ORCHESTRATION_ATTEMPTS) {
      return snapshot.state === "provider-error"
        ? snapshot
        : recordFailure(
            snapshot,
            providerFailure(
              { code: snapshot.lastError?.code, retryable: false },
              context,
              step,
              MAX_ORCHESTRATION_ATTEMPTS,
              clock(),
            ),
          );
    }
    const id = executionId(snapshot.runId, snapshot.round, step, attempt);
    await emit(snapshot, "step.started", { step, executionId: id });
    try {
      if (step === "critic" && snapshot.artifact === null) {
        throw new Error("critic requires an artifact");
      }
      const retrievedEvidence = options.retrieval
        ? await options.retrieval
            .queryEvidence(
              context.jobDescription || context.requirements.map((r) => r.text).join(" "),
              { workspaceId: snapshot.workspaceId },
            )
            .catch(() => [])
        : undefined;

      const execution =
        step === "critic"
          ? await options.critic.execute({
              executionId: id,
              runId: snapshot.runId,
              round: snapshot.round,
              context,
              artifact: snapshot.artifact as DraftArtifact,
              deterministicFindings: snapshot.findings,
              ...(retrievedEvidence ? { retrievedEvidence } : {}),
              ...(signal === undefined ? {} : { signal }),
            })
          : await options.author.execute({
              executionId: id,
              runId: snapshot.runId,
              round: snapshot.round,
              context,
              currentArtifact: snapshot.artifact,
              findings: snapshot.findings,
              ...(retrievedEvidence ? { retrievedEvidence } : {}),
              ...(signal === undefined ? {} : { signal }),
            });
      const record: ExecutionRecord = {
        id,
        runId: snapshot.runId,
        contextSnapshotId: context.id,
        round: snapshot.round,
        step,
        status: "completed",
        output: execution.output,
        provider: execution.provider,
        modelId: execution.modelId,
        providerRequestId: execution.providerRequestId,
        outputChecksum: execution.outputChecksum,
        inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens,
        totalTokens: execution.totalTokens,
        estimatedUsd: execution.estimatedUsd,
        completedAt: execution.completedAt,
        attempt,
        maxAttempts: MAX_ORCHESTRATION_ATTEMPTS,
        retryable: false,
      };
      await options.store.saveExecution(record);
      const updated = {
        ...snapshot,
        executionHistory: [...snapshot.executionHistory, record],
        totalCostUsd: snapshot.totalCostUsd + (execution.estimatedUsd ?? 0),
        updatedAt: clock(),
        lastError: null,
      };
      const saved = await saveAndEmit(updated, "step.completed", { step, executionId: id });
      return completeStep(saved, context, record);
    } catch (error) {
      const failure = providerFailure(
        executionFailure(error, signal),
        context,
        step,
        attempt,
        clock(),
      );
      const failedExecution: ExecutionRecord = {
        id,
        runId: snapshot.runId,
        contextSnapshotId: context.id,
        round: snapshot.round,
        step,
        status: "failed",
        provider: failure.provider,
        modelId: failure.modelId,
        providerRequestId: failure.providerRequestId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedUsd: null,
        completedAt: clock(),
        errorCode: failure.code,
        attempt,
        maxAttempts: MAX_ORCHESTRATION_ATTEMPTS,
        retryable: failure.retryable,
      };
      await options.store.saveExecution(failedExecution);
      return recordFailure(
        {
          ...snapshot,
          executionHistory: [...snapshot.executionHistory, failedExecution],
        },
        failure,
      );
    }
  };

  const completeStep = async (
    snapshot: RunSnapshot,
    context: ContextSnapshot,
    execution: ExecutionRecord,
  ): Promise<RunSnapshot> => {
    if (executionOutputIsArtifact(execution)) {
      const artifact = execution.output;
      if (artifact === undefined)
        return recordFailure(
          snapshot,
          providerFailure(
            { code: "invalid-response", retryable: false },
            context,
            execution.step,
            execution.attempt ?? 1,
            clock(),
          ),
        );
      const validation = validateDraftArtifact(artifact, {
        requirements: [...context.requirements],
        outputConstraints: {
          ...context.outputConstraints,
          requiredSections: [...context.outputConstraints.requiredSections],
        },
      });
      const updated = {
        ...snapshot,
        artifact,
        findings: validation.issues,
        state: "reviewing" as const,
        currentStep: "critic" as const,
        updatedAt: clock(),
      };
      return saveAndEmit(updated, "state.changed", { to: "reviewing" });
    }
    if (
      !executionOutputIsCritique(execution) ||
      execution.output === undefined ||
      typeof execution.output !== "object" ||
      execution.output === null
    )
      return recordFailure(
        snapshot,
        providerFailure(
          { code: "invalid-response", retryable: false },
          context,
          execution.step,
          execution.attempt ?? 1,
          clock(),
        ),
      );
    const critiqueIssues = validateCritique(execution.output);
    const combined = [...snapshot.findings, ...critiqueIssues, ...execution.output.findings];
    const evaluation = evaluateReadiness(
      snapshot.artifact as DraftArtifact,
      readinessContext(context),
      {
        round: snapshot.round,
        priorScoreHistory: snapshot.scoreHistory,
        findings: combined,
        maxRounds: snapshot.budget.maxRounds,
      },
    );
    const updated = {
      ...snapshot,
      findings: combined,
      latestEvaluation: evaluation,
      scoreHistory: [...snapshot.scoreHistory, evaluation.scoreVector],
      updatedAt: clock(),
    };
    if (evaluation.ready)
      return transitionToAwaitingApproval(
        { ...updated, state: "awaiting-approval" as const, currentStep: null },
        "ready",
      );
    if (evaluation.shouldStop)
      return transitionToAwaitingApproval(
        { ...updated, state: "awaiting-approval" as const, currentStep: null },
        evaluation.stopReason,
      );
    return saveAndEmit(
      {
        ...updated,
        state: "revising" as const,
        round: snapshot.round + 1,
        currentStep: "revision" as const,
      },
      "state.changed",
      { to: "revising" },
    );
  };

  const advance = async (
    snapshot: RunSnapshot,
    context: ContextSnapshot,
    signal?: AbortSignal,
  ): Promise<RunSnapshot> => {
    let current = snapshot;
    if (current.state === "provider-error") {
      if (current.lastError?.retryable !== true) return immutable(current);
      const attempts = current.executionHistory.filter(
        (execution) =>
          execution.runId === current.runId &&
          execution.round === current.round &&
          execution.step === current.currentStep,
      ).length;
      if (
        current.currentStep === null ||
        attempts >= MAX_ORCHESTRATION_ATTEMPTS ||
        current.lastError.attempt >= current.lastError.maxAttempts
      )
        return immutable(current);
      if (
        current.lastError.retryNotBefore !== undefined &&
        Date.parse(current.lastError.retryNotBefore) > Date.parse(clock())
      ) {
        return immutable(current);
      }
      const resumed = await save({
        ...current,
        state: stepStates[current.currentStep ?? "author"],
        lastError: null,
        updatedAt: clock(),
      });
      await emit(resumed, "state.changed", { to: resumed.state, reason: "retry" });
      current = resumed;
    }
    while (
      current.currentStep !== null &&
      !terminalStates.has(current.state) &&
      current.state !== "paused" &&
      current.state !== "awaiting-approval" &&
      current.state !== "provider-error"
    ) {
      current = await executeStep(current, context, signal);
    }
    return immutable(current);
  };

  const loadForAction = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await options.store.loadRun(nonEmpty(runId, "runId"));
    if (snapshot === undefined) throw new Error(`Run ${runId} was not found.`);
    return snapshot;
  };

  const begin = async (request: OrchestrationRequest): Promise<RunSnapshot> => {
    validateOrchestrationRequest(request);
    const budget = validateBudget(request.budget);
    let snapshot = await options.store.loadRun(request.runId);
    if (snapshot === undefined) {
      snapshot = initialSnapshot({ ...request, budget }, clock());
      await saveAndEmit(snapshot, "run.created", { runId: snapshot.runId });
    }
    return immutable(snapshot);
  };

  const start = async (request: OrchestrationRequest): Promise<RunSnapshot> => {
    const snapshot = await begin(request);
    if (
      snapshot.state === "approved" ||
      snapshot.state === "stopped" ||
      snapshot.state === "exported"
    )
      return immutable(snapshot);
    const active =
      snapshot.state === "paused"
        ? { ...snapshot, state: stepStates[snapshot.currentStep ?? "author"] }
        : snapshot;
    return advance(active, request.context);
  };

  const resume = async (runId: string, resumeOptions: ResumeOptions = {}): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (
      snapshot.state === "approved" ||
      snapshot.state === "stopped" ||
      snapshot.state === "exported"
    )
      return snapshot;
    const legacyCriticRecovery =
      snapshot.state === "awaiting-approval" &&
      snapshot.artifact !== null &&
      !hasCompletedIndependentCritique(snapshot) &&
      snapshot.lastError?.step === "critic";
    if (snapshot.state === "awaiting-approval" && !legacyCriticRecovery) return snapshot;
    if (
      legacyCriticRecovery &&
      resumeOptions.context !== undefined &&
      (resumeOptions.context.id !== snapshot.contextSnapshotId ||
        resumeOptions.context.workspaceId !== snapshot.workspaceId)
    ) {
      throw new Error("The context snapshot does not match the run context.");
    }
    if (
      legacyCriticRecovery &&
      (snapshot.lastError?.retryable !== true ||
        snapshot.executionHistory.filter(
          (execution) =>
            execution.runId === snapshot.runId &&
            execution.round === snapshot.round &&
            execution.step === "critic",
        ).length >= MAX_ORCHESTRATION_ATTEMPTS ||
        snapshot.lastError.attempt >= snapshot.lastError.maxAttempts ||
        (snapshot.lastError.retryNotBefore !== undefined &&
          Date.parse(snapshot.lastError.retryNotBefore) > Date.parse(clock())))
    ) {
      return immutable(snapshot);
    }
    const context =
      resumeOptions.context ?? (await options.contextResolver?.(snapshot.contextSnapshotId));
    if (context === undefined)
      throw new Error("A context snapshot is required to resume this run.");
    if (
      legacyCriticRecovery &&
      (context.id !== snapshot.contextSnapshotId || context.workspaceId !== snapshot.workspaceId)
    ) {
      throw new Error("The context snapshot does not match the run context.");
    }
    const resumed =
      legacyCriticRecovery || resumeOptions.budget === undefined
        ? snapshot
        : { ...snapshot, budget: validateBudget(resumeOptions.budget), updatedAt: clock() };
    const active = legacyCriticRecovery
      ? { ...resumed, state: "provider-error" as const, currentStep: "critic" as const }
      : resumed.state === "paused"
        ? { ...resumed, state: stepStates[resumed.currentStep ?? "author"] }
        : resumed;
    return advance(active, context, resumeOptions.signal);
  };

  const pause = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (
      terminalStates.has(snapshot.state) ||
      snapshot.state === "awaiting-approval" ||
      snapshot.state === "provider-error"
    )
      throw new Error("Only an active run can be paused.");
    const updated = { ...snapshot, state: "paused" as const, updatedAt: clock() };
    await saveAndEmit(updated, "user.paused");
    await emit(updated, "state.changed", { to: "paused" });
    return updated;
  };

  const stop = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (snapshot.state === "stopped") return snapshot;
    if (terminalStates.has(snapshot.state)) throw new Error("The run is already terminal.");
    const updated = {
      ...snapshot,
      state: "stopped" as const,
      currentStep: null,
      updatedAt: clock(),
    };
    await saveAndEmit(updated, "user.stopped");
    await emit(updated, "state.changed", { to: "stopped" });
    return updated;
  };

  const recoverToReview = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (snapshot.state !== "provider-error") {
      throw new Error("Only a run with a provider error can return to review.");
    }
    if (!hasCompletedIndependentCritique(snapshot)) {
      throw new Error(
        "A completed independent critic review is required before returning to review.",
      );
    }
    if (snapshot.artifact === null) {
      throw new Error("A draft artifact is required to return to review.");
    }
    const updated = {
      ...snapshot,
      state: "awaiting-approval" as const,
      currentStep: null,
      approval: "pending" as const,
      updatedAt: clock(),
    };
    await saveAndEmit(updated, "provider.recovered", {
      action: "return-to-review",
      code: snapshot.lastError?.code ?? "provider-error",
    });
    await emit(updated, "state.changed", { to: "awaiting-approval", reason: "provider-recovery" });
    return updated;
  };

  const approve = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (snapshot.state !== "awaiting-approval")
      throw new Error("Only a run awaiting approval can be approved.");
    if (!hasCompletedIndependentCritique(snapshot))
      throw new Error("A completed independent critic review is required before approval.");
    const updated = {
      ...snapshot,
      state: "approved" as const,
      approval: "approved" as const,
      currentStep: null,
      updatedAt: clock(),
    };
    await saveAndEmit(updated, "user.approved");
    await emit(updated, "state.changed", { to: "approved" });
    return updated;
  };

  const markExported = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (snapshot.state === "exported") return snapshot;
    if (snapshot.state !== "approved")
      throw new Error("Only an approved run can be marked as exported.");
    if (!hasCompletedIndependentCritique(snapshot))
      throw new Error("A completed independent critic review is required before export.");
    const updated = {
      ...snapshot,
      state: "exported" as const,
      currentStep: null,
      updatedAt: clock(),
    };
    await saveAndEmit(updated, "user.exported");
    await emit(updated, "state.changed", { to: "exported" });
    return updated;
  };

  const requestRevision = async (runId: string): Promise<RunSnapshot> => {
    const snapshot = await loadForAction(runId);
    if (snapshot.state !== "awaiting-approval")
      throw new Error("Only a run awaiting approval can request revision.");
    if (!hasCompletedIndependentCritique(snapshot)) {
      throw new Error(
        "A completed independent critic review is required before requesting revision.",
      );
    }
    const updated = {
      ...snapshot,
      state: "revising" as const,
      approval: "rejected" as const,
      round: snapshot.round + 1,
      currentStep: "revision" as const,
      updatedAt: clock(),
    };
    await saveAndEmit(updated, "user.revision-requested");
    await emit(updated, "state.changed", { to: "revising" });
    return updated;
  };

  const events = (runId: string): Promise<readonly RunEvent[]> => options.store.listEvents(runId);

  return {
    begin,
    start,
    run: start,
    resume,
    pause,
    stop,
    recoverToReview,
    approve,
    markExported,
    requestRevision,
    events,
  };
}

export interface OrchestrationPort {
  readonly run: (request: OrchestrationRequest) => Promise<RunSnapshot>;
}

export type { RetrievalOptions, RetrievalPort, ScoredEvidenceChunk };
