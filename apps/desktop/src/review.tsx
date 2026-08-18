import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CredentialStatus } from "./bridge.js";
import { type DiffOp, diffWords } from "./diff.js";
import {
  type DesktopReviewState,
  type FindingDecision,
  type IndependentReviewView,
  type ReviewAction,
  type ReviewArtifact,
  type ReviewBlock,
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

/** One key, one decision. Bare letters, because deciding is the repetitive act here. */
const findingDecisionKeys: Readonly<
  Record<string, Exclude<FindingDecision, "pending" | "overridden">>
> = {
  a: "accepted",
  r: "rejected",
  d: "deferred",
};

/** One entry in the command palette: an action of this workspace, reachable by its name. */
interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** What the command does, or the shortcut it mirrors. */
  readonly note: string;
  /** Why the command cannot run right now, or null when it can. */
  readonly disabledReason: string | null;
  readonly run: () => void;
}

/** Narrows the palette by a plain substring of the command's own words. */
function matchPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string,
): readonly PaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return commands;
  return commands.filter((command) =>
    `${command.label} ${command.note}`.toLowerCase().includes(needle),
  );
}

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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M8.5 6.5 17 12l-8.5 5.5V6.5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The rail is a table of contents for the workspace, not a toolbar: four destinations, each
 * one place a reviewer actually goes. It carries no section-in-view state, because the draft
 * and the queue scroll in two independent columns and are almost always both on screen —
 * an "active" mark there would be decoration that lies. `onOpenSources` is null before a run
 * exists, when there is no document, no queue and no traceability to reach.
 */
function SideRail({
  onOpenSources,
  onOpenSettings,
}: {
  readonly onOpenSources: (() => void) | null;
  readonly onOpenSettings: () => void;
}) {
  return (
    <nav className="side-rail" aria-label="Workspace sections">
      <BrandMark />
      {onOpenSources === null ? null : (
        <>
          <a className="rail-button" href="#artifact-review" title="Document — the draft">
            <span className="sr-only">Document — the draft</span>
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
          <a className="rail-button" href="#finding-queue-list" title="Findings — the queue">
            <span className="sr-only">Findings — the queue</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path
                d="M4 6h16M4 12h16M4 18h10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </a>
          <button
            className="rail-button"
            type="button"
            title="Sources — claim traceability"
            onClick={onOpenSources}
          >
            <span className="sr-only">Sources — claim traceability</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path
                d="M12 4.5 3.8 8.2 12 11.9l8.2-3.7L12 4.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M4.4 12.2 12 15.6l7.6-3.4M4.4 16.1 12 19.5l7.6-3.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
      <span className="rail-spacer" />
      <button
        className="rail-button"
        type="button"
        title="Keys — provider API keys"
        onClick={onOpenSettings}
      >
        <span className="sr-only">Keys — provider API keys</span>
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

/** How the trust panel presents a recorded independence claim. */
type IndependenceTone = "independent" | "shared" | "unrecorded";

interface IndependenceSummary {
  readonly tone: IndependenceTone;
  readonly mark: string;
  readonly detail: string;
  readonly overrideRationale: string | null;
}

/**
 * Read the run's recorded independence claim, rather than re-deriving one.
 *
 * This panel used to compare provider companies. That proxy is wrong in both
 * directions, and the damaging direction is that it reports "independent" for
 * two vendors serving one open-weights base model, on the surface a person
 * reads immediately before approving. Independence is now model lineage and it
 * is recorded by the domain (ADR 0005), so the only correct thing to do here is
 * report the record.
 *
 * A lineage is an operator label that nothing verifies, so no branch may read
 * as proof, and no shared lineage may read as independent whatever rationale
 * was recorded against it. An absent record is its own state: it is not
 * evidence of independence and not evidence against it.
 */
/**
 * The approval-gate label for the recorded independence claim.
 *
 * The gate states what the run recorded. A shared lineage that proceeded on a
 * rationale is reported as overridden rather than met, so the checklist never
 * reads as though an independent critique happened when the record says it did
 * not.
 */
function independenceGateLabel(view: IndependentReviewView | null): string {
  if (view === null) return "Independence claim recorded";
  if (!view.required) return "Independent review not required for this run";
  if (view.lineagesDistinct) return "Author and critic lineages differ, as claimed";
  if (view.overrideRationale !== null) {
    return "Shared lineage overridden on a recorded rationale; critique was not independent";
  }
  return "Author and critic share one lineage; critique was not independent";
}

function independenceSummary(view: IndependentReviewView | null): IndependenceSummary {
  if (view === null) {
    return {
      tone: "unrecorded",
      mark: "not recorded",
      detail:
        "No lineage claim was recorded. Either no run has started yet, or the run predates independence being recorded.",
      overrideRationale: null,
    };
  }
  if (!view.required) {
    return {
      tone: "unrecorded",
      mark: "not required",
      detail: `Independent review was not required for this run; the claimed lineages ${
        view.lineagesDistinct ? "differ" : "are the same"
      }.`,
      overrideRationale: null,
    };
  }
  if (view.lineagesDistinct) {
    return {
      tone: "independent",
      mark: "lineages differ",
      detail:
        "Author and critic lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
      overrideRationale: null,
    };
  }
  if (view.overrideRationale !== null) {
    return {
      tone: "shared",
      mark: "overridden",
      detail:
        "Author and critic share one lineage, so this critique was not independent; the run proceeded on a recorded rationale.",
      overrideRationale: view.overrideRationale,
    };
  }
  return {
    tone: "shared",
    mark: "not independent",
    detail:
      "Author and critic share one lineage, and no override rationale was recorded, so this critique was not independent.",
    overrideRationale: null,
  };
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

/**
 * A modal owns the focus ring while it is open: focus moves in, Tab cycles inside it, Escape
 * closes it from anywhere, and focus returns to wherever the reviewer was. One implementation,
 * so the credential dialog and the command palette cannot drift apart.
 */
function useModalFocusTrap(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  // The close callback is read at event time, so a new closure each render does not
  // re-run the trap and steal focus back to the top of the dialog.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableElements = (): readonly HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusableElements()[0]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
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
  }, [dialogRef, open]);
}

// Measuring a textarea needs a layout, and the server render has none.
const useSheetLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

/** One draft line as it stands across two versions, ready to be marked up on the sheet. */
export interface DraftBlockPair {
  readonly key: string;
  /** The current block, or null when this line survives only in the previous version. */
  readonly block: ReviewBlock | null;
  /** The matching previous text, or null when this line is wholly new. */
  readonly previousText: string | null;
  readonly text: string;
}

/** One section of the draft, with its lines already paired across the two versions. */
export interface DraftSectionPair {
  readonly key: string;
  readonly title: string;
  readonly removed: boolean;
  readonly blocks: readonly DraftBlockPair[];
}

interface VersionPair<T> {
  readonly current: T | null;
  readonly previous: T | null;
}

/**
 * Lines up two versions of one ordered list. Ids are authoritative; whatever they leave
 * unmatched falls back to `fallbackMatches` in document order, because a revision may rewrite
 * a line without keeping its id and a reader still pairs the two versions by position.
 * Records that exist only in the previous version come back as removals, in their old place.
 */
function alignVersions<T extends { readonly id: string }>(
  current: readonly T[],
  previous: readonly T[],
  fallbackMatches: (currentItem: T, previousItem: T) => boolean,
): readonly VersionPair<T>[] {
  const previousIndexById = new Map(previous.map((item, index) => [item.id, index]));
  const taken = new Set<number>();
  const matches: (number | null)[] = current.map((item) => {
    const index = previousIndexById.get(item.id);
    if (index === undefined || taken.has(index)) return null;
    taken.add(index);
    return index;
  });
  current.forEach((item, index) => {
    if (matches[index] !== null) return;
    for (let candidate = 0; candidate < previous.length; candidate += 1) {
      const previousItem = previous[candidate];
      if (previousItem === undefined || taken.has(candidate)) continue;
      if (!fallbackMatches(item, previousItem)) continue;
      taken.add(candidate);
      matches[index] = candidate;
      return;
    }
  });

  const pairs: VersionPair<T>[] = [];
  let cursor = 0;
  const emitRemovedBefore = (limit: number): void => {
    for (; cursor < limit; cursor += 1) {
      const previousItem = previous[cursor];
      if (previousItem !== undefined && !taken.has(cursor)) {
        pairs.push({ current: null, previous: previousItem });
      }
    }
  };
  current.forEach((item, index) => {
    const match = matches[index] ?? null;
    if (match === null) {
      pairs.push({ current: item, previous: null });
      return;
    }
    emitRemovedBefore(match);
    cursor = match + 1;
    pairs.push({ current: item, previous: previous[match] ?? null });
  });
  emitRemovedBefore(previous.length);
  return pairs;
}

/** Pairs the lines of one section across two versions, keeping removals in document order. */
export function pairDraftBlocks(
  currentBlocks: readonly ReviewBlock[],
  previousBlocks: readonly ReviewBlock[],
): readonly DraftBlockPair[] {
  const pairs: DraftBlockPair[] = [];
  for (const pair of alignVersions(currentBlocks, previousBlocks, () => true)) {
    if (pair.current === null) {
      if (pair.previous === null) continue;
      pairs.push({
        key: `removed-${pair.previous.id}`,
        block: null,
        previousText: pair.previous.text,
        text: pair.previous.text,
      });
      continue;
    }
    pairs.push({
      key: pair.current.id,
      block: pair.current,
      previousText: pair.previous === null ? null : pair.previous.text,
      text: pair.current.text,
    });
  }
  return pairs;
}

/** Pairs the whole draft across two versions. Sections match by id, then by title. */
export function pairDraftSections(
  artifact: ReviewArtifact,
  previousArtifact: ReviewArtifact | null,
): readonly DraftSectionPair[] {
  const sections: DraftSectionPair[] = [];
  for (const pair of alignVersions(
    artifact.sections,
    previousArtifact?.sections ?? [],
    (section, previousSection) => section.title === previousSection.title,
  )) {
    if (pair.current === null) {
      if (pair.previous === null) continue;
      sections.push({
        key: `removed-${pair.previous.id}`,
        title: pair.previous.title,
        removed: true,
        blocks: pairDraftBlocks([], pair.previous.blocks),
      });
      continue;
    }
    sections.push({
      key: pair.current.id,
      title: pair.current.title,
      removed: false,
      blocks: pairDraftBlocks(pair.current.blocks, pair.previous?.blocks ?? []),
    });
  }
  return sections;
}

interface RedlineOp {
  readonly key: string;
  readonly kind: "equal" | "insert" | "delete";
  readonly text: string;
}

/** How much of a line a word-level alignment must preserve before it is worth showing. */
export const REDLINE_MIN_RETENTION = 0.5;
/** Below two separate edit regions the alignment already reads as one clean replacement. */
export const REDLINE_MIN_EDIT_REGIONS = 2;

/**
 * Non-whitespace characters. Word tokenisation leaves nearly every space in an `equal` op,
 * so counting whitespace would make every alignment look far better preserved than it is.
 */
function inkLength(text: string): number {
  return text.replace(/\s+/gu, "").length;
}

export interface RedlineShape {
  /** Maximal runs of insert/delete ops, uninterrupted by an `equal` op carrying any ink. */
  readonly editRegions: number;
  /** Share of the longer version's ink characters that survived the revision, 0…1. */
  readonly retention: number;
}

/** A pure read of how fragmented a word-level alignment is. Deterministic in the ops alone. */
export function redlineShape(ops: readonly DiffOp[]): RedlineShape {
  let equalInk = 0;
  let previousInk = 0;
  let nextInk = 0;
  let editRegions = 0;
  let insideRegion = false;

  for (const op of ops) {
    const ink = inkLength(op.text);
    if (op.kind === "equal") {
      equalInk += ink;
      previousInk += ink;
      nextInk += ink;
      if (ink > 0) insideRegion = false;
      continue;
    }
    if (op.kind === "delete") previousInk += ink;
    else nextInk += ink;
    if (ink > 0 && !insideRegion) {
      editRegions += 1;
      insideRegion = true;
    }
  }

  const longest = Math.max(previousInk, nextInk);
  return { editRegions, retention: longest === 0 ? 1 : equalInk / longest };
}

/**
 * A rewritten sentence aligns into interleaved scraps that read worse than either version
 * alone, so past a fragmentation threshold the line is marked up the way a proof-reader would:
 * strike the old sentence whole, write the new one under it. Returns the input unchanged —
 * by identity, so the caller can tell — whenever the word-level marks still carry meaning.
 */
export function collapseFragmentedRedline(ops: readonly DiffOp[]): readonly DiffOp[] {
  const shape = redlineShape(ops);
  if (shape.editRegions < REDLINE_MIN_EDIT_REGIONS || shape.retention >= REDLINE_MIN_RETENTION) {
    return ops;
  }

  let previousText = "";
  let nextText = "";
  for (const op of ops) {
    if (op.kind !== "insert") previousText += op.text;
    if (op.kind !== "delete") nextText += op.text;
  }

  const collapsed: DiffOp[] = [];
  if (previousText !== "") collapsed.push({ kind: "delete", text: previousText });
  if (nextText !== "") collapsed.push({ kind: "insert", text: nextText });
  return collapsed;
}

/**
 * The marked-up reading view of one draft line. A null `previousText` means the line is new,
 * so the redline marks all of it as an insertion. The alignment is memoised on this line's own
 * two texts: typing in one line must not re-diff the rest of the sheet.
 */
function BlockRedline({
  previousText,
  text,
  showChanges,
}: {
  readonly previousText: string | null;
  readonly text: string;
  readonly showChanges: boolean;
}) {
  const redline = useMemo<{
    readonly replaced: boolean;
    readonly ops: readonly RedlineOp[];
  } | null>(() => {
    if (!showChanges) return null;
    const aligned = diffWords(previousText ?? "", text);
    const marks = collapseFragmentedRedline(aligned);
    let offset = 0;
    return {
      replaced: marks !== aligned,
      ops: marks.map((op) => {
        const key = `${op.kind}-${offset}`;
        offset += op.text.length;
        return { key, kind: op.kind, text: op.text };
      }),
    };
  }, [previousText, showChanges, text]);

  if (redline === null) return text;
  const marks = redline.ops.map((op) =>
    op.kind === "equal" ? (
      <span key={op.key}>{op.text}</span>
    ) : op.kind === "insert" ? (
      <ins className="redline-ins" key={op.key}>
        {op.text}
      </ins>
    ) : (
      <del className="redline-del" key={op.key}>
        {op.text}
      </del>
    ),
  );
  // A whole-line replacement is set as two stacked lines, so each version still reads as a
  // sentence instead of as one run-on paragraph.
  if (redline.replaced) return <span className="redline-replacement">{marks}</span>;
  return <>{marks}</>;
}

/** One unresolved finding, tied to the draft line whose wording it judges. */
interface MarginNote {
  readonly finding: ReviewFinding;
  readonly blockId: string;
}

/** Where each margin note sits beside the paper, once the sheet has been measured. */
interface MarginNotePlacement {
  /** Note top, in pixels from the top of the paper, after collision avoidance. */
  readonly tops: ReadonlyMap<string, number>;
  /** The line the note actually judges, so a pushed note keeps a slanted connector. */
  readonly anchors: ReadonlyMap<string, number>;
  /** Notes pushed clear off the foot of the page; they collapse into the "more" affordance. */
  readonly overflow: readonly string[];
  /** Foot of the lowest placed note, so the margin column can be given a real height. */
  readonly contentBottom: number;
}

interface MarginNoteLayout extends MarginNotePlacement {
  readonly columnHeight: number;
}

/** Clear space between two stacked notes. */
const MARGIN_NOTE_GUTTER = 10;
/** Space kept free at the foot of the margin for the "+N more" affordance. */
const MARGIN_MORE_RESERVE = 44;
/** Where the connector meets the note, measured from the note's own top edge. */
const MARGIN_NOTE_ATTACH = 13;

interface MarginNoteBox {
  readonly id: string;
  readonly anchor: number;
  readonly height: number;
}

/**
 * Stacks the notes down the margin. A note sits beside its own line whenever there is room;
 * otherwise it is pushed just clear of the note above, and its connector slants to say so.
 * A note may hang past the foot of the paper, the way marginalia does; a note pushed so far
 * that it no longer starts beside any line is reported as overflow instead.
 */
export function placeMarginNotes(
  boxes: readonly MarginNoteBox[],
  available: number,
): MarginNotePlacement {
  const ordered = [...boxes].sort((left, right) => left.anchor - right.anchor);
  const tops = new Map<string, number>();
  const anchors = new Map<string, number>();
  const overflow: string[] = [];
  let cursor = 0;
  let contentBottom = 0;
  let spilled = false;

  for (const box of ordered) {
    const top = Math.max(box.anchor, cursor);
    if (spilled || top > available) {
      spilled = true;
      overflow.push(box.id);
      continue;
    }
    tops.set(box.id, top);
    anchors.set(box.id, box.anchor);
    contentBottom = Math.max(contentBottom, top + box.height);
    cursor = top + box.height + MARGIN_NOTE_GUTTER;
  }

  return { tops, anchors, overflow, contentBottom };
}

function sameMarginLayout(left: MarginNoteLayout | null, right: MarginNoteLayout): boolean {
  if (left === null) return false;
  if (left.tops.size !== right.tops.size) return false;
  if (left.columnHeight !== right.columnHeight) return false;
  if (left.overflow.length !== right.overflow.length) return false;
  if (left.overflow.some((id, index) => right.overflow[index] !== id)) return false;
  for (const [id, top] of right.tops) {
    if (left.tops.get(id) !== top) return false;
    if (left.anchors.get(id) !== right.anchors.get(id)) return false;
  }
  return true;
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
  const overrideInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [linkedClaimId, setLinkedClaimId] = useState<string | null>(null);
  const draftBlockRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const draftBlockShellRefs = useRef(new Map<string, HTMLDivElement>());
  // The margin: findings drawn beside the line they judge, the way a proof-reader marks a
  // manuscript. Position is measured, never guessed, so a note never drifts off its sentence.
  const sheetRef = useRef<HTMLElement | null>(null);
  const marginColumnRef = useRef<HTMLDivElement | null>(null);
  const marginNoteRefs = useRef(new Map<string, HTMLLIElement>());
  const [marginLayout, setMarginLayout] = useState<MarginNoteLayout | null>(null);
  // Which finding the reviewer is pointing at, wherever they are pointing at it from.
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const queueFocusRequest = useRef<{
    readonly findingId: string;
    readonly target: "summary" | "override";
  } | null>(null);
  // A draft line is a two-state cell: a marked-up reading view, or the editor. Only one line
  // is open at a time, and which one is session-local UI state, not part of the run.
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftView, setDraftView] = useState<"changes" | "full">("changes");
  const [compareOpen, setCompareOpen] = useState(false);
  // Which draft lines this reviewer changed in this session. Session-local UI
  // state: it says what a signature would cover, and is not part of the run.
  const [editedBlockIds, setEditedBlockIds] = useState<ReadonlySet<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  // The command palette: every action in this workspace reachable by name, with the reason
  // written on any action that cannot run yet.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteDialogRef = useRef<HTMLDivElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  // Where a palette command wants focus to land. Applied after the palette has returned focus
  // to wherever the reviewer was, so the destination wins.
  const paletteFocusRequest = useRef<HTMLElement | null>(null);
  const traceabilityRef = useRef<HTMLDetailsElement | null>(null);
  const traceabilitySummaryRef = useRef<HTMLElement | null>(null);
  const reviewColumnRef = useRef<HTMLElement | null>(null);
  const findingQueueRef = useRef<HTMLElement | null>(null);
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
  const hasPreviousArtifact = state.previousArtifact !== null;
  // Nothing to compare against on a first version, so the redline is unavailable, not empty.
  const showChanges = hasPreviousArtifact && draftView === "changes";
  const compareVisible = hasPreviousArtifact && compareOpen;
  const draftSections = useMemo(
    () => pairDraftSections(state.artifact, state.previousArtifact),
    [state.artifact, state.previousArtifact],
  );
  // A finding earns a place in the margin only when it names a claim that resolves to a line
  // on the page. Everything else stays in the queue, which remains the complete list.
  const marginNotes = useMemo<readonly MarginNote[]>(() => {
    const notes: MarginNote[] = [];
    for (const finding of state.findings) {
      if (!isUnresolvedFinding(finding) || finding.claimId === undefined) continue;
      const blockId = claimBlockId(state.artifact, finding.claimId);
      if (blockId === null) continue;
      notes.push({ finding, blockId });
    }
    return notes;
  }, [state.artifact, state.findings]);
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
    // `reviewComplete` measures that a critique finished, not that it was
    // independent. Calling it "independent" here would restate the over-claim
    // the trust strip was corrected to avoid: an overridden shared-lineage run
    // completes a critique that was, by its own record, not independent.
    { id: "critique", label: "Critique completed", met: state.reviewComplete },
    {
      id: "independence",
      label: independenceGateLabel(state.providerExposure.independentReview),
      met: state.providerExposure.independentReview?.lineagesDistinct === true,
    },
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
  // Independence is what the run recorded, never something this renderer infers.
  const independence = independenceSummary(state.providerExposure.independentReview);

  useEffect(() => {
    const nextContext = `${state.workspaceId}:${state.runId}`;
    if (findingQueueContext.current === nextContext) return;

    findingQueueContext.current = nextContext;
    previousNeedsActionCount.current = queueCounts.needsAction;
    const nextQueueState = initialFindingQueueState(state.findings);
    setFindingFilter(nextQueueState.filter);
    setExpandedFindingId(nextQueueState.expandedFindingId);
    setOverrideEditingFindingId(null);
    setEditedBlockIds(new Set());
    setEditingBlockId(null);
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

  // A draft line takes exactly the height of its own text, so the sheet shows
  // no blank filler under a short summary.
  const draftBlockText = state.artifact.sections
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\u001f");

  useSheetLayoutEffect(() => {
    for (const textarea of draftBlockRefs.current.values()) {
      // A hidden editor has no layout to measure; it is sized when its line opens.
      if (textarea.hidden) continue;
      textarea.style.height = "auto";
      // These boxes are border-box, and scrollHeight excludes the border.
      const frame = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + frame}px`;
    }
  }, [draftBlockText, editingBlockId]);

  // Opening a line moves the caret into it, however the line was opened.
  useEffect(() => {
    if (editingBlockId === null) return;
    draftBlockRefs.current.get(editingBlockId)?.focus();
  }, [editingBlockId]);

  // The margin is measured, not laid out by the flow: a note has to line up with a sentence
  // inside the paper, and only the browser knows where that sentence ended up.
  useSheetLayoutEffect(() => {
    const sheet = sheetRef.current;
    const column = marginColumnRef.current;
    if (sheet === null || column === null || marginNotes.length === 0) {
      setMarginLayout(null);
      return undefined;
    }

    const measure = (): void => {
      // Below the narrow breakpoint the margin is removed altogether and the queue is the
      // only view of findings, so there is nothing to place.
      if (column.offsetParent === null) {
        setMarginLayout(null);
        return;
      }
      const sheetTop = sheet.getBoundingClientRect().top;
      const boxes: MarginNoteBox[] = [];
      for (const note of marginNotes) {
        const shell = draftBlockShellRefs.current.get(note.blockId);
        const element = marginNoteRefs.current.get(note.finding.id);
        if (shell === undefined || element === undefined) continue;
        boxes.push({
          id: note.finding.id,
          anchor: shell.getBoundingClientRect().top - sheetTop,
          height: element.offsetHeight,
        });
      }

      const height = sheet.offsetHeight;
      const placement = placeMarginNotes(boxes, height);
      // The margin grows to hold its notes, so a short page still shows them beside the
      // sentence; only once something has spilled is room kept for the "more" affordance.
      const next: MarginNoteLayout = {
        ...placement,
        columnHeight: Math.max(
          height,
          placement.contentBottom + (placement.overflow.length > 0 ? MARGIN_MORE_RESERVE : 0),
        ),
      };
      setMarginLayout((current) => (sameMarginLayout(current, next) ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    observer.observe(column);
    return () => observer.disconnect();
  }, [compareVisible, draftBlockText, editingBlockId, editedBlockIds, marginNotes, showChanges]);

  // Reaching the queue from the margin: the row is expanded first, then focused, because the
  // control being focused may only have been rendered by that expansion.
  useEffect(() => {
    const request = queueFocusRequest.current;
    if (request === null) return;
    const element =
      request.target === "override"
        ? overrideInputRefs.current.get(request.findingId)
        : findingSummaryButtonRefs.current.get(request.findingId);
    if (element === undefined) return;
    queueFocusRequest.current = null;
    element.scrollIntoView({ block: "nearest" });
    element.focus();
  });

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

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  useModalFocusTrap(settingsOpen, settingsDialogRef, closeSettings);
  useModalFocusTrap(paletteOpen, paletteDialogRef, closePalette);

  const submitUrl = (target: "evidence" | "job-description"): void => {
    const value = target === "job-description" ? jobUrl.trim() : evidenceUrl.trim();
    if (value === "" || onAddUrl === undefined) return;
    onAddUrl(target, value);
    if (target === "job-description") setJobUrl("");
    else setEvidenceUrl("");
  };

  // The margin and the queue are two views of one set of objects, so every route into a
  // finding runs through the same three calls and lands the reviewer in the same place.
  const revealFindingInQueue = useCallback(
    (findingId: string, target: "summary" | "override" = "summary"): void => {
      const visible = filterFindingQueue(state.findings, findingFilter).some(
        (finding) => finding.id === findingId,
      );
      if (!visible) setFindingFilter("needs-action");
      setExpandedFindingId(findingId);
      setActiveFindingId(findingId);
      queueFocusRequest.current = { findingId, target };
    },
    [findingFilter, state.findings],
  );

  // One decision path for both views: the same action, the same "advance to the next
  // actionable finding" bookkeeping, whichever control the reviewer reached for.
  const decideFinding = useCallback(
    (findingId: string, decision: Exclude<FindingDecision, "pending" | "overridden">): void => {
      findingDecisionRequest.current = { findingId, decision };
      onAction({ type: "finding-decision", findingId, decision });
    },
    [onAction],
  );

  const beginOverride = useCallback((finding: ReviewFinding): void => {
    setOverrideReasons((current) =>
      current[finding.id] === undefined
        ? { ...current, [finding.id]: finding.rationale ?? "" }
        : current,
    );
    setOverrideEditingFindingId(finding.id);
  }, []);

  // The palette belongs to a run: before one exists there is no draft, no queue and no
  // traceability, and a list of commands that cannot run is not a command list.
  const paletteAvailable = state.state !== "collecting";

  const openPalette = useCallback((): void => {
    setPaletteQuery("");
    setPaletteOpen(true);
  }, []);

  const openTraceability = (): void => {
    const details = traceabilityRef.current;
    if (details === null) return;
    details.open = true;
    const summary = traceabilitySummaryRef.current;
    summary?.scrollIntoView({ block: "center" });
    summary?.focus();
  };

  // Triage from the keyboard. The bare letters act on the finding the queue is on; the
  // artifact gate keeps its Alt chords, so approving is never one keystroke away.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || paletteOpen) return;
      const target = event.target as HTMLElement | null;

      // Escape leaves the override editor even from inside its own input: that is the one
      // place a reviewer is typing and still expects a key to answer.
      if (event.key === "Escape" && overrideEditingFindingId !== null) {
        event.preventDefault();
        const editingFindingId = overrideEditingFindingId;
        setOverrideEditingFindingId(null);
        findingSummaryButtonRefs.current.get(editingFindingId)?.focus();
        return;
      }

      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true ||
        editingBlockId !== null;
      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        if (!paletteAvailable) return;
        event.preventDefault();
        openPalette();
        return;
      }

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
        return;
      }

      // A half-typed rationale owns the queue until it is saved or abandoned.
      if (event.ctrlKey || event.shiftKey || overrideEditingFindingId !== null) return;

      const queue = filterFindingQueue(state.findings, findingFilter);
      if (queue.length === 0) return;
      const active = document.activeElement;
      const focusedId =
        queue.find((finding) => findingSummaryButtonRefs.current.get(finding.id) === active)?.id ??
        null;
      // Selection follows the expanded row, and falls back to the summary button that holds
      // focus, so a row collapsed with Enter can still be decided where it stands.
      const currentId =
        expandedFindingId !== null && queue.some((finding) => finding.id === expandedFindingId)
          ? expandedFindingId
          : focusedId;
      const currentIndex =
        currentId === null ? -1 : queue.findIndex((finding) => finding.id === currentId);

      const step = (delta: number): void => {
        const nextIndex =
          currentIndex === -1
            ? delta > 0
              ? 0
              : queue.length - 1
            : Math.min(queue.length - 1, Math.max(0, currentIndex + delta));
        const next = queue[nextIndex];
        if (next === undefined) return;
        setExpandedFindingId(next.id);
        setActiveFindingId(next.id);
        setLinkedClaimId(next.claimId ?? null);
        const button = findingSummaryButtonRefs.current.get(next.id);
        button?.scrollIntoView({ block: "nearest" });
        button?.focus();
      };

      if (event.key === "j" || event.key === "J" || event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === "k" || event.key === "K" || event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key === "Enter") {
        // A focused control already answers Enter itself; only the page-level case is ours.
        const nativeTarget =
          target?.tagName === "BUTTON" || target?.tagName === "A" || target?.tagName === "SUMMARY";
        if (nativeTarget || currentId === null) return;
        event.preventDefault();
        setExpandedFindingId((current) => (current === currentId ? null : currentId));
        findingSummaryButtonRefs.current.get(currentId)?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (expandedFindingId === null) return;
        event.preventDefault();
        const collapsedId = expandedFindingId;
        setExpandedFindingId(null);
        findingSummaryButtonRefs.current.get(collapsedId)?.focus();
        return;
      }

      const finding = currentIndex === -1 ? undefined : queue[currentIndex];
      if (finding === undefined || findingDecisionPending) return;

      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        beginOverride(finding);
        revealFindingInQueue(finding.id, "override");
        return;
      }
      const decision = findingDecisionKeys[event.key.toLowerCase()];
      if (decision === undefined) return;
      event.preventDefault();
      decideFinding(finding.id, decision);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    beginOverride,
    canApprove,
    canExport,
    decideFinding,
    editingBlockId,
    expandedFindingId,
    findingDecisionPending,
    findingFilter,
    onAction,
    openPalette,
    overrideEditingFindingId,
    paletteAvailable,
    paletteOpen,
    revealFindingInQueue,
    settingsOpen,
    state.findings,
    state.reviewComplete,
    state.state,
    transmissionReady,
  ]);

  // A palette command that moves focus lands after the dialog has handed focus back to
  // wherever the reviewer was, so the destination wins over the restore.
  useEffect(() => {
    const target = paletteFocusRequest.current;
    if (target === null) return;
    paletteFocusRequest.current = null;
    target.scrollIntoView({ block: "start" });
    target.focus();
  });

  const pendingActionReason =
    pendingReviewAction === null ? null : "Another review action is already running.";
  const revisionReason = !hasArtifact
    ? "No draft artifact available yet."
    : !state.reviewComplete
      ? "Independent critique has not completed."
      : state.state !== "awaiting-approval"
        ? `The run is ${stateLabel(state.state)}, not awaiting approval.`
        : !transmissionReady
          ? "Provider transmission has not been acknowledged."
          : pendingActionReason;
  const comparisonReason = hasPreviousArtifact
    ? null
    : "There is no previous version to compare with.";
  const paletteCommands: readonly PaletteCommand[] = [
    {
      id: "approve",
      label: "Approve artifact",
      note: "Alt+A",
      disabledReason: !hasArtifact
        ? "No draft artifact available yet."
        : !state.reviewComplete
          ? "Independent critique has not completed."
          : blockingFindings.length > 0
            ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? " still needs" : "s still need"} a decision.`
            : state.state !== "awaiting-approval"
              ? `The run is ${stateLabel(state.state)}, not awaiting approval.`
              : pendingActionReason,
      run: () => onAction({ type: "approve" }),
    },
    {
      id: "request-revision",
      label: "Request revision",
      note: "Alt+R",
      disabledReason: revisionReason,
      run: () => onAction({ type: "request-revision" }),
    },
    {
      id: "export",
      label: "Export Markdown",
      note: "Alt+E",
      disabledReason: canExport
        ? null
        : !state.reviewComplete
          ? "Independent critique has not completed."
          : state.state !== "approved"
            ? "The artifact has not been approved."
            : (pendingActionReason ?? "Export is unavailable right now."),
      run: () => onAction({ type: "export" }),
    },
    {
      id: "resume",
      label: "Resume",
      note: "Continue this run from its durable step",
      disabledReason:
        state.execution.status !== "interrupted" && state.state !== "paused"
          ? "This run is neither paused nor interrupted."
          : !transmissionReady
            ? "Provider transmission has not been acknowledged."
            : pendingActionReason,
      run: () => onAction({ type: "resume" }),
    },
    {
      id: "stop",
      label: "Stop",
      note: "End this run without losing its history",
      disabledReason:
        state.execution.status !== "running" && state.execution.status !== "interrupted"
          ? "Nothing is running to stop."
          : pendingActionReason,
      run: () => onAction({ type: "stop" }),
    },
    {
      id: "start",
      label: "Start a new review",
      note: "Run the author–critic loop again",
      disabledReason:
        state.state !== "stopped"
          ? "A review is already under way."
          : !transmissionReady
            ? "Provider transmission has not been acknowledged."
            : pendingActionReason,
      run: () => onAction({ type: "start" }),
    },
    {
      id: "draft-view",
      label: showChanges ? "Read the full draft" : "Read changes only",
      note: showChanges
        ? "Drop the change marks and read the draft as it stands"
        : "Mark every word that changed since the previous version",
      disabledReason: comparisonReason,
      run: () => setDraftView(showChanges ? "full" : "changes"),
    },
    {
      id: "compare",
      label:
        state.previousArtifact === null
          ? "Compare with the previous version"
          : `Compare with v${state.previousArtifact.version}`,
      note: compareVisible
        ? "Close the previous version beside the draft"
        : "Open the previous version beside the draft",
      disabledReason: comparisonReason,
      run: () => setCompareOpen((current) => !current),
    },
    {
      id: "sources",
      label: "Open claim traceability",
      note: "Show where each claim's wording came from",
      disabledReason: null,
      run: () => openTraceability(),
    },
    {
      id: "keys",
      label: "Open provider API keys",
      note: "Manage the Anthropic and OpenAI credentials",
      disabledReason: null,
      run: () => setSettingsOpen(true),
    },
    {
      id: "go-draft",
      label: "Go to the draft",
      note: "Move to the document under review",
      disabledReason: null,
      run: () => {
        paletteFocusRequest.current = reviewColumnRef.current;
      },
    },
    {
      id: "go-findings",
      label: "Go to the findings queue",
      note: "Move to critique triage",
      disabledReason: null,
      run: () => {
        const first = filteredFindings[0];
        const summary =
          first === undefined ? undefined : findingSummaryButtonRefs.current.get(first.id);
        paletteFocusRequest.current = summary ?? findingQueueRef.current;
      },
    },
  ];
  const paletteMatches = matchPaletteCommands(paletteCommands, paletteQuery);

  const runPaletteCommand = (command: PaletteCommand): void => {
    if (command.disabledReason !== null) return;
    command.run();
    setPaletteOpen(false);
  };

  const focusPaletteCommand = (index: number): void => {
    const elements = Array.from(
      paletteDialogRef.current?.querySelectorAll<HTMLButtonElement>(".palette-command") ?? [],
    );
    if (elements.length === 0) return;
    elements[Math.min(elements.length - 1, Math.max(0, index))]?.focus();
  };

  // One critique finding, written beside the sentence it judges. The four decision controls
  // dispatch exactly what the queue dispatches; Override hands off to the queue, which is
  // where the required rationale is typed.
  const renderMarginNote = (note: MarginNote) => {
    const finding = note.finding;
    const top = marginLayout?.tops.get(finding.id);
    const anchor = marginLayout?.anchors.get(finding.id);
    const hidden = marginLayout !== null && top === undefined;
    const active = activeFindingId === finding.id || expandedFindingId === finding.id;
    const highlight = () => {
      setActiveFindingId(finding.id);
      setLinkedClaimId(finding.claimId ?? null);
    };
    const clearHighlight = () => {
      setActiveFindingId((current) => (current === finding.id ? null : current));
      setLinkedClaimId(null);
    };

    return (
      <li
        className={`margin-note margin-note-${finding.severity}${active ? " margin-note-active" : ""}${
          hidden ? " margin-note-spilled" : ""
        }`}
        key={finding.id}
        {...(top === undefined ? {} : { style: { top: `${top}px` } })}
        ref={(element) => {
          if (element === null) marginNoteRefs.current.delete(finding.id);
          else marginNoteRefs.current.set(finding.id, element);
        }}
      >
        {top === undefined || anchor === undefined ? null : (
          <span
            className="margin-note-elbow"
            aria-hidden="true"
            style={{
              top: `${anchor - top}px`,
              height: `${Math.max(0, MARGIN_NOTE_ATTACH - (anchor - top))}px`,
            }}
          />
        )}
        <button
          className="margin-note-head"
          type="button"
          onClick={() => revealFindingInQueue(finding.id)}
          onMouseEnter={highlight}
          onMouseLeave={clearHighlight}
          onFocus={highlight}
          onBlur={clearHighlight}
        >
          <span className="margin-note-kind">
            <span className="margin-note-severity">
              {finding.severity === "error" ? "Blocking" : "Warning"}
            </span>
            <span className="margin-note-category">{finding.category}</span>
          </span>
          <span className="margin-note-message">{finding.message}</span>
        </button>
        <span className="margin-note-actions">
          {directFindingDecisions.map((decision) => (
            <button
              className="margin-note-action"
              type="button"
              key={decision}
              disabled={findingDecisionPending}
              onFocus={highlight}
              onBlur={clearHighlight}
              onClick={() => decideFinding(finding.id, decision)}
            >
              {decisionLabels[decision]}
            </button>
          ))}
          <button
            className="margin-note-action"
            type="button"
            disabled={findingDecisionPending}
            onFocus={highlight}
            onBlur={clearHighlight}
            onClick={() => {
              beginOverride(finding);
              revealFindingInQueue(finding.id, "override");
            }}
          >
            Override
          </button>
        </span>
      </li>
    );
  };

  // One draft line on the sheet. The reading view carries the marks; the editor is present in
  // the markup at all times and revealed when the line is opened, so the line keeps its label.
  const renderDraftBlock = (sectionTitle: string, pair: DraftBlockPair) => {
    const block = pair.block;
    if (block === null) {
      return (
        <div className="editable-block editable-block-removed" key={pair.key}>
          <div className="block-view block-view-removed">
            <del className="redline-del">{pair.text}</del>
          </div>
        </div>
      );
    }

    const sourceState = blockSourceState(block, claimById);
    const isLinked = linkedClaimId !== null && block.claimIds.includes(linkedClaimId);
    const isEditing = editingBlockId === block.id;
    const isEdited = editedBlockIds.has(block.id);
    const highlightClaim = () => setLinkedClaimId(block.claimIds[0] ?? null);
    const openLine = () => {
      highlightClaim();
      setEditingBlockId(block.id);
    };

    return (
      <div
        className={`editable-block editable-block-${sourceState}${
          isLinked ? " editable-block-linked" : ""
        }`}
        key={pair.key}
        ref={(element) => {
          if (element === null) draftBlockShellRefs.current.delete(block.id);
          else draftBlockShellRefs.current.set(block.id, element);
        }}
      >
        {sourceState === "unsourced" || isEdited ? (
          <span className="block-margin">
            {sourceState === "unsourced" ? (
              <span className="block-margin-dot" aria-hidden="true" />
            ) : null}
            {isEdited ? <span className="block-edited-flag">edited</span> : null}
          </span>
        ) : null}
        <div className="block-view" hidden={isEditing}>
          <BlockRedline
            previousText={pair.previousText}
            showChanges={showChanges}
            text={block.text}
          />
        </div>
        {/* The whole line is the affordance. A real control carries the keyboard and pointer
            behaviour, which leaves the marked-up text above it as ordinary document text: a
            button labelled with the line would have flattened the change marks away. */}
        <button
          className="block-open"
          type="button"
          aria-label={`Edit ${sectionTitle} text`}
          title={`Edit ${sectionTitle} text`}
          hidden={isEditing}
          onClick={openLine}
          onFocus={openLine}
          onMouseEnter={highlightClaim}
          onMouseLeave={() => setLinkedClaimId(null)}
        />
        {sourceState === "none" ? null : (
          <span className="sr-only">
            {sourceState === "sourced" ? "source linked" : "not linked to candidate materials"}
          </span>
        )}
        <textarea
          aria-label={`Edit ${sectionTitle}`}
          hidden={!isEditing}
          value={block.text}
          // One row is the floor; the layout effect grows it to its text.
          rows={1}
          ref={(element) => {
            if (element === null) draftBlockRefs.current.delete(block.id);
            else draftBlockRefs.current.set(block.id, element);
          }}
          onFocus={highlightClaim}
          onBlur={() => {
            setLinkedClaimId(null);
            setEditingBlockId((current) => (current === block.id ? null : current));
          }}
          onMouseEnter={highlightClaim}
          onMouseLeave={() => setLinkedClaimId(null)}
          onChange={(event) => {
            setEditedBlockIds((current) =>
              current.has(block.id) ? current : new Set(current).add(block.id),
            );
            onAction({
              type: "edit-block",
              blockId: block.id,
              text: event.target.value,
            });
          }}
        />
      </div>
    );
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

  // Every action of this workspace, reachable by its name. A command that cannot run stays in
  // the list and says why, because "the button is missing" is not an explanation.
  const renderCommandPalette = () => {
    if (!paletteOpen) return null;
    return (
      <div className="modal-backdrop">
        <div
          className="modal-card palette-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-palette-title"
          ref={paletteDialogRef}
        >
          <div className="palette-header">
            <h2 id="command-palette-title">Commands</h2>
            <span className="subtle">
              Type to narrow · ↑↓ to move · Enter to run · Esc to close
            </span>
          </div>
          <label className="palette-search">
            <span className="sr-only">Filter commands</span>
            <input
              className="url-input palette-input"
              type="text"
              placeholder="Search commands…"
              value={paletteQuery}
              autoComplete="off"
              spellCheck={false}
              ref={paletteInputRef}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusPaletteCommand(0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusPaletteCommand(paletteMatches.length - 1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const first = paletteMatches[0];
                  if (first !== undefined) runPaletteCommand(first);
                }
              }}
            />
          </label>
          {paletteMatches.length === 0 ? (
            <p className="palette-empty" role="status">
              No command matches that search.
            </p>
          ) : (
            <ul className="palette-list">
              {paletteMatches.map((command, index) => (
                <li key={command.id}>
                  <button
                    className="palette-command"
                    type="button"
                    aria-disabled={command.disabledReason !== null}
                    onClick={() => runPaletteCommand(command)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        focusPaletteCommand(index + 1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        if (index === 0) paletteInputRef.current?.focus();
                        else focusPaletteCommand(index - 1);
                      }
                    }}
                  >
                    <span className="palette-command-label">{command.label}</span>
                    <span className="palette-command-note">
                      {command.disabledReason ?? command.note}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
        <SideRail onOpenSources={null} onOpenSettings={() => setSettingsOpen(true)} />
        <main className="app-shell app-shell-single">
          {renderSettingsModal()}
          <div className="main-column">
            <header className="spine">
              <div className="spine-identity">
                <h1 title={state.workspaceId}>{state.workspaceId}</h1>
                <div className="spine-identity-meta">
                  <span className="state-pill state-collecting">Collecting inputs</span>
                </div>
              </div>
              <div className="spine-loop" />
            </header>
            <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
              <p className="eyebrow">Before the first run</p>
              <h2 id="onboarding-title">Bring your source material into the loop</h2>
              <p className="onboarding-copy">
                Add the sources DraftLoop is allowed to use. Your files stay in this workspace.
                DraftLoop will not invent missing experience or start an agent run until the target
                job and candidate source material are present.
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
      <SideRail onOpenSources={openTraceability} onOpenSettings={() => setSettingsOpen(true)} />
      <main className="app-shell">
        {renderSettingsModal()}
        {renderCommandPalette()}
        <div className="main-column">
          <header className="spine">
            <div className="spine-identity">
              <h1 title={state.workspaceId}>{state.workspaceId}</h1>
              <div className="spine-identity-meta">
                <span className={`state-pill state-${state.state}`}>{stateLabel(state.state)}</span>
                <span className="meta-chip">Round {state.round}</span>
              </div>
            </div>
            <div className="spine-loop">
              <LoopRail activeIndex={loopStageIndex(state)} round={state.round} />
            </div>
            <div className="spine-meta">
              <div className="spine-versions">
                {state.previousArtifact === null ? null : (
                  <span className="spine-version">v{state.previousArtifact.version}</span>
                )}
                <span className="spine-version spine-version-current">
                  v{state.artifact.version}
                </span>
              </div>
              <div className="spine-cost">
                <span className="numeric">
                  ${state.totalCostUsd.toFixed(3)}
                  {state.budgetUsd === null ? "" : ` / $${state.budgetUsd.toFixed(2)}`}
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
          </header>

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

          {/* A jump target, so "go to the draft" can land focus here and not only scroll. */}
          <section
            className="review-column"
            aria-label="artifact review"
            id="artifact-review"
            tabIndex={-1}
            ref={reviewColumnRef}
          >
            <div className="doc-toolbar">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Draft under review</p>
                  <h2>Version {state.artifact.version}</h2>
                </div>
              </div>
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
              <div className="doc-toolbar-views">
                <fieldset className="view-toggle">
                  <legend className="sr-only">Draft view</legend>
                  <button
                    className="view-toggle-option"
                    type="button"
                    aria-pressed={showChanges}
                    disabled={!hasPreviousArtifact}
                    title={
                      hasPreviousArtifact
                        ? "Mark every word that changed since the previous version"
                        : "There is no previous version to compare with."
                    }
                    onClick={() => setDraftView("changes")}
                  >
                    Changes only
                  </button>
                  <button
                    className="view-toggle-option"
                    type="button"
                    aria-pressed={!showChanges}
                    title="Read the draft as it stands, without change marks"
                    onClick={() => setDraftView("full")}
                  >
                    Full draft
                  </button>
                </fieldset>
                {state.previousArtifact === null ? (
                  <span className="empty-state doc-toolbar-empty">
                    This is the first artifact version.
                  </span>
                ) : (
                  <button
                    className="button button-quiet doc-compare-toggle"
                    type="button"
                    aria-pressed={compareVisible}
                    onClick={() => setCompareOpen((current) => !current)}
                  >
                    Compare with v{state.previousArtifact.version}
                  </button>
                )}
              </div>
              <span className="subtle doc-toolbar-note">
                Edits you make here are part of the artifact you approve.
              </span>
            </div>

            <div className={`doc-grid${compareVisible ? " doc-grid-compare" : ""}`}>
              {compareVisible && state.previousArtifact !== null ? (
                <div className="diff-column">
                  <div className="pane-heading">
                    <span>Previous version</span>
                    <span>v{state.previousArtifact.version}</span>
                  </div>
                  <article className="artifact-pane previous-pane">
                    {state.previousArtifact.sections.map((section) => (
                      <section className="artifact-section" key={section.id}>
                        <h3>{section.title}</h3>
                        {section.blocks.map((block) => (
                          <p className={block.type === "bullet" ? "bullet" : ""} key={block.id}>
                            {block.text}
                          </p>
                        ))}
                      </section>
                    ))}
                  </article>
                </div>
              ) : null}
              <div className="diff-column diff-column-current">
                <div className="pane-heading">
                  <span>Current draft</span>
                  <span>
                    v{state.artifact.version} · {showChanges ? "redline · editable" : "editable"}
                  </span>
                </div>
                {/* The sheet: the document itself, on the desk, with the critique written in
                    its right margin. The margin follows the paper in DOM order on purpose —
                    reading down the draft must not tab through five controls per finding
                    before reaching the next sentence. */}
                <div className="sheet-stage">
                  <article className="artifact-pane current-pane sheet" ref={sheetRef}>
                    {draftSections.map((section) => {
                      // The full draft is what stands now, so removed lines belong to the redline.
                      const blocks = showChanges
                        ? section.blocks
                        : section.blocks.filter((pair) => pair.block !== null);
                      if (blocks.length === 0) return null;
                      return (
                        <section
                          className={`artifact-section${
                            section.removed ? " artifact-section-removed" : ""
                          }`}
                          key={section.key}
                        >
                          <h3>{section.title}</h3>
                          {blocks.map((pair) => renderDraftBlock(section.title, pair))}
                        </section>
                      );
                    })}
                  </article>
                  <div
                    className="sheet-margin"
                    ref={marginColumnRef}
                    {...(marginLayout === null
                      ? {}
                      : { style: { height: `${marginLayout.columnHeight}px` } })}
                  >
                    <ul
                      className={`margin-notes${marginLayout === null ? "" : " margin-notes-placed"}`}
                      aria-label="Findings in the draft margin"
                    >
                      {marginNotes.map((note) => renderMarginNote(note))}
                    </ul>
                    {marginLayout !== null && marginLayout.overflow.length > 0 ? (
                      <button
                        className="margin-more"
                        type="button"
                        onClick={() => {
                          const first = marginLayout.overflow[0];
                          if (first !== undefined) revealFindingInQueue(first);
                        }}
                      >
                        +{marginLayout.overflow.length} more in the queue
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Traceability is an inspection, not a third copy of the draft: it stays one
                disclosure away, closed until a reviewer asks where wording came from. */}
            <section className="claims-panel" aria-label="claim to source inspection">
              <details className="claims-disclosure" ref={traceabilityRef}>
                <summary className="claims-disclosure-summary" ref={traceabilitySummaryRef}>
                  <span className="claims-disclosure-title">
                    <span className="eyebrow">Traceability</span>
                    <h2>Claims and candidate sources</h2>
                  </span>
                  <span className="subtle">
                    Source links show where wording came from; they do not independently verify it.
                  </span>
                </summary>
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
                                  draftBlockShellRefs.current
                                    .get(draftBlockId)
                                    ?.scrollIntoView({ block: "center", behavior: "smooth" });
                                  // Opening the line moves the caret into it.
                                  setEditingBlockId(draftBlockId);
                                  draftBlockRefs.current.get(draftBlockId)?.focus();
                                }}
                              >
                                <LinkIcon />
                                <span className="sr-only">
                                  Show the draft line for: {claim.text}
                                </span>
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
                            This claim is not linked to the candidate materials supplied to
                            DraftLoop.
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
              </details>
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

          <section className="trust-strip" aria-label="trust and policy summary">
            {/* The lineage qualifies the identity it belongs to, so it is read here
                with the company and the model rather than apart from them. */}
            <div className="trust-fact">
              <span className="label">Author</span>
              <strong>{state.providerExposure.author.company}</strong>
              <span>{state.providerExposure.author.model}</span>
              {state.providerExposure.independentReview === null ? null : (
                <span>
                  claimed lineage {state.providerExposure.independentReview.authorLineage}
                </span>
              )}
            </div>
            <div className="trust-fact">
              <span className="label">Critic</span>
              <strong>{state.providerExposure.critic.company}</strong>
              <span>{state.providerExposure.critic.model}</span>
              {state.providerExposure.independentReview === null ? null : (
                <span>
                  claimed lineage {state.providerExposure.independentReview.criticLineage}
                </span>
              )}
            </div>
            <div className={`trust-badge trust-badge-${independence.tone}`}>
              <span className="trust-badge-mark">{independence.mark}</span>
              <span>{independence.detail}</span>
            </div>
            {/* Operator prose, shown because a person about to approve has to weigh it.
                It is displayed locally and is never part of any provider request. */}
            {independence.overrideRationale === null ? null : (
              <div className="trust-override">
                <span className="trust-override-label">Override rationale</span>
                <p>{independence.overrideRationale}</p>
              </div>
            )}
            <div className="trust-fact">
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
            <div className="trust-fact">
              <span className="label">Evidence</span>
              <strong className="numeric">
                {state.setup.selectedEvidenceChunkCount} excerpt
                {state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"}
              </strong>
              <span>
                from {state.setup.selectedEvidenceSourceCount} source
                {state.setup.selectedEvidenceSourceCount === 1 ? "" : "s"}
              </span>
            </div>
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
              tabIndex={-1}
              ref={findingQueueRef}
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
                    }${activeFindingId === finding.id ? " finding-row-active" : ""}`}
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
                      onMouseEnter={() => {
                        setActiveFindingId(finding.id);
                        setLinkedClaimId(finding.claimId ?? null);
                      }}
                      onMouseLeave={() => {
                        setActiveFindingId((current) => (current === finding.id ? null : current));
                        setLinkedClaimId(null);
                      }}
                      onFocus={() => {
                        setActiveFindingId(finding.id);
                        setLinkedClaimId(finding.claimId ?? null);
                      }}
                      onBlur={() => {
                        setActiveFindingId((current) => (current === finding.id ? null : current));
                        setLinkedClaimId(null);
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
                              onClick={() => decideFinding(finding.id, decision)}
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
                            onClick={() => beginOverride(finding)}
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
                                ref={(element) => {
                                  if (element === null)
                                    overrideInputRefs.current.delete(finding.id);
                                  else overrideInputRefs.current.set(finding.id, element);
                                }}
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
            {/* The keys, written down. A shortcut nobody can see is a shortcut nobody uses. */}
            <footer className="finding-hints">
              <span className="finding-hint">
                <kbd>J</kbd>
                <kbd>K</kbd> move
              </span>
              <span className="finding-hint">
                <kbd>Enter</kbd> open
              </span>
              <span className="finding-hint">
                <kbd>A</kbd> accept
              </span>
              <span className="finding-hint">
                <kbd>R</kbd> reject
              </span>
              <span className="finding-hint">
                <kbd>D</kbd> defer
              </span>
              <span className="finding-hint">
                <kbd>O</kbd> override
              </span>
              <span className="finding-hint">
                <kbd>Esc</kbd> close
              </span>
              <button
                className="finding-hint finding-hint-command"
                type="button"
                aria-keyshortcuts="Control+K Meta+K"
                title="Open the command palette"
                onClick={openPalette}
              >
                <kbd>Ctrl/⌘</kbd>
                <kbd>K</kbd> commands
              </button>
            </footer>
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
            {editedBlockIds.size > 0 ? (
              <p className="gate-edit-note">
                Approving signs v{state.artifact.version} including {editedBlockIds.size} of your
                edit{editedBlockIds.size === 1 ? "" : "s"}.
              </p>
            ) : null}
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
