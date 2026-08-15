import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import {
  type ApplicationIo,
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import {
  ingestFile,
  ingestUrl,
  type SourceChunk,
  type UrlFetcher,
  type UrlHostnameResolver,
} from "@draft-loop/ingestion";
import type { RunSnapshot } from "@draft-loop/orchestrator";

import {
  type BridgeCapability,
  type BridgeCommand,
  type BridgeResult,
  bridgeCapabilities,
  type CredentialProtection,
  type CredentialProvider,
  type CredentialSource,
  credentialProviders,
  type ExportFormat,
  type FileSelectInput,
  type FileSelectResult,
  type ReviewDispatchInput,
  type SelectedFile,
  type SourceAddUrlInput,
  type SourceAddUrlResult,
  type SupportedFileExtension,
  type SupportedMediaType,
  safeBridgeError,
  validateBridgeCommand,
} from "../bridge.js";
import type {
  DesktopReviewState,
  FindingDecision,
  ProviderFailureView,
  ProviderTransmissionPolicy,
  ProviderTransmissionPreflight,
  ReviewAction,
  ReviewArtifact,
  ReviewClaim,
  ReviewEvent,
  ReviewFinding,
  ReviewSection,
  WorkspaceReadiness,
} from "../model.js";

const configDirectory = ".draft-loop";
const sourceProvenanceFilename = "source-provenance.json";
const providerTransmissionAcknowledgementFilename = "provider-transmission-acknowledgement.json";
const maxImportedFileBytes = 20 * 1024 * 1024;

const transmissionScope = [
  "job description and requirements",
  "evidence manifest",
  "selected retrieved evidence chunks",
  "current draft and structured findings",
] as const;
const excludedTransmissionScope = ["complete candidate corpus"] as const;

interface PersistedProviderTransmissionAcknowledgement {
  readonly schemaVersion: 1;
  readonly fingerprint: string;
  readonly acknowledgedAt: string;
  readonly policy: ProviderTransmissionPolicy;
}

export interface NativeHostDialogs {
  readonly chooseDirectory: (mode: "open" | "create") => Promise<string | undefined>;
  readonly chooseFiles: (input: FileSelectInput) => Promise<readonly string[]>;
}

export interface NativeCredentialStore {
  readonly status: (provider: CredentialProvider) => Promise<{
    configured: boolean;
    source: CredentialSource;
    protection: CredentialProtection;
  }>;
  readonly set: (provider: CredentialProvider, apiKey?: string) => Promise<boolean>;
  readonly remove: (provider: CredentialProvider) => Promise<boolean>;
  readonly get?: (provider: CredentialProvider) => Promise<string | undefined>;
}

export interface NativeHostOptions {
  readonly applicationService?: ApplicationService;
  readonly dialogs: NativeHostDialogs;
  readonly credentials?: NativeCredentialStore;
  readonly urlFetcher?: UrlFetcher;
  readonly urlHostnameResolver?: UrlHostnameResolver;
  /** Acceptance-only switch for exercising the preflight with offline fixtures. */
  readonly requireProviderPreflight?: boolean;
  readonly onError?: (error: unknown, capability: BridgeCapability) => void;
}

interface ActiveWorkspace {
  readonly descriptor: WorkspaceDescriptor;
  readonly root: string;
}

interface ReviewOverrides {
  readonly decisions: Readonly<Record<string, FindingDecision>>;
  readonly rationales: Readonly<Record<string, string>>;
  readonly edits: Readonly<Record<string, string>>;
  readonly history: readonly ReviewDecisionHistoryEntry[];
}

interface ReviewDecisionHistoryEntry {
  readonly findingId: string;
  readonly decision: FindingDecision;
  readonly rationale?: string;
  readonly createdAt: string;
}

const emptyOverrides: ReviewOverrides = { decisions: {}, rationales: {}, edits: {}, history: [] };
const defaultIo: ApplicationIo = { write: () => undefined };

class NativeHostError extends Error {
  public readonly code: "permission-denied" | "not-found" | "operation-failed";

  public constructor(
    code: "permission-denied" | "not-found" | "operation-failed",
    message: string,
  ) {
    super(message);
    this.name = "NativeHostError";
    this.code = code;
  }
}

function fail(
  code: "permission-denied" | "not-found" | "operation-failed",
  message: string,
): never {
  throw new NativeHostError(code, message);
}

function overridesPath(root: string): string {
  return join(root, configDirectory, "review-overrides.json");
}

function sourceProvenancePath(root: string): string {
  return join(root, configDirectory, sourceProvenanceFilename);
}

function providerTransmissionAcknowledgementPath(root: string): string {
  return join(root, configDirectory, providerTransmissionAcknowledgementFilename);
}

function providerEndpoint(company: string, fixtureMode: boolean): string {
  if (fixtureMode) return "local fixture (no network)";
  switch (company.trim().toLowerCase()) {
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    case "openai":
      return "https://api.openai.com/v1/responses";
    default:
      return fail("operation-failed", `Unsupported live provider company: ${company}.`);
  }
}

function providerTransmissionPolicy(descriptor: WorkspaceDescriptor): ProviderTransmissionPolicy {
  return {
    dataClass: descriptor.fixtureMode
      ? "synthetic-demo-material"
      : "candidate-application-material",
    transmissionScope,
    excludedScope: excludedTransmissionScope,
    author: {
      ...descriptor.author,
      endpoint: providerEndpoint(descriptor.author.company, descriptor.fixtureMode),
    },
    critic: {
      ...descriptor.critic,
      endpoint: providerEndpoint(descriptor.critic.company, descriptor.fixtureMode),
    },
    retentionPreference: descriptor.fixtureMode ? "not-allowed" : "ephemeral-request",
    budget: {
      maxRounds: descriptor.maxRounds,
      maxCostUsd: descriptor.maxCostUsd ?? null,
      maxDurationMs: descriptor.maxDurationMs ?? null,
    },
  };
}

function providerTransmissionFingerprint(policy: ProviderTransmissionPolicy): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderIdentity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === 3 &&
    typeof value.company === "string" &&
    value.company.length <= 80 &&
    typeof value.model === "string" &&
    value.model.length <= 160 &&
    typeof value.endpoint === "string" &&
    value.endpoint.length <= 300
  );
}

function isProviderTransmissionPolicy(value: unknown): value is ProviderTransmissionPolicy {
  if (!isRecord(value) || Object.keys(value).length !== 7) return false;
  const budget = value.budget;
  return (
    (value.dataClass === "candidate-application-material" ||
      value.dataClass === "synthetic-demo-material") &&
    JSON.stringify(value.transmissionScope) === JSON.stringify(transmissionScope) &&
    JSON.stringify(value.excludedScope) === JSON.stringify(excludedTransmissionScope) &&
    isProviderIdentity(value.author) &&
    isProviderIdentity(value.critic) &&
    (value.retentionPreference === "ephemeral-request" ||
      value.retentionPreference === "not-allowed") &&
    isRecord(budget) &&
    Object.keys(budget).length === 3 &&
    Number.isInteger(budget.maxRounds) &&
    (budget.maxRounds as number) > 0 &&
    (budget.maxCostUsd === null ||
      (typeof budget.maxCostUsd === "number" &&
        Number.isFinite(budget.maxCostUsd) &&
        budget.maxCostUsd >= 0)) &&
    (budget.maxDurationMs === null ||
      (typeof budget.maxDurationMs === "number" &&
        Number.isInteger(budget.maxDurationMs) &&
        budget.maxDurationMs > 0))
  );
}

async function readProviderTransmissionAcknowledgement(
  root: string,
): Promise<PersistedProviderTransmissionAcknowledgement | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(providerTransmissionAcknowledgementPath(root), "utf8"),
    );
    if (!isRecord(value) || Object.keys(value).length !== 4) return undefined;
    if (
      value.schemaVersion !== 1 ||
      typeof value.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
      typeof value.acknowledgedAt !== "string" ||
      value.acknowledgedAt.length > 64 ||
      !Number.isFinite(Date.parse(value.acknowledgedAt)) ||
      !isProviderTransmissionPolicy(value.policy)
    ) {
      return undefined;
    }
    return value as unknown as PersistedProviderTransmissionAcknowledgement;
  } catch {
    return undefined;
  }
}

async function providerTransmissionPreflight(
  descriptor: WorkspaceDescriptor,
  root: string,
  requireForFixture = false,
): Promise<ProviderTransmissionPreflight> {
  const policy = providerTransmissionPolicy(descriptor);
  const fingerprint = providerTransmissionFingerprint(policy);
  if (descriptor.fixtureMode && !requireForFixture) {
    return { ...policy, required: false, fingerprint, acknowledged: true, acknowledgedAt: null };
  }
  const acknowledgement = await readProviderTransmissionAcknowledgement(root);
  const acknowledged =
    acknowledgement?.fingerprint === fingerprint &&
    JSON.stringify(acknowledgement.policy) === JSON.stringify(policy);
  return {
    ...policy,
    required: true,
    fingerprint,
    acknowledged,
    acknowledgedAt: acknowledged ? (acknowledgement?.acknowledgedAt ?? null) : null,
  };
}

async function writeProviderTransmissionAcknowledgement(
  root: string,
  policy: ProviderTransmissionPolicy,
  fingerprint: string,
): Promise<string> {
  const acknowledgedAt = new Date().toISOString();
  const value: PersistedProviderTransmissionAcknowledgement = {
    schemaVersion: 1,
    fingerprint,
    acknowledgedAt,
    policy,
  };
  const path = providerTransmissionAcknowledgementPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return acknowledgedAt;
}

function rootRelative(root: string, candidate: string): string {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const value = relative(normalizedRoot, normalizedCandidate).replaceAll("\\", "/");
  if (value === "" || (!value.startsWith("..") && !isAbsolute(value))) return value;
  return fail("permission-denied", "The selected path is outside the workspace.");
}

function workspaceName(root: string): string {
  return basename(root) || "DraftLoop workspace";
}

function extensionForMediaType(extension: string): SupportedMediaType {
  const normalized = extension.toLowerCase();
  if ([".md", ".markdown"].includes(normalized)) return "text/markdown";
  if ([".txt", ".text"].includes(normalized)) return "text/plain";
  if ([".html", ".htm"].includes(normalized)) return "text/html";
  if (normalized === ".pdf") return "application/pdf";
  if (normalized === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return fail("operation-failed", "The selected file type is not supported.");
}

function isSupportedEvidenceFile(path: string): boolean {
  return [".md", ".markdown", ".txt", ".text", ".html", ".htm", ".pdf", ".docx"].includes(
    extname(path).toLowerCase(),
  );
}

async function countEvidenceFiles(path: string): Promise<number> {
  try {
    const details = await stat(path);
    if (details.isFile()) return isSupportedEvidenceFile(path) ? 1 : 0;
    if (!details.isDirectory()) return 0;
    const entries = await readdir(path, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      count += await countEvidenceFiles(join(path, entry.name));
    }
    return count;
  } catch {
    return 0;
  }
}

function io(): ApplicationIo {
  return defaultIo;
}

function runState(snapshot: RunSnapshot): DesktopReviewState["state"] {
  if (snapshot.state === "provider-error") return "provider-error";
  if (snapshot.state === "stopped") return "stopped";
  if (snapshot.state === "collecting" || snapshot.state === "ingesting") return "drafting";
  return snapshot.state;
}

const providerFailureExplanations: Readonly<Record<ProviderFailureView["code"], string>> = {
  authentication: "The provider could not authenticate. Check the configured credential.",
  permission: "The provider denied permission for this request or model.",
  "rate-limit": "The provider rate limit was reached. Wait briefly before retrying.",
  timeout: "The provider did not respond before the request timed out.",
  cancelled: "The provider request was cancelled.",
  transient: "The provider is temporarily unavailable.",
  "invalid-request": "The provider rejected the request configuration.",
  "invalid-response": "The provider returned a response that could not be validated.",
  policy: "The provider transmission policy prevented this request.",
  unknown: "The provider request failed for an unknown reason.",
};

function providerFailure(snapshot: RunSnapshot): ProviderFailureView | null {
  if (snapshot.state !== "provider-error" || snapshot.lastError === null) return null;
  const supportedCodes = Object.keys(providerFailureExplanations) as ProviderFailureView["code"][];
  const code = supportedCodes.includes(snapshot.lastError.code as ProviderFailureView["code"])
    ? (snapshot.lastError.code as ProviderFailureView["code"])
    : "unknown";
  const retryAvailable =
    snapshot.lastError.retryable && snapshot.lastError.attempt < snapshot.lastError.maxAttempts;
  return {
    code,
    explanation: providerFailureExplanations[code],
    provider: snapshot.lastError.provider,
    model: snapshot.lastError.modelId,
    step: snapshot.lastError.step,
    attempt: snapshot.lastError.attempt,
    maxAttempts: snapshot.lastError.maxAttempts,
    retryAvailable,
    availableActions: [
      ...(retryAvailable ? (["retry"] as const) : []),
      ...(snapshot.artifact === null ? [] : (["return-to-review"] as const)),
      "stop" as const,
    ],
  };
}

function reviewArtifact(
  artifact: RunSnapshot["artifact"],
  overrides: ReviewOverrides,
): ReviewArtifact {
  if (artifact === null) fail("not-found", "The run has no draft artifact yet.");
  const sections: readonly ReviewSection[] = artifact.sections.map((section) => ({
    id: section.id,
    title: section.title,
    blocks: section.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      text: overrides.edits[block.id] ?? block.text,
      claimIds: [...block.claimIds],
    })),
  }));
  const claims: readonly ReviewClaim[] = artifact.claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    status: claim.status,
    evidence: claim.evidence.map((evidence) => ({
      sourcePath: evidence.sourcePath,
      locator: "linked claim evidence",
      excerpt: evidence.excerpt,
      status: "supports",
    })),
  }));
  return {
    id: artifact.id,
    version: artifact.version,
    createdAt: artifact.createdAt,
    sections,
    claims,
  };
}

function previousArtifact(snapshot: RunSnapshot, current: ReviewArtifact): ReviewArtifact | null {
  const candidates = snapshot.executionHistory
    .filter(
      (execution) =>
        (execution.step === "author" || execution.step === "revision") &&
        execution.output !== undefined &&
        typeof execution.output === "object" &&
        execution.output !== null &&
        "version" in execution.output,
    )
    .map((execution) => execution.output as RunSnapshot["artifact"])
    .filter((artifact): artifact is NonNullable<RunSnapshot["artifact"]> => artifact !== null)
    .filter((artifact) => artifact.version < current.version)
    .sort((left, right) => right.version - left.version);
  return candidates[0] === undefined ? null : reviewArtifact(candidates[0], emptyOverrides);
}

function findingId(runId: string, index: number, code: string): string {
  return `${runId}:finding:${index}:${code}`;
}

function reviewFinding(
  snapshot: RunSnapshot,
  index: number,
  overrides: ReviewOverrides,
): ReviewFinding {
  const finding = snapshot.findings[index];
  if (finding === undefined) fail("operation-failed", "The run finding is missing.");
  const id = findingId(snapshot.runId, index, finding.code);
  return {
    id,
    code: finding.code,
    category: finding.category ?? "quality",
    severity: finding.severity,
    message: finding.message,
    decision: overrides.decisions[id] ?? "pending",
    agreement: "critic-only",
    ...(overrides.rationales[id] === undefined ? {} : { rationale: overrides.rationales[id] }),
    ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
    ...(finding.sectionId === undefined ? {} : { sectionId: finding.sectionId }),
  };
}

function reviewEvents(
  snapshot: RunSnapshot,
  overrides: ReviewOverrides,
  preflight: ProviderTransmissionPreflight,
): readonly ReviewEvent[] {
  const events: ReviewEvent[] = [
    {
      id: `${snapshot.runId}:created`,
      label: "Run created",
      state: "drafting",
      createdAt: snapshot.startedAt,
    },
  ];
  for (const execution of snapshot.executionHistory) {
    events.push({
      id: execution.id,
      label: `${execution.step} execution completed`,
      state:
        execution.step === "author"
          ? "drafting"
          : execution.step === "critic"
            ? "reviewing"
            : "revising",
      createdAt: execution.completedAt,
    });
  }
  for (const [index, decision] of overrides.history.entries()) {
    events.push({
      id: `${snapshot.runId}:decision:${index}:${decision.findingId}`,
      label: `Finding decision recorded: ${decision.decision}`,
      state: "awaiting-approval",
      createdAt: decision.createdAt,
    });
  }
  if (preflight.acknowledgedAt !== null) {
    events.push({
      id: `${snapshot.runId}:provider-transmission:${preflight.fingerprint}`,
      label: "Provider transmission policy acknowledged",
      state: "collecting",
      createdAt: preflight.acknowledgedAt,
    });
  }
  events.push({
    id: `${snapshot.runId}:updated:${snapshot.updatedAt}`,
    label: `Run ${snapshot.state.replaceAll("-", " ")}`,
    state: runState(snapshot),
    createdAt: snapshot.updatedAt,
  });
  return events;
}

function reviewState(
  descriptor: WorkspaceDescriptor,
  snapshot: RunSnapshot,
  overrides: ReviewOverrides,
  exportPath: string | null,
  setup: WorkspaceReadiness,
  preflight: ProviderTransmissionPreflight,
): DesktopReviewState {
  const artifact =
    snapshot.artifact === null
      ? {
          id: "artifact-unavailable",
          version: 0,
          createdAt: snapshot.updatedAt,
          sections: [],
          claims: [],
        }
      : reviewArtifact(snapshot.artifact, overrides);
  const evaluation = snapshot.latestEvaluation;
  return {
    workspaceId: descriptor.id,
    runId: snapshot.runId,
    state: runState(snapshot),
    round: snapshot.round,
    approval: snapshot.approval,
    totalCostUsd: snapshot.totalCostUsd,
    budgetUsd: descriptor.maxCostUsd ?? null,
    providerExposure: {
      author: descriptor.author,
      critic: descriptor.critic,
      transmissionAllowed: preflight.required && preflight.acknowledged,
      sensitiveData: true,
      requestedRetention: descriptor.fixtureMode ? "not-allowed" : "ephemeral-request",
    },
    providerTransmissionPreflight: preflight,
    providerFailure: providerFailure(snapshot),
    previousArtifact: previousArtifact(snapshot, artifact),
    artifact,
    findings: snapshot.findings.map((_finding, index) => reviewFinding(snapshot, index, overrides)),
    evaluation: {
      ready: evaluation?.ready ?? false,
      stopReason: evaluation?.stopReason ?? "continue",
      scores: evaluation?.scoreVector ?? {},
    },
    events: reviewEvents(snapshot, overrides, preflight),
    exportPath,
    setup,
  };
}

function emptyReviewState(
  descriptor: WorkspaceDescriptor,
  setup: WorkspaceReadiness,
  preflight: ProviderTransmissionPreflight,
): DesktopReviewState {
  return {
    workspaceId: descriptor.id,
    runId: "pending",
    state: "collecting",
    round: 0,
    approval: "pending",
    totalCostUsd: 0,
    budgetUsd: descriptor.maxCostUsd ?? null,
    providerExposure: {
      author: descriptor.author,
      critic: descriptor.critic,
      transmissionAllowed: preflight.required && preflight.acknowledged,
      sensitiveData: setup.evidenceSourceCount > 0,
      requestedRetention: descriptor.fixtureMode ? "not-allowed" : "ephemeral-request",
    },
    providerTransmissionPreflight: preflight,
    providerFailure: null,
    previousArtifact: null,
    artifact: {
      id: "artifact-pending",
      version: 0,
      createdAt: new Date().toISOString(),
      sections: [],
      claims: [],
    },
    findings: [],
    evaluation: {
      ready: setup.ready,
      stopReason: setup.ready ? "ready" : "collecting-inputs",
      scores: {},
    },
    events:
      preflight.acknowledgedAt === null
        ? []
        : [
            {
              id: `pending:provider-transmission:${preflight.fingerprint}`,
              label: "Provider transmission policy acknowledged",
              state: "collecting",
              createdAt: preflight.acknowledgedAt,
            },
          ],
    exportPath: null,
    setup,
  };
}

function defaultExportPath(root: string, runId: string): string {
  return join(root, "exports", `${runId}.md`);
}

async function existingExportPath(root: string, runId: string): Promise<string | null> {
  const path = defaultExportPath(root, runId);
  try {
    const details = await stat(path);
    return details.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function workspaceReadiness(
  descriptor: WorkspaceDescriptor,
  root: string,
): Promise<WorkspaceReadiness> {
  const jobPath = resolve(root, descriptor.jobDescriptionPath);
  let jobDescriptionReady = false;
  try {
    jobDescriptionReady = (await readFile(jobPath, "utf8")).trim().length > 0;
  } catch {
    jobDescriptionReady = false;
  }
  const evidenceSourceCount = await countEvidenceFiles(resolve(root, descriptor.sourceDirectory));
  const nextSteps: string[] = [];
  if (!jobDescriptionReady) nextSteps.push("Add a target job description.");
  if (evidenceSourceCount === 0) nextSteps.push("Add at least one candidate evidence source.");
  return {
    fixtureMode: descriptor.fixtureMode,
    jobDescriptionReady,
    evidenceSourceCount,
    ready: jobDescriptionReady && evidenceSourceCount > 0,
    nextSteps,
  };
}

async function readOverrides(root: string): Promise<ReviewOverrides> {
  try {
    const value: unknown = JSON.parse(await readFile(overridesPath(root), "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyOverrides;
    const record = value as Record<string, unknown>;
    const decisions = record.decisions;
    const rationales = record.rationales;
    const edits = record.edits;
    const history = record.history;
    const normalizedDecisions: Record<string, FindingDecision> = {};
    const normalizedRationales: Record<string, string> = {};
    const normalizedHistory: ReviewDecisionHistoryEntry[] = [];
    if (typeof decisions === "object" && decisions !== null && !Array.isArray(decisions)) {
      for (const [id, decision] of Object.entries(decisions)) {
        if (
          id.length <= 128 &&
          typeof decision === "string" &&
          ["pending", "accepted", "rejected", "deferred", "overridden"].includes(decision)
        ) {
          normalizedDecisions[id] = decision as FindingDecision;
        }
      }
    }
    if (typeof rationales === "object" && rationales !== null && !Array.isArray(rationales)) {
      for (const [id, rationale] of Object.entries(rationales)) {
        if (id.length <= 128 && typeof rationale === "string" && rationale.length <= 1_000) {
          normalizedRationales[id] = rationale;
        }
      }
    }
    const normalizedEdits: Record<string, string> = {};
    if (typeof edits === "object" && edits !== null && !Array.isArray(edits)) {
      for (const [id, text] of Object.entries(edits)) {
        if (id.length <= 128 && typeof text === "string" && text.length <= 20_000) {
          normalizedEdits[id] = text;
        }
      }
    }
    if (Array.isArray(history)) {
      for (const item of history.slice(-100)) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
        const entry = item as Record<string, unknown>;
        const findingId = entry.findingId;
        const decision = entry.decision;
        const createdAt = entry.createdAt;
        const rationale = entry.rationale;
        if (
          typeof findingId !== "string" ||
          findingId.length === 0 ||
          findingId.length > 128 ||
          typeof decision !== "string" ||
          !["pending", "accepted", "rejected", "deferred", "overridden"].includes(decision) ||
          typeof createdAt !== "string" ||
          createdAt.length > 64 ||
          (rationale !== undefined && (typeof rationale !== "string" || rationale.length > 1_000))
        ) {
          continue;
        }
        normalizedHistory.push({
          findingId,
          decision: decision as FindingDecision,
          createdAt,
          ...(rationale === undefined ? {} : { rationale }),
        });
      }
    }
    return {
      decisions: normalizedDecisions,
      rationales: normalizedRationales,
      edits: normalizedEdits,
      history: normalizedHistory,
    };
  } catch {
    return emptyOverrides;
  }
}

async function writeOverrides(root: string, overrides: ReviewOverrides): Promise<void> {
  await mkdir(dirname(overridesPath(root)), { recursive: true });
  await writeFile(overridesPath(root), `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
}

function workspaceResult(descriptor: WorkspaceDescriptor): {
  workspace: { id: string; name: string };
} {
  return { workspace: { id: descriptor.id, name: workspaceName(descriptor.root) } };
}

function statusResult(
  workspaceId: string,
  snapshot: RunSnapshot | undefined,
): {
  workspaceId: string;
  runId: string | null;
  state: DesktopReviewState["state"] | "collecting";
  round: number;
  approval: "pending" | "approved" | "rejected";
} {
  return snapshot === undefined
    ? { workspaceId, runId: null, state: "collecting", round: 0, approval: "pending" }
    : {
        workspaceId,
        runId: snapshot.runId,
        state: runState(snapshot),
        round: snapshot.round,
        approval: snapshot.approval,
      };
}

function safeFormat(value: ExportFormat): "markdown" | "pdf" | "docx" {
  return value;
}

export interface NativeHost {
  readonly capabilities: readonly BridgeCapability[];
  readonly invoke: (value: unknown) => Promise<BridgeResult<unknown>>;
}

export function createNativeHost(options: NativeHostOptions): NativeHost {
  const credentials = options.credentials ?? createMemoryCredentialStore();
  const requireProviderPreflight = options.requireProviderPreflight === true;
  const service =
    options.applicationService ??
    createApplicationService(
      createLocalApplicationDriver({
        resolveCredential: async (provider) => resolveCredential(credentials, provider),
      }),
    );
  let active: ActiveWorkspace | undefined;
  const backgroundRuns = new Map<string, Promise<void>>();

  function resumeInBackground(workspace: ActiveWorkspace, runId: string): void {
    const key = `${workspace.descriptor.id}:${runId}`;
    if (backgroundRuns.has(key)) return;
    const execution = Promise.resolve()
      .then(() => service.resume({ root: workspace.root, runId, allowProviderData: true }, io()))
      .then(() => undefined)
      .catch((error: unknown) => options.onError?.(error, "review.dispatch"))
      .finally(() => backgroundRuns.delete(key));
    backgroundRuns.set(key, execution);
  }

  function workspaceFor(id: string): ActiveWorkspace {
    if (active === undefined || active.descriptor.id !== id) {
      return fail("not-found", "The requested workspace is not open.");
    }
    return active;
  }

  async function refreshWorkspaceDescriptor(workspace: ActiveWorkspace): Promise<ActiveWorkspace> {
    const descriptor = await service.readWorkspace(workspace.root);
    if (
      descriptor.id !== workspace.descriptor.id ||
      resolve(descriptor.root) !== resolve(workspace.root)
    ) {
      return fail("operation-failed", "The open workspace configuration changed unexpectedly.");
    }
    const refreshed = { descriptor, root: workspace.root };
    active = refreshed;
    return refreshed;
  }

  async function loadSnapshot(workspace: ActiveWorkspace, runId?: string): Promise<RunSnapshot> {
    const snapshot = await service.status({
      root: workspace.root,
      ...(runId === undefined ? {} : { runId }),
    });
    if (snapshot === undefined)
      return fail("not-found", "No run has been started in this workspace.");
    return snapshot;
  }

  async function requireProviderTransmissionAcknowledgement(
    workspace: ActiveWorkspace,
  ): Promise<ProviderTransmissionPreflight> {
    const preflight = await providerTransmissionPreflight(
      workspace.descriptor,
      workspace.root,
      requireProviderPreflight,
    );
    if (preflight.required && !preflight.acknowledged) {
      return fail(
        "operation-failed",
        "Review and acknowledge the current provider transmission policy before this live action.",
      );
    }
    return preflight;
  }

  async function createWorkspace(
    name: string,
    mode: "real" | "demo" = "demo",
  ): Promise<{ workspace: { id: string; name: string } }> {
    const parent = await options.dialogs.chooseDirectory("create");
    if (parent === undefined) return fail("permission-denied", "Workspace creation was cancelled.");
    const root = resolve(parent, name);
    try {
      await mkdir(root);
      await mkdir(join(root, "evidence"));
      if (mode === "demo") {
        await writeFile(
          join(root, "job.md"),
          "TypeScript systems engineer\nLocal-first product development\n",
          "utf8",
        );
        await writeFile(
          join(root, "evidence", "resume.md"),
          "Synthetic offline evidence for the DraftLoop desktop smoke workflow.\n",
          "utf8",
        );
      } else {
        await writeFile(join(root, "job.md"), "", "utf8");
      }
      const descriptor = await service.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          fixtureMode: mode === "demo",
          maxRounds: 2,
        },
        io(),
      );
      active = { descriptor, root };
      return workspaceResult(descriptor);
    } catch (error) {
      return fail(
        "operation-failed",
        error instanceof Error ? error.message : "Workspace creation failed.",
      );
    }
  }

  async function openWorkspace(): Promise<{ workspace: { id: string; name: string } }> {
    const root = await options.dialogs.chooseDirectory("open");
    if (root === undefined) return fail("permission-denied", "Workspace opening was cancelled.");
    const descriptor = await service.readWorkspace(resolve(root));
    active = { descriptor, root: resolve(root) };
    return workspaceResult(descriptor);
  }

  async function selectFiles(input: FileSelectInput): Promise<FileSelectResult> {
    const workspace = workspaceFor(input.workspaceId);
    const targetKind = input.target ?? "evidence";
    const selected = await options.dialogs.chooseFiles(input);
    const files: SelectedFile[] = [];
    for (const sourcePath of selected.slice(0, input.multiple === false ? 1 : 100)) {
      const details = await stat(sourcePath);
      if (!details.isFile() || details.size > maxImportedFileBytes) {
        return fail("operation-failed", "The selected file is too large or unavailable.");
      }
      const extension = extname(sourcePath).toLowerCase() as SupportedFileExtension;
      if (input.extensions !== undefined && !input.extensions.includes(extension)) {
        return fail("operation-failed", "The selected file type is not allowed for this import.");
      }
      if (
        !extensionForMediaType(extension).startsWith("text/") &&
        ![".pdf", ".docx"].includes(extension)
      ) {
        return fail("operation-failed", "The selected file type is not supported.");
      }

      if (targetKind === "job-description") {
        const targetRelative = "job.md";
        const target = resolve(workspace.root, targetRelative);
        rootRelative(workspace.root, target);
        await mkdir(dirname(target), { recursive: true });

        if (
          extension === ".md" ||
          extension === ".markdown" ||
          extension === ".txt" ||
          extension === ".text"
        ) {
          const content = await readFile(sourcePath, "utf8");
          await writeFile(target, content, "utf8");
        } else {
          const ingested = await ingestFile({
            path: sourcePath,
            mediaType: extensionForMediaType(extension),
          });
          if (
            ingested.source === null ||
            ingested.source.chunks.length === 0 ||
            ingested.issues.length > 0
          ) {
            return fail(
              "operation-failed",
              ingested.issues[0]?.message ?? "The job description contains no extractable text.",
            );
          }
          const textContent = ingested.source.chunks
            .map((chunk: SourceChunk) => chunk.text)
            .join("\n\n");
          await writeFile(target, `${textContent}\n`, "utf8");
        }

        const targetDetails = await stat(target);
        files.push({
          id: createHash("sha256")
            .update(`${targetRelative}:${targetDetails.size}`)
            .digest("hex")
            .slice(0, 24),
          name: "job.md",
          relativePath: targetRelative,
          mediaType: "text/markdown",
          byteLength: targetDetails.size,
        });
      } else {
        const candidateRelative = relative(resolve(workspace.root), resolve(sourcePath)).replaceAll(
          "\\",
          "/",
        );
        const isInsideWorkspace =
          candidateRelative === "" ||
          (!candidateRelative.startsWith("..") && !isAbsolute(candidateRelative));
        const targetRelative =
          isInsideWorkspace && candidateRelative.startsWith("evidence/")
            ? candidateRelative
            : `evidence/imported/${basename(sourcePath)}`;
        const target = resolve(workspace.root, targetRelative);
        rootRelative(workspace.root, target);
        await mkdir(dirname(target), { recursive: true });
        if (resolve(sourcePath) !== target) await copyFile(sourcePath, target);
        files.push({
          id: createHash("sha256")
            .update(`${targetRelative}:${details.size}`)
            .digest("hex")
            .slice(0, 24),
          name: basename(target),
          relativePath: targetRelative,
          mediaType: extensionForMediaType(extension),
          byteLength: details.size,
        });
      }
    }
    return { files };
  }

  async function saveSourceProvenance(
    root: string,
    entry: Readonly<Record<string, string>>,
  ): Promise<void> {
    let entries: Record<string, string>[] = [];
    try {
      const parsed: unknown = JSON.parse(await readFile(sourceProvenancePath(root), "utf8"));
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (item): item is Record<string, string> =>
            typeof item === "object" && item !== null && !Array.isArray(item),
        );
      }
    } catch {
      entries = [];
    }
    const withoutDuplicate = entries.filter(
      (item) => !(item.originalUrl === entry.originalUrl && item.role === entry.role),
    );
    withoutDuplicate.push({ ...entry });
    await mkdir(dirname(sourceProvenancePath(root)), { recursive: true });
    await writeFile(
      sourceProvenancePath(root),
      `${JSON.stringify(withoutDuplicate, null, 2)}\n`,
      "utf8",
    );
  }

  async function addUrl(input: SourceAddUrlInput): Promise<SourceAddUrlResult> {
    const workspace = workspaceFor(input.workspaceId);
    const result = await ingestUrl(input.url, {
      approved: input.approved,
      ...(options.urlFetcher === undefined ? {} : { fetcher: options.urlFetcher }),
      ...(options.urlHostnameResolver === undefined
        ? {}
        : { resolveHostname: options.urlHostnameResolver }),
    });
    const source = result.source;
    if (source === null || source.url === undefined || result.issues.length > 0) {
      return fail(
        "operation-failed",
        result.issues[0]?.message ?? "The URL did not contain usable text.",
      );
    }
    const targetRelative =
      input.target === "job-description"
        ? "job.md"
        : join("evidence", "imported", `url-${source.checksum.slice(0, 16)}.md`);
    const target = resolve(workspace.root, targetRelative);
    rootRelative(workspace.root, target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${source.text}\n`, "utf8");
    await saveSourceProvenance(workspace.root, {
      role: input.target,
      originalUrl: source.url.originalUrl,
      finalUrl: source.url.finalUrl,
      fetchedAt: source.url.fetchedAt,
      kind: source.url.kind,
      extractionStatus: source.urlExtraction?.status ?? "generic-fallback",
      extractedFactCount: String(source.urlExtraction?.facts.length ?? 0),
      checksum: source.checksum,
      relativePath: targetRelative,
    });
    return {
      sourcePath: targetRelative,
      originalUrl: source.url.originalUrl,
      finalUrl: source.url.finalUrl,
      kind: source.url.kind,
      extractionStatus: source.urlExtraction?.status ?? "generic-fallback",
      mediaType: source.mediaType,
    };
  }

  async function dispatchReview(input: ReviewDispatchInput): Promise<DesktopReviewState> {
    const workspace = await refreshWorkspaceDescriptor(workspaceFor(input.workspaceId));
    const currentSnapshot =
      input.action.type === "acknowledge-provider-transmission"
        ? undefined
        : input.action.type === "start"
          ? await service.status({ root: workspace.root })
          : await loadSnapshot(workspace, input.runId);
    let overrides = await readOverrides(workspace.root);
    let exportPath: string | null = null;
    let dispatchedSnapshot: RunSnapshot | undefined;
    const action: ReviewAction = input.action;
    if (
      currentSnapshot?.state === "provider-error" &&
      !["resume", "recover-to-review", "stop"].includes(action.type)
    ) {
      return fail("operation-failed", "This action is not available after a provider failure.");
    }
    switch (action.type) {
      case "acknowledge-provider-transmission": {
        const current = await providerTransmissionPreflight(
          workspace.descriptor,
          workspace.root,
          requireProviderPreflight,
        );
        if (!current.required) break;
        if (action.fingerprint !== current.fingerprint) {
          return fail(
            "operation-failed",
            "The provider transmission policy changed. Review the current policy before acknowledging it.",
          );
        }
        await writeProviderTransmissionAcknowledgement(
          workspace.root,
          providerTransmissionPolicy(workspace.descriptor),
          current.fingerprint,
        );
        break;
      }
      case "start": {
        await requireProviderTransmissionAcknowledgement(workspace);
        dispatchedSnapshot = await service.begin(
          { root: workspace.root, allowProviderData: true },
          io(),
        );
        resumeInBackground(workspace, dispatchedSnapshot.runId);
        break;
      }
      case "finding-decision":
        await service.recordReviewDecision({
          root: workspace.root,
          runId: input.runId,
          kind: "finding",
          targetId: action.findingId,
          decision: action.decision,
          ...(action.rationale === undefined ? {} : { rationale: action.rationale }),
        });
        overrides = {
          ...overrides,
          decisions: { ...overrides.decisions, [action.findingId]: action.decision },
          history: [
            ...overrides.history,
            {
              findingId: action.findingId,
              decision: action.decision,
              createdAt: new Date().toISOString(),
              ...(action.rationale === undefined ? {} : { rationale: action.rationale }),
            },
          ].slice(-100),
          ...(action.rationale === undefined
            ? {}
            : { rationales: { ...overrides.rationales, [action.findingId]: action.rationale } }),
        };
        await writeOverrides(workspace.root, overrides);
        break;
      case "edit-block":
        await service.recordReviewDecision({
          root: workspace.root,
          runId: input.runId,
          kind: "edit",
          targetId: action.blockId,
          replacementText: action.text,
        });
        overrides = { ...overrides, edits: { ...overrides.edits, [action.blockId]: action.text } };
        await writeOverrides(workspace.root, overrides);
        break;
      case "pause":
      case "request-revision":
      case "approve":
      case "stop":
      case "recover-to-review":
        if (
          currentSnapshot?.state === "provider-error" &&
          action.type !== "stop" &&
          action.type !== "recover-to-review"
        ) {
          return fail("operation-failed", "This action is not available after a provider failure.");
        }
        if (
          (action.type === "stop" || action.type === "recover-to-review") &&
          currentSnapshot?.state !== "provider-error"
        ) {
          return fail("operation-failed", "This provider recovery action is not available.");
        }
        if (action.type === "request-revision") {
          await requireProviderTransmissionAcknowledgement(workspace);
        }
        await service.lifecycle(
          {
            root: workspace.root,
            runId: input.runId,
            action:
              action.type === "request-revision"
                ? "revision"
                : action.type === "recover-to-review"
                  ? "recover-review"
                  : action.type,
          },
          io(),
        );
        break;
      case "resume":
        if (
          currentSnapshot?.state === "provider-error" &&
          (currentSnapshot.lastError?.retryable !== true ||
            currentSnapshot.lastError.attempt >= currentSnapshot.lastError.maxAttempts)
        ) {
          return fail("operation-failed", "This provider failure cannot be retried.");
        }
        await requireProviderTransmissionAcknowledgement(workspace);
        await service.resume(
          { root: workspace.root, runId: input.runId, allowProviderData: true },
          io(),
        );
        break;
      case "export":
        exportPath = await service.export(
          { root: workspace.root, runId: input.runId, format: "markdown" },
          io(),
        );
        break;
    }
    const snapshot =
      dispatchedSnapshot ??
      (await service.status({
        root: workspace.root,
        ...(input.action.type === "start" || input.runId === "pending"
          ? {}
          : { runId: input.runId }),
      }));
    const setup = await workspaceReadiness(workspace.descriptor, workspace.root);
    const preflight = await providerTransmissionPreflight(
      workspace.descriptor,
      workspace.root,
      requireProviderPreflight,
    );
    if (snapshot === undefined) return emptyReviewState(workspace.descriptor, setup, preflight);
    return reviewState(
      workspace.descriptor,
      snapshot,
      overrides,
      exportPath ?? (await existingExportPath(workspace.root, snapshot.runId)),
      setup,
      preflight,
    );
  }

  async function invoke(value: unknown): Promise<BridgeResult<unknown>> {
    let command: BridgeCommand;
    try {
      command = validateBridgeCommand(value);
    } catch (error) {
      return { ok: false, error: safeBridgeError(error) };
    }
    try {
      switch (command.type) {
        case "workspace.open":
          return { ok: true, value: await openWorkspace() };
        case "workspace.create":
          return {
            ok: true,
            value: await createWorkspace(command.input.name, command.input.mode ?? "demo"),
          };
        case "run.status": {
          const workspace = workspaceFor(command.input.workspaceId);
          return {
            ok: true,
            value: statusResult(
              workspace.descriptor.id,
              await service.status({
                root: workspace.root,
                ...(command.input.runId === undefined ? {} : { runId: command.input.runId }),
              }),
            ),
          };
        }
        case "run.start": {
          const workspace = workspaceFor(command.input.workspaceId);
          const snapshot = await service.start(
            { root: workspace.root, allowProviderData: false },
            io(),
          );
          return { ok: true, value: statusResult(workspace.descriptor.id, snapshot) };
        }
        case "run.pause":
        case "run.stop": {
          const workspace = workspaceFor(command.input.workspaceId);
          const snapshot = await service.lifecycle(
            {
              root: workspace.root,
              runId: command.input.runId,
              action: command.type.slice("run.".length) as "pause" | "stop",
            },
            io(),
          );
          return { ok: true, value: statusResult(workspace.descriptor.id, snapshot) };
        }
        case "run.resume": {
          const workspace = workspaceFor(command.input.workspaceId);
          const snapshot = await service.resume(
            { root: workspace.root, runId: command.input.runId, allowProviderData: false },
            io(),
          );
          return { ok: true, value: statusResult(workspace.descriptor.id, snapshot) };
        }
        case "review.load": {
          const selectedWorkspace =
            command.input.workspaceId === undefined
              ? active
              : workspaceFor(command.input.workspaceId);
          if (selectedWorkspace === undefined) return fail("not-found", "Open a workspace first.");
          const workspace = await refreshWorkspaceDescriptor(selectedWorkspace);
          const snapshot = await service.status({
            root: workspace.root,
            ...(command.input.runId === undefined ? {} : { runId: command.input.runId }),
          });
          const setup = await workspaceReadiness(workspace.descriptor, workspace.root);
          if (snapshot === undefined) {
            const preflight = await providerTransmissionPreflight(
              workspace.descriptor,
              workspace.root,
              requireProviderPreflight,
            );
            return {
              ok: true,
              value: emptyReviewState(workspace.descriptor, setup, preflight),
            };
          }
          const preflight = await providerTransmissionPreflight(
            workspace.descriptor,
            workspace.root,
            requireProviderPreflight,
          );
          return {
            ok: true,
            value: reviewState(
              workspace.descriptor,
              snapshot,
              await readOverrides(workspace.root),
              await existingExportPath(workspace.root, snapshot.runId),
              setup,
              preflight,
            ),
          };
        }
        case "review.dispatch":
          return { ok: true, value: await dispatchReview(command.input) };
        case "file.select":
          return { ok: true, value: await selectFiles(command.input) };
        case "source.add-url":
          return { ok: true, value: await addUrl(command.input) };
        case "export.write": {
          const workspace = workspaceFor(command.input.workspaceId);
          const written = await service.export(
            {
              root: workspace.root,
              runId: command.input.runId,
              format: safeFormat(command.input.format),
              ...(command.input.relativePath === undefined
                ? {}
                : { outputPath: resolve(workspace.root, command.input.relativePath) }),
            },
            io(),
          );
          return {
            ok: true,
            value: {
              exportId: `export-${randomUUID()}`,
              workspaceId: workspace.descriptor.id,
              runId: command.input.runId,
              format: command.input.format,
              relativePath: rootRelative(workspace.root, written),
            },
          };
        }
        case "credential.status": {
          const status = await credentials.status(command.input.provider);
          return {
            ok: true,
            value: {
              provider: command.input.provider,
              configured: status.configured,
              source: status.source,
              protection: status.protection,
            },
          };
        }
        case "credential.set": {
          const configured = await credentials.set(command.input.provider, command.input.apiKey);
          if (!configured) {
            return fail(
              "operation-failed",
              `Failed to save API key for ${command.input.provider}.`,
            );
          }
          const status = await credentials.status(command.input.provider);
          return {
            ok: true,
            value: {
              provider: command.input.provider,
              configured: status.configured,
              source: status.source,
              protection: status.protection,
            },
          };
        }
        case "credential.remove": {
          await credentials.remove(command.input.provider);
          const status = await credentials.status(command.input.provider);
          return {
            ok: true,
            value: {
              provider: command.input.provider,
              configured: status.configured,
              source: status.source,
              protection: status.protection,
            },
          };
        }
      }
    } catch (error) {
      options.onError?.(error, command.type);
      return { ok: false, error: safeBridgeError(error, command.type) };
    }
  }

  return Object.freeze({ capabilities: Object.freeze([...bridgeCapabilities]), invoke });
}

export function createMemoryCredentialStore(): NativeCredentialStore {
  const store = new Map<CredentialProvider, string>();
  return {
    status: async (provider) => {
      if (store.has(provider)) {
        return { configured: true, source: "app", protection: "session-memory" };
      }
      const envKey =
        provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
      if (envKey !== undefined && envKey.trim().length > 0) {
        return { configured: true, source: "env", protection: "environment" };
      }
      return { configured: false, source: "none", protection: "none" };
    },
    set: async (provider, apiKey) => {
      if (apiKey !== undefined && apiKey.trim().length > 0) {
        store.set(provider, apiKey.trim());
        return true;
      }
      return false;
    },
    remove: async (provider) => {
      return store.delete(provider);
    },
    get: async (provider) => {
      return store.get(provider);
    },
  };
}

export interface SafeStorageAdapter {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
  readonly getSelectedStorageBackend?: () => string;
}

export async function resolveCredential(
  store: NativeCredentialStore,
  provider: CredentialProvider,
): Promise<string | undefined> {
  const managed = (await store.get?.(provider))?.trim();
  if (managed !== undefined && managed.length > 0) return managed;
  const environment =
    provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  const normalized = environment?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

async function getOrCreateLocalKey(keyPath: string): Promise<Buffer> {
  try {
    const data = await readFile(keyPath);
    if (data.length === 32) return data;
  } catch {
    // Key file not found or inaccessible
  }
  const key = randomBytes(32);
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, key, { mode: 0o600 });
  return key;
}

function encryptAesGcm(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:aes-gcm:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptAesGcm(encoded: string, key: Buffer): string | undefined {
  const parts = encoded.split(":");
  const [v, algo, ivHex, authTagHex, cipherHex] = parts;
  if (
    parts.length !== 5 ||
    v !== "v1" ||
    algo !== "aes-gcm" ||
    ivHex === undefined ||
    authTagHex === undefined ||
    cipherHex === undefined
  ) {
    return undefined;
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");
  if (iv.length !== 12 || authTag.length !== 16) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Uses Electron's OS-backed safeStorage encryption for provider credentials when available,
 * and transparently falls back to local AES-256-GCM encryption with machine/user file permissions.
 */
export function createSafeStorageCredentialStore(options: {
  readonly safeStorage: SafeStorageAdapter;
  readonly filename: string;
  readonly readSecret?: (provider: CredentialProvider) => Promise<string | undefined>;
}): NativeCredentialStore {
  const keyFilename = `${options.filename}.key`;

  const load = async (): Promise<Readonly<Record<string, string>>> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(options.filename, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const record = parsed as Record<string, unknown>;
      return Object.fromEntries(
        credentialProviders.flatMap((provider) => {
          const value = record[provider];
          return typeof value === "string" && value.length > 0 ? [[provider, value]] : [];
        }),
      );
    } catch {
      return {};
    }
  };

  const save = async (values: Readonly<Record<string, string>>): Promise<void> => {
    await mkdir(dirname(options.filename), { recursive: true });
    await writeFile(options.filename, `${JSON.stringify(values, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  };

  const get = async (provider: CredentialProvider): Promise<string | undefined> => {
    const values = await load();
    const stored = values[provider];
    if (stored === undefined || stored.length === 0) return undefined;

    if (stored.startsWith("v1:aes-gcm:")) {
      try {
        const key = await getOrCreateLocalKey(keyFilename);
        return decryptAesGcm(stored, key);
      } catch {
        return undefined;
      }
    }

    try {
      if (options.safeStorage.isEncryptionAvailable()) {
        const payload = stored.startsWith("v1:safeStorage:")
          ? stored.slice("v1:safeStorage:".length)
          : stored;
        return options.safeStorage.decryptString(Buffer.from(payload, "base64"));
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  return {
    status: async (provider) => {
      const values = await load();
      const stored = await get(provider);
      if (stored !== undefined && stored.length > 0) {
        const encoded = values[provider] ?? "";
        let backend: string | undefined;
        try {
          backend = options.safeStorage.getSelectedStorageBackend?.();
        } catch {
          backend = undefined;
        }
        const protection: CredentialProtection = encoded.startsWith("v1:aes-gcm:")
          ? "local-aes-gcm"
          : backend === "basic_text"
            ? "basic-text"
            : "os-backed";
        return { configured: true, source: "app", protection };
      }
      const envKey =
        provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
      if (envKey !== undefined && envKey.trim().length > 0) {
        return { configured: true, source: "env", protection: "environment" };
      }
      return { configured: false, source: "none", protection: "none" };
    },
    set: async (provider, apiKey) => {
      const secret =
        apiKey !== undefined && apiKey.trim().length > 0
          ? apiKey.trim()
          : await options.readSecret?.(provider);
      if (secret === undefined || secret.length === 0) return false;

      let encoded: string | undefined;

      try {
        if (options.safeStorage.isEncryptionAvailable()) {
          const encrypted = options.safeStorage.encryptString(secret);
          encoded = `v1:safeStorage:${Buffer.from(encrypted).toString("base64")}`;
        }
      } catch {
        encoded = undefined;
      }

      if (encoded === undefined) {
        try {
          const key = await getOrCreateLocalKey(keyFilename);
          encoded = encryptAesGcm(secret, key);
        } catch {
          return false;
        }
      }

      const values = await load();
      await save({ ...values, [provider]: encoded });
      return true;
    },
    remove: async (provider) => {
      const values = await load();
      if (values[provider] === undefined) return false;
      const next = { ...values };
      delete next[provider];
      if (Object.keys(next).length === 0) {
        await rm(options.filename, { force: true });
        await rm(keyFilename, { force: true });
      } else {
        await save(next);
      }
      return true;
    },
    get,
  };
}
