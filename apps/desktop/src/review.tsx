import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CredentialStatus } from "./bridge.js";
import {
  type DesktopReviewState,
  type FindingDecision,
  type ReviewAction,
  type ReviewFinding,
  reviewFindingSummary,
} from "./model.js";
import type { PendingReviewAction } from "./review-dispatch.js";

interface ReviewWorkspaceProps {
  readonly state: DesktopReviewState;
  readonly onAction: (action: ReviewAction) => void;
  readonly pendingReviewAction?: PendingReviewAction | null;
  readonly onSelectFiles?: (target: "evidence" | "job-description") => void;
  readonly onAddUrl?: (target: "evidence" | "job-description", url: string) => void;
  readonly errorMessage?: string | null;
  readonly getCredentialStatus?: (provider: "anthropic" | "openai") => Promise<CredentialStatus>;
  readonly onSetCredential?: (provider: "anthropic" | "openai", apiKey: string) => Promise<void>;
  readonly onRemoveCredential?: (provider: "anthropic" | "openai") => Promise<void>;
}

const decisionLabels: Readonly<Record<FindingDecision, string>> = {
  pending: "Pending",
  accepted: "Accept",
  rejected: "Reject",
  deferred: "Defer",
  overridden: "Override",
};

export type FindingQueueFilter = "needs-action" | "blocking" | "warnings" | "resolved";

export interface FindingQueueCounts {
  readonly needsAction: number;
  readonly blocking: number;
  readonly warnings: number;
  readonly resolved: number;
}

export interface InitialFindingQueueState {
  readonly filter: FindingQueueFilter;
  readonly expandedFindingId: string | null;
}

export function canExportReview(
  state: Pick<DesktopReviewState, "state" | "reviewComplete">,
  pendingReviewAction: PendingReviewAction | null,
): boolean {
  return state.state === "approved" && state.reviewComplete && pendingReviewAction === null;
}

const findingQueueFilters: ReadonlyArray<{
  readonly id: FindingQueueFilter;
  readonly label: string;
}> = [
  { id: "needs-action", label: "Needs action" },
  { id: "blocking", label: "Blocking" },
  { id: "warnings", label: "Warnings" },
  { id: "resolved", label: "Resolved" },
];

const directFindingDecisions: readonly Exclude<FindingDecision, "pending" | "overridden">[] = [
  "accepted",
  "rejected",
  "deferred",
];

function isUnresolvedFinding(finding: ReviewFinding): boolean {
  return finding.decision === "pending" || finding.decision === "deferred";
}

export function findingQueueCounts(findings: readonly ReviewFinding[]): FindingQueueCounts {
  let needsAction = 0;
  let blocking = 0;
  let warnings = 0;
  let resolved = 0;

  for (const finding of findings) {
    if (!isUnresolvedFinding(finding)) {
      resolved += 1;
    } else if (finding.severity === "error") {
      needsAction += 1;
      blocking += 1;
    } else {
      needsAction += 1;
      warnings += 1;
    }
  }

  return { needsAction, blocking, warnings, resolved };
}

export function defaultFindingQueueFilter(findings: readonly ReviewFinding[]): FindingQueueFilter {
  return findingQueueCounts(findings).needsAction > 0 ? "needs-action" : "resolved";
}

export function filterFindingQueue(
  findings: readonly ReviewFinding[],
  filter: FindingQueueFilter,
): readonly ReviewFinding[] {
  switch (filter) {
    case "needs-action":
      return findings.filter(isUnresolvedFinding);
    case "blocking":
      return findings.filter(
        (finding) => isUnresolvedFinding(finding) && finding.severity === "error",
      );
    case "warnings":
      return findings.filter(
        (finding) => isUnresolvedFinding(finding) && finding.severity === "warning",
      );
    case "resolved":
      return findings.filter((finding) => !isUnresolvedFinding(finding));
  }
}

export function findingQueueFilterCount(
  counts: FindingQueueCounts,
  filter: FindingQueueFilter,
): number {
  switch (filter) {
    case "needs-action":
      return counts.needsAction;
    case "blocking":
      return counts.blocking;
    case "warnings":
      return counts.warnings;
    case "resolved":
      return counts.resolved;
  }
}

export function initialFindingQueueState(
  findings: readonly ReviewFinding[],
): InitialFindingQueueState {
  const filter = defaultFindingQueueFilter(findings);
  return {
    filter,
    expandedFindingId:
      filter === "needs-action" ? (filterFindingQueue(findings, filter)[0]?.id ?? null) : null,
  };
}

export function nextActionableFindingId(
  findings: readonly ReviewFinding[],
  currentFindingId: string,
): string | null {
  const actionable = findings.filter(isUnresolvedFinding);
  if (actionable.length === 0) return null;

  const currentIndex = findings.findIndex((finding) => finding.id === currentFindingId);
  const following = actionable.filter(
    (finding) =>
      finding.id !== currentFindingId &&
      (currentIndex < 0 ||
        findings.findIndex((candidate) => candidate.id === finding.id) > currentIndex),
  );
  return (
    following[0]?.id ??
    actionable.find((finding) => finding.id !== currentFindingId)?.id ??
    currentFindingId
  );
}

export function findingQueueEmptyMessage(
  filter: FindingQueueFilter,
  counts: FindingQueueCounts,
): string {
  if (filter === "needs-action" && counts.needsAction === 0) {
    return counts.resolved > 0 ? "All findings are decided." : "No findings need action yet.";
  }
  if (filter === "blocking" && counts.blocking === 0) return "No blocking findings need action.";
  if (filter === "warnings" && counts.warnings === 0) return "No warnings need action.";
  if (filter === "resolved" && counts.resolved === 0) return "No findings have been resolved yet.";
  return "No findings match this filter.";
}

export function isOverrideEditorVisible(
  editingFindingId: string | null,
  findingId: string,
): boolean {
  return editingFindingId === findingId;
}

function findingDomId(prefix: string, findingId: string): string {
  return `${prefix}-${findingId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}

function stateLabel(value: DesktopReviewState["state"]): string {
  return value.replaceAll("-", " ");
}

const loopSteps = ["Draft", "Critique", "Revise", "Approve"] as const;

/** Where the run currently sits on the author–critic loop, for the rail readout. */
export function loopStageIndex(state: DesktopReviewState): number {
  switch (state.state) {
    case "collecting":
      return -1;
    case "drafting":
      return 0;
    case "reviewing":
      return 1;
    case "revising":
      return 2;
    case "awaiting-approval":
      return 3;
    case "approved":
    case "exported":
      return loopSteps.length;
    default:
      if (state.execution.step === "author") return 0;
      if (state.execution.step === "critic") return 1;
      if (state.execution.step === "revision") return 2;
      return state.reviewComplete ? 3 : 1;
  }
}

/** DraftLoop mark: the author–critic loop, drawn as a returning spiral. */
export function BrandMark({ className = "rail-mark" }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M21 12a9 9 0 1 1-3.6-7.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.6 12a4.4 4.4 0 1 0 4.4-4.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 1 0-5.1-5.1l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 1 0 5.1 5.1l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M11.4 12H20M17.5 12v2.6M14.5 12v1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M8.5 6.5 17 12l-8.5 5.5V6.5Z" fill="currentColor" />
    </svg>
  );
}

function SideRail({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  return (
    <nav className="side-rail" aria-label="Workspace sections">
      <BrandMark />
      <a className="rail-button" href="#artifact-review" title="Go to the draft">
        <span className="sr-only">Go to the draft</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <rect
            x="4.5"
            y="3"
            width="15"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M8.5 8h7M8.5 12h7M8.5 16h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </a>
      <a className="rail-button" href="#finding-queue-list" title="Go to the findings queue">
        <span className="sr-only">Go to the findings queue</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path
            d="M4 6h16M4 12h16M4 18h10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </a>
      <span className="rail-spacer" />
      <button
        className="rail-button"
        type="button"
        title="Provider API keys"
        aria-label="Provider API keys"
        onClick={onOpenSettings}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M11.6 12H21M18 12v3M15 12v2.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </nav>
  );
}

function LoopRail({
  activeIndex,
  round,
}: {
  readonly activeIndex: number;
  readonly round: number;
}) {
  return (
    <div className="loop-rail">
      <ol className="loop-steps" aria-label="Author–critic loop stage">
        {loopSteps.map((label, index) => (
          <li
            className={`loop-step${index < activeIndex ? " loop-step-done" : ""}${
              index === activeIndex ? " loop-step-active" : ""
            }`}
            key={label}
            {...(index === activeIndex ? { "aria-current": "step" as const } : {})}
          >
            <span className="loop-node" aria-hidden="true">
              {index < activeIndex ? "✓" : ""}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <svg
        className="loop-arc"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M97 1C97 11 3 11 3 1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="loop-round">↺ round {round}</span>
    </div>
  );
}

function retryWaitMs(retryNotBefore: string | null, nowMs: number): number {
  if (retryNotBefore === null) return 0;
  const retryAt = Date.parse(retryNotBefore);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : 0;
}

function retryWaitLabel(waitMs: number): string {
  const seconds = Math.max(1, Math.ceil(waitMs / 1_000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

const credentialSourceLabels: Readonly<Record<CredentialStatus["source"], string>> = {
  app: "Configured in app",
  env: "Configured via env",
  none: "Not configured",
};

const credentialProtectionLabels: Readonly<Record<CredentialStatus["protection"], string>> = {
  "os-backed": "OS-backed encryption",
  "basic-text": "Linux basic_text (weak protection)",
  "local-aes-gcm": "Local AES fallback (key stored beside app data)",
  environment: "Environment variable",
  "session-memory": "Session memory only",
  none: "No credential",
};

interface CredentialRowProps {
  readonly title: string;
  readonly placeholder: string;
  readonly status: CredentialStatus;
  readonly value: string;
  readonly revealed: boolean;
  readonly onReveal: (next: boolean) => void;
  readonly onChange: (next: string) => void;
  readonly onSave: () => void;
  readonly onRemove: () => void;
}

function CredentialRow({
  title,
  placeholder,
  status,
  value,
  revealed,
  onReveal,
  onChange,
  onSave,
  onRemove,
}: CredentialRowProps) {
  return (
    <section className="credential-row" aria-label={title}>
      <div className="credential-row-header">
        <strong>{title}</strong>
        <span className={`status-badge status-${status.source}`}>
          {credentialSourceLabels[status.source]}
        </span>
        <span className="credential-protection">
          {credentialProtectionLabels[status.protection]}
        </span>
      </div>
      <div className="credential-input-group">
        <input
          className="url-input"
          type={revealed ? "text" : "password"}
          placeholder={status.configured ? "••••••••••••••••••••••••" : placeholder}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          aria-label={title}
        />
        <button
          className="button button-quiet"
          type="button"
          aria-pressed={revealed}
          onClick={() => onReveal(!revealed)}
        >
          {revealed ? "Hide" : "Show"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={value.trim() === ""}
          onClick={onSave}
        >
          Save
        </button>
        {status.source === "app" ? (
          <button className="button button-danger" type="button" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
    </section>
  );
}

function claimSectionTitle(
  artifact: DesktopReviewState["artifact"],
  claimId: string,
): string | null {
  for (const section of artifact.sections) {
    if (section.blocks.some((block) => block.claimIds.includes(claimId))) return section.title;
  }
  return null;
}

function claimBlockId(artifact: DesktopReviewState["artifact"], claimId: string): string | null {
  for (const section of artifact.sections) {
    for (const block of section.blocks) {
      if (block.claimIds.includes(claimId)) return block.id;
    }
  }
  return null;
}

/** A draft line is "sourced" only when every claim it asserts links to candidate material. */
function blockSourceState(
  block: DesktopReviewState["artifact"]["sections"][number]["blocks"][number],
  claimById: ReadonlyMap<string, DesktopReviewState["artifact"]["claims"][number]>,
): "none" | "sourced" | "unsourced" {
  if (block.claimIds.length === 0) return "none";
  return block.claimIds
    .map((id) => claimById.get(id))
    .every(
      (claim) => claim !== undefined && claim.status !== "disputed" && claim.evidence.length > 0,
    )
    ? "sourced"
    : "unsourced";
}

function claimSourceLabel(claim: DesktopReviewState["artifact"]["claims"][number]): string {
  if (claim.status === "disputed") return "source conflict";
  return claim.evidence.length > 0 ? "source linked" : "not linked to candidate materials";
}

export function ReviewWorkspace({
  state,
  onAction,
  pendingReviewAction = null,
  onSelectFiles,
  onAddUrl,
  errorMessage,
  getCredentialStatus,
  onSetCredential,
  onRemoveCredential,
}: ReviewWorkspaceProps) {
  const findingSummary = reviewFindingSummary(state);
  const { blocking: blockingFindings, warnings } = findingSummary;
  const hasArtifact = state.artifact.version > 0;
  const claimById = useMemo(
    () => new Map(state.artifact.claims.map((claim) => [claim.id, claim])),
    [state.artifact.claims],
  );
  const canApprove =
    hasArtifact &&
    state.state === "awaiting-approval" &&
    state.reviewComplete &&
    blockingFindings.length === 0;
  const canExport = canExportReview(state, pendingReviewAction);
  const exportPending = pendingReviewAction?.action === "export";
  const approvalExportErrorVisible =
    errorMessage !== undefined && errorMessage !== null && state.state !== "collecting";
  const approvalLabel =
    state.approval === "approved"
      ? !state.reviewComplete
        ? "Approval recorded; independent critique incomplete"
        : findingSummary.status === "clear"
          ? "Artifact approved"
          : findingSummary.status === "blocked"
            ? `Approved with ${blockingFindings.length} unresolved blocker${blockingFindings.length === 1 ? "" : "s"}`
            : `Approved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Approval pending";
  const validationLabel = !hasArtifact
    ? "No draft artifact available"
    : !state.reviewComplete
      ? "Independent critique did not complete"
      : state.state === "provider-error"
        ? "Provider recovery remains before approval"
        : findingSummary.status === "blocked"
          ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"}`
          : findingSummary.status === "warnings"
            ? `${warnings.length} unresolved warning${warnings.length === 1 ? "" : "s"}`
            : "No unresolved findings";
  const [jobUrl, setJobUrl] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [overrideReasons, setOverrideReasons] = useState<Readonly<Record<string, string>>>({});
  const initialQueueState = useMemo(
    () => initialFindingQueueState(state.findings),
    [state.findings],
  );
  const [findingFilter, setFindingFilter] = useState<FindingQueueFilter>(
    () => initialQueueState.filter,
  );
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(
    () => initialQueueState.expandedFindingId,
  );
  const [overrideEditingFindingId, setOverrideEditingFindingId] = useState<string | null>(null);
  const findingDecisionRequest = useRef<{
    readonly findingId: string;
    readonly decision: Exclude<FindingDecision, "pending">;
  } | null>(null);
  const findingSummaryButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const findingQueueContext = useRef(`${state.workspaceId}:${state.runId}`);
  const [linkedClaimId, setLinkedClaimId] = useState<string | null>(null);
  const draftBlockRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const emptyCredentialStatus = (provider: "anthropic" | "openai"): CredentialStatus => ({
    provider,
    configured: false,
    source: "none",
    protection: "none",
  });
  const [anthropicStatus, setAnthropicStatus] = useState<CredentialStatus>(() =>
    emptyCredentialStatus("anthropic"),
  );
  const [openaiStatus, setOpenaiStatus] = useState<CredentialStatus>(() =>
    emptyCredentialStatus("openai"),
  );
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [credentialFeedback, setCredentialFeedback] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmedPolicyFingerprint, setConfirmedPolicyFingerprint] = useState<string | null>(null);
  const queueCounts = findingQueueCounts(state.findings);
  const filteredFindings = filterFindingQueue(state.findings, findingFilter);
  const findingDecisionPending = pendingReviewAction?.action === "finding-decision";
  const previousNeedsActionCount = useRef(queueCounts.needsAction);
  const policyConfirmed =
    confirmedPolicyFingerprint === state.providerTransmissionPreflight.fingerprint;
  const transmissionReady =
    !state.providerTransmissionPreflight.required ||
    state.providerTransmissionPreflight.acknowledged;
  const retryRemainingMs = retryWaitMs(state.providerFailure?.retryNotBefore ?? null, nowMs);
  const gateConditions: readonly { id: string; label: string; met: boolean }[] = [
    { id: "draft", label: "Draft artifact produced", met: hasArtifact },
    { id: "critique", label: "Independent critique completed", met: state.reviewComplete },
    {
      id: "blocking",
      label: "Blocking findings resolved or overridden",
      met: hasArtifact && blockingFindings.length === 0,
    },
    ...(state.providerTransmissionPreflight.required
      ? [
          {
            id: "transmission",
            label: "Provider transmission acknowledged",
            met: state.providerTransmissionPreflight.acknowledged,
          },
        ]
      : []),
  ];
  const budgetRatio =
    state.budgetUsd === null || state.budgetUsd <= 0
      ? null
      : Math.min(1, state.totalCostUsd / state.budgetUsd);

  useEffect(() => {
    const nextContext = `${state.workspaceId}:${state.runId}`;
    if (findingQueueContext.current === nextContext) return;

    findingQueueContext.current = nextContext;
    previousNeedsActionCount.current = queueCounts.needsAction;
    const nextQueueState = initialFindingQueueState(state.findings);
    setFindingFilter(nextQueueState.filter);
    setExpandedFindingId(nextQueueState.expandedFindingId);
    setOverrideEditingFindingId(null);
    findingDecisionRequest.current = null;
  }, [queueCounts.needsAction, state.findings, state.runId, state.workspaceId]);

  useEffect(() => {
    const previousCount = previousNeedsActionCount.current;
    previousNeedsActionCount.current = queueCounts.needsAction;
    if (previousCount !== 0 || queueCounts.needsAction === 0) return;

    setFindingFilter("needs-action");
    setExpandedFindingId(filterFindingQueue(state.findings, "needs-action")[0]?.id ?? null);
    setOverrideEditingFindingId(null);
  }, [queueCounts.needsAction, state.findings]);

  useEffect(() => {
    if (!findingDecisionPending && findingDecisionRequest.current !== null) {
      const request = findingDecisionRequest.current;
      const updatedFinding = state.findings.find((finding) => finding.id === request.findingId);
      findingDecisionRequest.current = null;
      if (updatedFinding?.decision !== request.decision) return;

      const visibleFindings = filterFindingQueue(state.findings, findingFilter);
      const nextFindingId = nextActionableFindingId(visibleFindings, request.findingId);
      setExpandedFindingId(nextFindingId);
      setOverrideEditingFindingId(null);
      if (nextFindingId !== null) {
        findingSummaryButtonRefs.current.get(nextFindingId)?.focus();
      }
    }
  }, [findingDecisionPending, findingFilter, state.findings]);

  useEffect(() => {
    if (findingFilter === "needs-action" && queueCounts.needsAction === 0) {
      setFindingFilter("resolved");
      setExpandedFindingId(null);
    }
  }, [findingFilter, queueCounts.needsAction]);

  useEffect(() => {
    setNowMs(Date.now());
    if (state.providerFailure?.retryNotBefore === null || state.providerFailure === null) {
      return undefined;
    }
    const retryAt = Date.parse(state.providerFailure.retryNotBefore);
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNowMs(currentTime);
      if (currentTime >= retryAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.providerFailure?.retryNotBefore, state.providerFailure]);

  const refreshCredentials = useCallback(() => {
    if (getCredentialStatus === undefined) return;
    void getCredentialStatus("anthropic")
      .then(setAnthropicStatus)
      .catch(() => undefined);
    void getCredentialStatus("openai")
      .then(setOpenaiStatus)
      .catch(() => undefined);
  }, [getCredentialStatus]);

  useEffect(() => {
    refreshCredentials();
  }, [refreshCredentials]);

  const handleSaveCredential = async (provider: "anthropic" | "openai", key: string) => {
    if (onSetCredential === undefined || key.trim() === "") return;
    try {
      await onSetCredential(provider, key.trim());
      setCredentialFeedback(
        `${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key saved in app storage. Review the protection status below.`,
      );
      if (provider === "anthropic") setAnthropicKeyInput("");
      else setOpenaiKeyInput("");
      refreshCredentials();
    } catch (error: unknown) {
      setCredentialFeedback(error instanceof Error ? error.message : "Failed to save API key.");
    }
  };

  const handleRemoveCredential = async (provider: "anthropic" | "openai") => {
    if (onRemoveCredential === undefined) return;
    try {
      await onRemoveCredential(provider);
      setCredentialFeedback(
        `${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key removed from app storage.`,
      );
      refreshCredentials();
    } catch {
      setCredentialFeedback("Failed to remove API key.");
    }
  };

  // The credential dialog owns the focus ring while it is open: focus moves in,
  // Tab cycles inside it, Escape closes it from anywhere, and focus returns.
  useEffect(() => {
    if (!settingsOpen) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableElements = (): readonly HTMLElement[] =>
      Array.from(
        settingsDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusableElements()[0]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !settingsDialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [settingsOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      const target = event.target as HTMLElement | null;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isInput) return;

      if (event.altKey || event.metaKey) {
        if (event.key === "a" || event.key === "A") {
          if (canApprove) {
            event.preventDefault();
            onAction({ type: "approve" });
          }
        } else if (event.key === "r" || event.key === "R") {
          if (state.state === "awaiting-approval" && state.reviewComplete && transmissionReady) {
            event.preventDefault();
            onAction({ type: "request-revision" });
          }
        } else if (event.key === "e" || event.key === "E") {
          if (canExport) {
            event.preventDefault();
            onAction({ type: "export" });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canApprove,
    canExport,
    onAction,
    settingsOpen,
    state.reviewComplete,
    state.state,
    transmissionReady,
  ]);

  const submitUrl = (target: "evidence" | "job-description"): void => {
    const value = target === "job-description" ? jobUrl.trim() : evidenceUrl.trim();
    if (value === "" || onAddUrl === undefined) return;
    onAddUrl(target, value);
    if (target === "job-description") setJobUrl("");
    else setEvidenceUrl("");
  };

  const renderSettingsModal = () => {
    if (!settingsOpen) return null;
    // No dismiss-on-backdrop: a stray click must not discard a half-typed key.
    return (
      <div className="modal-backdrop">
        <div
          className="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          aria-describedby="settings-dialog-copy"
          ref={settingsDialogRef}
        >
          <div className="modal-header">
            <div>
              <p className="eyebrow">DraftLoop / Credentials</p>
              <h2 id="settings-dialog-title">Provider API keys</h2>
            </div>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setSettingsOpen(false)}
            >
              Close
              <kbd>Esc</kbd>
            </button>
          </div>
          <p className="modal-copy" id="settings-dialog-copy">
            App-managed keys override environment variables. Storage protection depends on this
            operating system and is reported for each key below.
          </p>
          {credentialFeedback ? (
            <div className="feedback-banner" role="status">
              <p>{credentialFeedback}</p>
            </div>
          ) : null}
          <div className="credential-sections">
            <CredentialRow
              title="Anthropic API key (Claude)"
              placeholder="sk-ant-api03-…"
              status={anthropicStatus}
              value={anthropicKeyInput}
              revealed={showAnthropicKey}
              onReveal={setShowAnthropicKey}
              onChange={setAnthropicKeyInput}
              onSave={() => void handleSaveCredential("anthropic", anthropicKeyInput)}
              onRemove={() => void handleRemoveCredential("anthropic")}
            />
            <CredentialRow
              title="OpenAI API key (GPT)"
              placeholder="sk-proj-…"
              status={openaiStatus}
              value={openaiKeyInput}
              revealed={showOpenaiKey}
              onReveal={setShowOpenaiKey}
              onChange={setOpenaiKeyInput}
              onSave={() => void handleSaveCredential("openai", openaiKeyInput)}
              onRemove={() => void handleRemoveCredential("openai")}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderProviderTransmissionPreflight = () => {
    const preflight = state.providerTransmissionPreflight;
    return (
      <section
        className={`provider-preflight${preflight.required && !preflight.acknowledged ? " provider-preflight-required" : ""}`}
        aria-labelledby="provider-preflight-title"
      >
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Provider transmission preflight</p>
            <h2 id="provider-preflight-title">
              {preflight.required ? "Review data leaving this workspace" : "Demo remains local"}
            </h2>
          </div>
          <span className="status-tag">
            {preflight.required
              ? preflight.acknowledged
                ? "Acknowledged"
                : "Acknowledgement required"
              : "No network transmission"}
          </span>
        </div>
        <dl className="preflight-policy-grid">
          <div>
            <dt>Data class</dt>
            <dd>{preflight.dataClass}</dd>
          </div>
          <div>
            <dt>Retention preference</dt>
            <dd>{preflight.retentionPreference}</dd>
          </div>
          <div>
            <dt>Author destination</dt>
            <dd>
              {preflight.author.company} · {preflight.author.model}
              <br />
              <span>{preflight.author.endpoint}</span>
            </dd>
          </div>
          <div>
            <dt>Critic destination</dt>
            <dd>
              {preflight.critic.company} · {preflight.critic.model}
              <br />
              <span>{preflight.critic.endpoint}</span>
            </dd>
          </div>
          <div>
            <dt>Maximum run budget</dt>
            <dd>
              {preflight.budget.maxRounds} rounds ·{" "}
              {preflight.budget.maxCostUsd === null
                ? "no cost cap"
                : `$${preflight.budget.maxCostUsd.toFixed(2)}`}{" "}
              ·{" "}
              {preflight.budget.maxDurationMs === null
                ? "no duration cap"
                : `${preflight.budget.maxDurationMs} ms`}
            </dd>
          </div>
          <div>
            <dt>Policy fingerprint</dt>
            <dd className="policy-fingerprint">{preflight.fingerprint}</dd>
          </div>
        </dl>
        <div className="preflight-scope">
          <strong>Exactly what may be transmitted</strong>
          <ul>
            {preflight.transmissionScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <strong>Never included</strong>
          <ul>
            {preflight.excludedScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {preflight.required && !preflight.acknowledged ? (
          <div className="preflight-acknowledgement">
            <label>
              <input
                type="checkbox"
                checked={policyConfirmed}
                onChange={(event) =>
                  setConfirmedPolicyFingerprint(event.target.checked ? preflight.fingerprint : null)
                }
              />
              <span>
                I reviewed these destinations, data categories, retention preference, and limits.
              </span>
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={!policyConfirmed}
              onClick={() =>
                onAction({
                  type: "acknowledge-provider-transmission",
                  fingerprint: preflight.fingerprint,
                })
              }
            >
              Acknowledge provider transmission
            </button>
          </div>
        ) : preflight.acknowledgedAt === null ? null : (
          <p className="safe-copy">Acknowledged at {preflight.acknowledgedAt}</p>
        )}
      </section>
    );
  };

  if (state.state === "collecting") {
    const modelKeysReady =
      state.setup.fixtureMode || (anthropicStatus.configured && openaiStatus.configured);
    return (
      <div className="app-frame">
        <SideRail onOpenSettings={() => setSettingsOpen(true)} />
        <main className="app-shell app-shell-single">
          {renderSettingsModal()}
          <div className="main-column">
            <header className="app-bar">
              <div className="brand">
                <span className="brand-context">DraftLoop / Workspace setup</span>
                <h1>Bring your source material into the loop</h1>
              </div>
              <div className="run-identity">
                <span className="meta-chip">
                  <WorkspaceIcon />
                  {state.workspaceId}
                </span>
                <span className="state-pill state-collecting">Collecting inputs</span>
                <button
                  className="button button-quiet button-credentials"
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyIcon />
                  API keys
                </button>
              </div>
            </header>
            <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
              <p className="eyebrow">Before the first run</p>
              <h2 id="onboarding-title">Add the sources DraftLoop is allowed to use</h2>
              <p className="onboarding-copy">
                Your files stay in this workspace. DraftLoop will not invent missing experience or
                start an agent run until the target job and candidate source material are present.
              </p>
              {errorMessage ? (
                <div className="error-banner" role="alert">
                  <p>{errorMessage}</p>
                </div>
              ) : null}
              <div className="setup-grid">
                <article
                  className={`setup-card${state.setup.jobDescriptionReady ? " setup-card-ready" : ""}`}
                >
                  <div className="setup-card-head">
                    <span className="setup-number">01</span>
                    <span
                      className={`setup-state${state.setup.jobDescriptionReady ? " setup-state-ready" : ""}`}
                    >
                      {state.setup.jobDescriptionReady ? "Ready" : "Required"}
                    </span>
                  </div>
                  <strong>Target job description</strong>
                  <span>
                    {state.setup.jobDescriptionReady
                      ? "Ready for review"
                      : "Required input missing"}
                  </span>
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={onSelectFiles === undefined}
                    onClick={() => onSelectFiles?.("job-description")}
                  >
                    {state.setup.jobDescriptionReady
                      ? "Replace job description"
                      : "Add job description"}
                  </button>
                  <label className="url-input-label">
                    <span>Or provide a public URL</span>
                    <input
                      className="url-input"
                      type="url"
                      placeholder="https://…"
                      value={jobUrl}
                      onChange={(event) => setJobUrl(event.target.value)}
                      aria-label="Target job description URL"
                    />
                  </label>
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={onAddUrl === undefined || jobUrl.trim() === ""}
                    onClick={() => submitUrl("job-description")}
                  >
                    Review and fetch job URL
                  </button>
                </article>
                <article
                  className={`setup-card${state.setup.evidenceSourceCount > 0 ? " setup-card-ready" : ""}`}
                >
                  <div className="setup-card-head">
                    <span className="setup-number">02</span>
                    <span
                      className={`setup-state${state.setup.evidenceSourceCount > 0 ? " setup-state-ready" : ""}`}
                    >
                      {state.setup.evidenceSourceCount > 0 ? "Ready" : "Required"}
                    </span>
                  </div>
                  <strong>Candidate source material</strong>
                  <span>
                    {state.setup.evidenceSourceCount === 0
                      ? "Add a CV, portfolio, or other source"
                      : `${state.setup.evidenceSourceCount} source${state.setup.evidenceSourceCount === 1 ? "" : "s"} ready`}
                  </span>
                  {state.setup.evidenceSourceCount > 0 ? (
                    <span className="setup-retrieval-status" role="status">
                      {state.setup.retrievalStatus === "matched"
                        ? `${state.setup.selectedEvidenceChunkCount} relevant excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} selected from ${state.setup.selectedEvidenceSourceCount} source${state.setup.selectedEvidenceSourceCount === 1 ? "" : "s"}`
                        : state.setup.retrievalStatus === "fallback"
                          ? `No lexical match; ${state.setup.selectedEvidenceChunkCount} bounded fallback excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} selected`
                          : state.setup.retrievalStatus === "no-query"
                            ? "The job description has no searchable role terms"
                            : state.setup.retrievalStatus === "unavailable"
                              ? "Retrieval readiness is unavailable"
                              : "Evidence will be indexed when the review starts"}
                    </span>
                  ) : null}
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={onSelectFiles === undefined}
                    onClick={() => onSelectFiles?.("evidence")}
                  >
                    Add source files
                  </button>
                  <label className="url-input-label">
                    <span>Or provide a public URL</span>
                    <input
                      className="url-input"
                      type="url"
                      placeholder="https://github.com/…"
                      value={evidenceUrl}
                      onChange={(event) => setEvidenceUrl(event.target.value)}
                      aria-label="Candidate source URL"
                    />
                  </label>
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={onAddUrl === undefined || evidenceUrl.trim() === ""}
                    onClick={() => submitUrl("evidence")}
                  >
                    Review and fetch source URL
                  </button>
                </article>
                <article className={`setup-card${modelKeysReady ? " setup-card-ready" : ""}`}>
                  <div className="setup-card-head">
                    <span className="setup-number">03</span>
                    <span className={`setup-state${modelKeysReady ? " setup-state-ready" : ""}`}>
                      {state.setup.fixtureMode
                        ? "Not needed"
                        : modelKeysReady
                          ? "Ready"
                          : "Required"}
                    </span>
                  </div>
                  <strong>Model API keys</strong>
                  <span>
                    {state.setup.fixtureMode
                      ? "Demo mode (no keys required)"
                      : anthropicStatus.configured && openaiStatus.configured
                        ? "Anthropic & OpenAI configured"
                        : "Configure keys for live review"}
                  </span>
                  <button
                    className="button button-quiet"
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Manage API keys
                  </button>
                </article>
              </div>
              {renderProviderTransmissionPreflight()}
              {state.setup.nextSteps.length > 0 ? (
                <div className="setup-next-steps">
                  <strong>Next steps</strong>
                  <ul>
                    {state.setup.nextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="onboarding-footer">
                <span>{state.setup.fixtureMode ? "Demo workspace" : "Real workspace"}</span>
                <span>
                  {state.setup.requiredSections.length > 0
                    ? `Required sections: ${state.setup.requiredSections.join(", ")}`
                    : "No required sections"}
                </span>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={
                    !state.setup.ready ||
                    !transmissionReady ||
                    pendingReviewAction?.action === "start"
                  }
                  onClick={() => onAction({ type: "start" })}
                >
                  {pendingReviewAction?.action === "start"
                    ? "Starting review…"
                    : "Start author–critic review"}
                </button>
              </div>
              {pendingReviewAction?.action === "start" ? (
                <p className="pending-action-status" role="status" aria-live="polite">
                  Starting review… Elapsed {pendingReviewAction.elapsedSeconds} second
                  {pendingReviewAction.elapsedSeconds === 1 ? "" : "s"}. Keep this window open while
                  the review starts.
                </p>
              ) : null}
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <SideRail onOpenSettings={() => setSettingsOpen(true)} />
      <main className="app-shell">
        {renderSettingsModal()}
        <div className="main-column">
          <header className="app-bar">
            <div className="brand">
              <span className="brand-context">DraftLoop / Review workspace</span>
              <h1>Sources before approval</h1>
            </div>
            <div className="run-identity">
              <span className="meta-chip">
                <WorkspaceIcon />
                {state.workspaceId}
              </span>
              <span className={`state-pill state-${state.state}`}>{stateLabel(state.state)}</span>
              <span className="approval-pill">{approvalLabel}</span>
              <span className="meta-chip">Round {state.round}</span>
              <button
                className="button button-quiet button-credentials"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                API keys
              </button>
            </div>
          </header>

          <section className="instrument-panel" aria-label="run instrumentation">
            <div className="loop-band">
              <LoopRail activeIndex={loopStageIndex(state)} round={state.round} />
              <div className="loop-band-meta">
                <span className="label">Elapsed cost</span>
                <strong>
                  ${state.totalCostUsd.toFixed(3)}
                  {state.budgetUsd === null ? "" : ` / $${state.budgetUsd.toFixed(2)}`}
                </strong>
              </div>
            </div>

            <section className="trust-strip" aria-label="trust and policy summary">
              <div>
                <span className="trust-icon" aria-hidden="true">
                  {state.providerExposure.author.company.slice(0, 1).toUpperCase()}
                </span>
                <div className="trust-body">
                  <span className="label">Author</span>
                  <strong>{state.providerExposure.author.company}</strong>
                  <span>{state.providerExposure.author.model}</span>
                </div>
              </div>
              <div>
                <span className="trust-icon" aria-hidden="true">
                  {state.providerExposure.critic.company.slice(0, 1).toUpperCase()}
                </span>
                <div className="trust-body">
                  <span className="label">Independent critic</span>
                  <strong>{state.providerExposure.critic.company}</strong>
                  <span>{state.providerExposure.critic.model}</span>
                </div>
              </div>
              <div>
                <span className="trust-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    <path
                      d="M12 3 4.8 6v5.4c0 4.3 2.9 8.3 7.2 9.6 4.3-1.3 7.2-5.3 7.2-9.6V6L12 3Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="trust-body">
                  <span className="label">Data policy</span>
                  <strong>
                    {state.providerExposure.transmissionAllowed
                      ? "Transmission approved"
                      : "Local only"}
                  </strong>
                  <span>
                    {state.providerExposure.requestedRetention} · sensitive material{" "}
                    {state.providerExposure.sensitiveData ? "present" : "absent"}
                  </span>
                </div>
              </div>
              <div>
                <span className="trust-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    <rect
                      x="3"
                      y="6"
                      width="18"
                      height="12"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="17" cy="14" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <div className="trust-body">
                  <span className="label">Budget</span>
                  <strong className="numeric">${state.totalCostUsd.toFixed(3)} used</strong>
                  <span>
                    {state.budgetUsd === null
                      ? "No cap configured"
                      : `$${state.budgetUsd.toFixed(2)} cap`}
                  </span>
                  {budgetRatio === null ? null : (
                    <span
                      className={`cost-meter${budgetRatio > 0.75 ? " cost-meter-high" : ""}`}
                      aria-hidden="true"
                    >
                      <span style={{ width: `${Math.round(budgetRatio * 100)}%` }} />
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="retrieval-strip" aria-label="evidence retrieval status">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                <path
                  d="M4 7h16M4 12h16M4 17h9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <strong>Evidence retrieval</strong>
              <span role="status">
                {state.setup.retrievalStatus === "matched"
                  ? `${state.setup.selectedEvidenceChunkCount} relevant excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} selected from ${state.setup.selectedEvidenceSourceCount} candidate source${state.setup.selectedEvidenceSourceCount === 1 ? "" : "s"}`
                  : state.setup.retrievalStatus === "fallback"
                    ? `No lexical match; using ${state.setup.selectedEvidenceChunkCount} bounded fallback excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} from candidate material`
                    : state.setup.retrievalStatus === "not-indexed"
                      ? "Candidate material is not indexed; no evidence excerpt was selected"
                      : state.setup.retrievalStatus === "no-query"
                        ? "The job description has no searchable role terms"
                        : "Retrieval readiness is unavailable"}
              </span>
            </section>
          </section>

          {errorMessage ? (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          ) : null}

          {state.state === "provider-error" && state.providerFailure !== null ? (
            <section
              className="panel provider-failure-panel"
              role="alert"
              aria-label="provider failure"
            >
              <p className="eyebrow">Provider request failed</p>
              <h2>{state.providerFailure.explanation}</h2>
              <p className="subtle">
                {state.providerFailure.provider} · {state.providerFailure.model} ·{" "}
                {state.providerFailure.step} · attempt {state.providerFailure.attempt} of{" "}
                {state.providerFailure.maxAttempts}
              </p>
              {state.providerFailure.diagnostics.length > 0 ? (
                <div className="provider-diagnostics">
                  <strong>Validation details</strong>
                  <ul>
                    {state.providerFailure.diagnostics.map((diagnostic) => (
                      <li key={`${diagnostic.code}:${diagnostic.path}`}>
                        {diagnostic.path === "" ? "response" : diagnostic.path}: {diagnostic.code}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="approval-actions">
                {state.providerFailure.availableActions.includes("retry") ? (
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={
                      !transmissionReady || retryRemainingMs > 0 || pendingReviewAction !== null
                    }
                    onClick={() => onAction({ type: "resume" })}
                  >
                    {retryRemainingMs > 0
                      ? `Retry ${state.providerFailure.step} in ${retryWaitLabel(retryRemainingMs)}`
                      : `Retry ${state.providerFailure.step}`}
                  </button>
                ) : null}
                {state.providerFailure.availableActions.includes("return-to-review") ? (
                  <button
                    className="button button-outline"
                    type="button"
                    onClick={() => onAction({ type: "recover-to-review" })}
                  >
                    Return to review
                  </button>
                ) : null}
                {state.providerFailure.availableActions.includes("stop") ? (
                  <button
                    className="button button-quiet"
                    type="button"
                    onClick={() => onAction({ type: "stop" })}
                  >
                    Stop run
                  </button>
                ) : null}
              </div>
              {retryRemainingMs > 0 ? (
                <p className="pending-action-status" role="status" aria-live="polite">
                  Retry is paused until the provider retry window opens (
                  {retryWaitLabel(retryRemainingMs)}).
                </p>
              ) : null}
            </section>
          ) : null}

          {state.providerTransmissionPreflight.required &&
          !state.providerTransmissionPreflight.acknowledged
            ? renderProviderTransmissionPreflight()
            : null}

          <section
            className={`validation-banner validation-${findingSummary.status}`}
            aria-label="validation status"
            role="status"
            aria-live="polite"
          >
            <strong>{validationLabel}</strong>
            <span>
              {!hasArtifact
                ? "Complete or recover the author step before reviewing findings or approving an artifact."
                : !state.reviewComplete
                  ? "Complete an independent critic review before approval or export."
                  : findingSummary.status === "blocked"
                    ? "Approval is unavailable until every blocking finding is resolved or explicitly overridden."
                    : findingSummary.status === "warnings"
                      ? "Approval remains your decision; unresolved warnings will stay visible in the review history."
                      : "All findings have a recorded decision."}
            </span>
          </section>

          <section className="review-column" aria-label="artifact review" id="artifact-review">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Draft under review</p>
                <h2>Version {state.artifact.version}</h2>
              </div>
              <span className="subtle">
                Edits you make here are part of the artifact you approve.
              </span>
            </div>

            <div className="diff-grid">
              <article className="artifact-pane previous-pane">
                <div className="pane-heading">
                  <span>Previous version</span>
                  <span>
                    {state.previousArtifact === null
                      ? "None"
                      : `v${state.previousArtifact.version}`}
                  </span>
                </div>
                {state.previousArtifact === null ? (
                  <p className="empty-state">This is the first artifact version.</p>
                ) : (
                  state.previousArtifact.sections.map((section) => (
                    <section className="artifact-section" key={section.id}>
                      <h3>{section.title}</h3>
                      {section.blocks.map((block) => (
                        <p className={block.type === "bullet" ? "bullet" : ""} key={block.id}>
                          {block.text}
                        </p>
                      ))}
                    </section>
                  ))
                )}
              </article>
              <span className="diff-arrow" aria-hidden="true">
                →
              </span>
              <article className="artifact-pane current-pane">
                <div className="pane-heading">
                  <span>Current draft</span>
                  <span>v{state.artifact.version} · editable</span>
                </div>
                {state.artifact.sections.map((section) => (
                  <section className="artifact-section" key={section.id}>
                    <h3>{section.title}</h3>
                    {section.blocks.map((block) => {
                      const sourceState = blockSourceState(block, claimById);
                      const isLinked =
                        linkedClaimId !== null && block.claimIds.includes(linkedClaimId);
                      return (
                        <label
                          className={`editable-block editable-block-${sourceState}${
                            isLinked ? " editable-block-linked" : ""
                          }`}
                          key={block.id}
                        >
                          <span className="sr-only">Edit {section.title}</span>
                          <textarea
                            aria-label={`Edit ${section.title}`}
                            value={block.text}
                            rows={block.type === "bullet" ? 3 : 4}
                            ref={(element) => {
                              if (element === null) draftBlockRefs.current.delete(block.id);
                              else draftBlockRefs.current.set(block.id, element);
                            }}
                            onFocus={() => setLinkedClaimId(block.claimIds[0] ?? null)}
                            onBlur={() => setLinkedClaimId(null)}
                            onMouseEnter={() => setLinkedClaimId(block.claimIds[0] ?? null)}
                            onMouseLeave={() => setLinkedClaimId(null)}
                            onChange={(event) =>
                              onAction({
                                type: "edit-block",
                                blockId: block.id,
                                text: event.target.value,
                              })
                            }
                          />
                        </label>
                      );
                    })}
                  </section>
                ))}
              </article>
            </div>

            <section className="claims-panel" aria-label="claim to source inspection">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Traceability</p>
                  <h2>Claims and candidate sources</h2>
                </div>
                <span className="subtle">
                  Source links show where wording came from; they do not independently verify it.
                </span>
              </div>
              <div className="claim-list">
                {state.artifact.claims.map((claim) => {
                  const draftBlockId = claimBlockId(state.artifact, claim.id);
                  return (
                    <article
                      className={`claim-card claim-${claim.status}${
                        linkedClaimId === claim.id ? " claim-linked" : ""
                      }`}
                      key={claim.id}
                    >
                      <div className="claim-heading">
                        <strong>{claim.text}</strong>
                        <span className="claim-heading-actions">
                          {draftBlockId === null ? null : (
                            <button
                              className="claim-locate"
                              type="button"
                              title="Show the draft line this claim comes from"
                              onMouseEnter={() => setLinkedClaimId(claim.id)}
                              onMouseLeave={() => setLinkedClaimId(null)}
                              onFocus={() => setLinkedClaimId(claim.id)}
                              onBlur={() => setLinkedClaimId(null)}
                              onClick={() => {
                                const target = draftBlockRefs.current.get(draftBlockId);
                                target?.scrollIntoView({ block: "center", behavior: "smooth" });
                                target?.focus();
                              }}
                            >
                              <LinkIcon />
                              <span className="sr-only">Show the draft line for: {claim.text}</span>
                            </button>
                          )}
                          <span className="status-tag">{claimSourceLabel(claim)}</span>
                        </span>
                      </div>
                      {claimSectionTitle(state.artifact, claim.id) === null ? null : (
                        <span className="claim-section-tag">
                          {claimSectionTitle(state.artifact, claim.id)}
                        </span>
                      )}
                      {claim.evidence.length === 0 ? (
                        <p className="warning-copy">
                          This claim is not linked to the candidate materials supplied to DraftLoop.
                        </p>
                      ) : (
                        claim.evidence.map((reference) => (
                          <div
                            className={`evidence-row evidence-${reference.status}`}
                            key={`${reference.sourcePath}-${reference.locator}`}
                          >
                            <span aria-hidden="true">↳</span>
                            <span>
                              <strong>{reference.sourcePath}</strong> · {reference.locator}
                              <br />
                              {reference.excerpt}
                            </span>
                            <span className="status-tag">{reference.status}</span>
                          </div>
                        ))
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </section>
        </div>

        <aside className="side-column">
          <section className="panel progress-panel" aria-label="run progress">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Run progress</p>
                <h2>{stateLabel(state.state)}</h2>
              </div>
              {state.execution.status === "interrupted" ? (
                <div className="approval-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={pendingReviewAction !== null || !transmissionReady}
                    onClick={() => onAction({ type: "resume" })}
                  >
                    Resume interrupted review
                  </button>
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={pendingReviewAction !== null}
                    onClick={() => onAction({ type: "stop" })}
                  >
                    Stop review
                  </button>
                </div>
              ) : state.state === "paused" ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!transmissionReady}
                  onClick={() => onAction({ type: "resume" })}
                >
                  <PlayIcon />
                  Resume
                </button>
              ) : state.state === "stopped" ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!transmissionReady || pendingReviewAction !== null}
                  onClick={() => onAction({ type: "start" })}
                >
                  {pendingReviewAction?.action === "start"
                    ? "Starting new review…"
                    : "Start a new review"}
                </button>
              ) : state.execution.status === "running" ? (
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={pendingReviewAction !== null}
                  onClick={() => onAction({ type: "stop" })}
                >
                  {pendingReviewAction?.action === "stop" ? "Stopping…" : "Stop review"}
                </button>
              ) : null}
            </div>
            {state.execution.status === "interrupted" ? (
              <p className="pending-action-status" role="status">
                This review was interrupted when the previous app session ended. Resume it to
                continue from the durable step, or stop it without losing history.
              </p>
            ) : state.execution.step === null ? null : (
              <p className="pending-action-status" role="status" aria-live="polite">
                {state.execution.step} · {state.execution.provider}/{state.execution.model} ·
                attempt {state.execution.attempt} · elapsed{" "}
                {Math.floor(state.execution.elapsedMs / 1_000)}s
                {state.execution.timeoutRemainingMs === null
                  ? " · no timeout configured"
                  : ` · timeout in ${Math.ceil(state.execution.timeoutRemainingMs / 1_000)}s`}
              </p>
            )}
            <ol className="event-list">
              {state.events.map((event) => (
                <li key={event.id}>
                  <span className={`event-dot state-${event.state}`} />
                  <span>
                    <strong>{event.label}</strong>
                    <small>{stateLabel(event.state)}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel findings-panel" aria-label="critique findings">
            <div className="findings-queue-header">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Critique triage</p>
                  <h2>Findings</h2>
                  <p className="finding-progress" role="status" aria-live="polite">
                    {queueCounts.resolved} of {state.findings.length} decided
                    {queueCounts.needsAction > 0
                      ? ` · ${queueCounts.needsAction} need action`
                      : " · all findings decided"}
                  </p>
                </div>
                <span className="count-badge">
                  {!hasArtifact
                    ? "Not evaluated"
                    : queueCounts.needsAction === 0
                      ? "All resolved"
                      : `${queueCounts.blocking} blocking · ${queueCounts.warnings} warning${queueCounts.warnings === 1 ? "" : "s"}`}
                </span>
              </div>
              <fieldset className="finding-filters">
                <legend className="sr-only">Finding filters</legend>
                {findingQueueFilters.map((filter) => {
                  const count = findingQueueFilterCount(queueCounts, filter.id);
                  const isSelected = findingFilter === filter.id;
                  return (
                    <button
                      className={`finding-filter${isSelected ? " finding-filter-selected" : ""}`}
                      type="button"
                      aria-pressed={isSelected}
                      aria-controls="finding-queue-list"
                      key={filter.id}
                      onClick={() => {
                        setFindingFilter(filter.id);
                        setExpandedFindingId(null);
                        setOverrideEditingFindingId(null);
                      }}
                    >
                      <span>{filter.label}</span>
                      <span className="finding-filter-count">{count}</span>
                    </button>
                  );
                })}
              </fieldset>
            </div>
            {findingDecisionPending ? (
              <p className="pending-action-status" role="status" aria-live="polite">
                Saving finding decision… Elapsed {pendingReviewAction.elapsedSeconds} second
                {pendingReviewAction.elapsedSeconds === 1 ? "" : "s"}. Keep this window open while
                the decision is saved.
              </p>
            ) : null}
            <section
              className="findings-queue-scroll"
              id="finding-queue-list"
              aria-label="Findings queue"
            >
              {filteredFindings.length === 0 ? (
                <p className="finding-empty-state" role="status">
                  {findingQueueEmptyMessage(findingFilter, queueCounts)}
                </p>
              ) : null}
              {filteredFindings.map((finding) => {
                const claim =
                  finding.claimId === undefined ? undefined : claimById.get(finding.claimId);
                const isExpanded = expandedFindingId === finding.id;
                const summaryId = findingDomId("finding-summary", finding.id);
                const detailsId = findingDomId("finding-details", finding.id);
                const isEditingOverride = isOverrideEditorVisible(
                  overrideEditingFindingId,
                  finding.id,
                );
                const rationale = overrideReasons[finding.id] ?? finding.rationale ?? "";

                return (
                  <article
                    className={`finding-row finding-${finding.severity}${
                      isUnresolvedFinding(finding) ? "" : " finding-resolved"
                    }`}
                    key={finding.id}
                  >
                    <button
                      className="finding-summary"
                      type="button"
                      id={summaryId}
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      ref={(element) => {
                        if (element === null) findingSummaryButtonRefs.current.delete(finding.id);
                        else findingSummaryButtonRefs.current.set(finding.id, element);
                      }}
                      onClick={() => {
                        setExpandedFindingId((current) =>
                          current === finding.id ? null : finding.id,
                        );
                        setOverrideEditingFindingId(null);
                      }}
                    >
                      <span className={`severity severity-${finding.severity}`}>
                        {finding.severity === "error" ? "blocking" : "warning"}
                      </span>
                      <span className="finding-summary-content">
                        <span className="finding-summary-message">{finding.message}</span>
                      </span>
                      <span className="finding-summary-footer">
                        <span className={`finding-summary-status resolution-${finding.decision}`}>
                          {decisionLabels[finding.decision]}
                          <span className="finding-summary-chevron" aria-hidden="true">
                            {isExpanded ? "⌃" : "⌄"}
                          </span>
                        </span>
                        <span className="finding-summary-meta">
                          {finding.category} · {finding.code}
                        </span>
                      </span>
                    </button>
                    {isExpanded ? (
                      <section
                        className="finding-details"
                        id={detailsId}
                        aria-labelledby={summaryId}
                      >
                        {finding.agreement !== "author-and-critic" ? (
                          <p className="disagreement">Disagreement · {finding.agreement} finding</p>
                        ) : null}
                        {claim === undefined ? (
                          <p className="linked-claim">No linked claim for this finding.</p>
                        ) : (
                          <p className="linked-claim">Linked claim: {claim.text}</p>
                        )}
                        <fieldset className="finding-actions">
                          <legend className="sr-only">Decision for {finding.code}</legend>
                          {directFindingDecisions.map((decision) => (
                            <button
                              className={
                                finding.decision === decision
                                  ? "button button-selected"
                                  : "button button-quiet"
                              }
                              type="button"
                              key={decision}
                              disabled={findingDecisionPending}
                              onClick={() => {
                                findingDecisionRequest.current = {
                                  findingId: finding.id,
                                  decision,
                                };
                                onAction({
                                  type: "finding-decision",
                                  findingId: finding.id,
                                  decision,
                                });
                              }}
                            >
                              {decisionLabels[decision]}
                            </button>
                          ))}
                          <button
                            className={
                              isEditingOverride || finding.decision === "overridden"
                                ? "button button-selected"
                                : "button button-quiet"
                            }
                            type="button"
                            disabled={findingDecisionPending}
                            onClick={() => {
                              setOverrideReasons((current) =>
                                current[finding.id] === undefined
                                  ? { ...current, [finding.id]: finding.rationale ?? "" }
                                  : current,
                              );
                              setOverrideEditingFindingId(finding.id);
                            }}
                          >
                            Override
                          </button>
                        </fieldset>
                        {isEditingOverride ? (
                          <section
                            className="override-editor"
                            aria-label={`Override ${finding.code}`}
                          >
                            <label className="rationale-input-label">
                              <span>Override rationale (required)</span>
                              <input
                                className="rationale-input"
                                type="text"
                                value={rationale}
                                disabled={findingDecisionPending}
                                onChange={(event) =>
                                  setOverrideReasons((current) => ({
                                    ...current,
                                    [finding.id]: event.target.value,
                                  }))
                                }
                                aria-label={`Override rationale for ${finding.code}`}
                              />
                            </label>
                            <div className="override-editor-actions">
                              <button
                                className="button button-quiet"
                                type="button"
                                disabled={findingDecisionPending}
                                onClick={() => {
                                  setOverrideEditingFindingId(null);
                                  setOverrideReasons((current) => {
                                    const next = { ...current };
                                    delete next[finding.id];
                                    return next;
                                  });
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                className="button button-primary"
                                type="button"
                                disabled={findingDecisionPending || rationale.trim() === ""}
                                onClick={() => {
                                  const trimmedRationale = rationale.trim();
                                  if (trimmedRationale === "") return;
                                  findingDecisionRequest.current = {
                                    findingId: finding.id,
                                    decision: "overridden",
                                  };
                                  onAction({
                                    type: "finding-decision",
                                    findingId: finding.id,
                                    decision: "overridden",
                                    rationale: trimmedRationale,
                                  });
                                  setOverrideEditingFindingId(null);
                                }}
                              >
                                Save override
                              </button>
                            </div>
                          </section>
                        ) : null}
                      </section>
                    ) : null}
                  </article>
                );
              })}
            </section>
          </section>

          <section className="panel approval-panel" aria-label="approval and export">
            <p className="eyebrow">Human gate</p>
            <h2>Human approval gate</h2>
            <p className="subtle approval-status">
              Artifact: {state.approval === "approved" ? "approved" : "not approved"} · Export:{" "}
              {state.exportPath === null ? "not exported" : "exported"} · Validation:{" "}
              {validationLabel}
            </p>
            {!hasArtifact ? (
              <p className="warning-copy">
                Approval and export are unavailable until the author produces a valid draft.
              </p>
            ) : !state.reviewComplete ? (
              <p className="warning-copy">
                Independent critique did not complete. Complete an independent critic review before
                approval or export.
              </p>
            ) : blockingFindings.length > 0 ? (
              <p className="warning-copy">
                {state.approval === "approved"
                  ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? " remains" : "s remain"} unresolved after approval.`
                  : `Resolve or override ${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"} before approval.`}
              </p>
            ) : warnings.length > 0 ? (
              <p className="warning-copy">
                Approval is available with {warnings.length} unresolved non-blocking warning
                {warnings.length === 1 ? "" : "s"}. They remain visible after approval.
              </p>
            ) : state.state === "provider-error" ? (
              <p className="warning-copy">
                No unresolved blocking findings; provider recovery remains before approval.
              </p>
            ) : (
              <p className="safe-copy">
                No unresolved blocking findings. The final decision remains yours.
              </p>
            )}
            <ul className="gate-checklist">
              {gateConditions.map((condition) => (
                <li
                  className={`gate-item ${condition.met ? "gate-met" : "gate-blocked"}`}
                  key={condition.id}
                >
                  <span className="gate-mark" aria-hidden="true">
                    {condition.met ? "✓" : "!"}
                  </span>
                  <span>
                    {condition.label}
                    <span className="sr-only">{condition.met ? " — met" : " — not met"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="approval-actions">
              <button
                className="button button-primary"
                type="button"
                aria-keyshortcuts="Alt+A"
                title="Approve artifact (Alt+A)"
                disabled={!canApprove || pendingReviewAction !== null}
                onClick={() => onAction({ type: "approve" })}
              >
                Approve artifact
                <kbd>Alt+A</kbd>
              </button>
              <button
                className="button button-quiet"
                type="button"
                aria-keyshortcuts="Alt+R"
                title="Request revision (Alt+R)"
                disabled={
                  state.state !== "awaiting-approval" ||
                  !state.reviewComplete ||
                  !transmissionReady ||
                  pendingReviewAction !== null
                }
                onClick={() => onAction({ type: "request-revision" })}
              >
                Request revision
                <kbd>Alt+R</kbd>
              </button>
            </div>
            {approvalExportErrorVisible ? (
              <div className="error-banner approval-action-error" role="alert">
                <p>{errorMessage}</p>
              </div>
            ) : null}
            <div className="export-action">
              <div>
                <strong>Export locally</strong>
                <span className="export-path" aria-live="polite">
                  {state.exportPath ??
                    (!state.reviewComplete
                      ? "Unavailable until independent critique completes"
                      : canExport
                        ? "Available now"
                        : state.state === "approved"
                          ? "Unavailable while another action is pending"
                          : "Available after approval")}
                </span>
              </div>
              <button
                className="button button-outline"
                type="button"
                aria-keyshortcuts="Alt+E"
                title="Export Markdown (Alt+E)"
                disabled={!canExport}
                onClick={() => onAction({ type: "export" })}
              >
                {exportPending ? (
                  "Exporting Markdown…"
                ) : (
                  <>
                    Export Markdown
                    <kbd>Alt+E</kbd>
                  </>
                )}
              </button>
            </div>
            {exportPending ? (
              <p className="pending-action-status" role="status" aria-live="polite">
                Exporting Markdown… Elapsed {pendingReviewAction.elapsedSeconds} second
                {pendingReviewAction.elapsedSeconds === 1 ? "" : "s"}. Choose a destination in the
                Save As dialog; the approved artifact will be written after you confirm.
              </p>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  );
}
