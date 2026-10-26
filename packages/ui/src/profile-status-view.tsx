/**
 * The status-first top of the Career profile page and the version facts kept under Details
 * (issue #1090). The status model itself lives in `profile-status.ts`.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CanonicalCandidateProfileRecordResult } from "./bridge.js";
import { type CareerEvidenceCapabilities, loadCareerEvidenceStatus } from "./career-evidence.js";
import type { DesktopProfileCapabilities } from "./native.js";
import { loadProfileFreshness } from "./profile-freshness.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";
import type { CanonicalCandidateProfileOutcome } from "./profile-outcome.js";
import { type ProfileStatus, profileApprovalText } from "./profile-status.js";

/** The status in words, then the one primary action; the action is passed in as children. */
export function ProfileStatusSummary({
  titleId,
  status,
  loading = false,
  selected = false,
  children,
}: {
  readonly titleId: string;
  readonly status: ProfileStatus;
  /** A saved profile is being read; the status is not known yet. */
  readonly loading?: boolean;
  /** The loaded version is the one new applications use. */
  readonly selected?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div className="profile-status-summary">
      <div className="section-heading compact">
        <h2 id={titleId}>Your career profile</h2>
        {selected ? <span className="state-pill state-approved">Used for applications</span> : null}
      </div>
      <p
        className={`profile-status-line profile-status-${loading ? "loading" : status.kind}`}
        data-status={loading ? "loading" : status.kind}
      >
        <strong className="profile-status-label">
          <span className="sr-only">Status: </span>
          {loading ? "Loading your profile…" : status.label}
        </strong>
        {loading ? null : <span className="profile-status-detail">{status.detail}</span>}
      </p>
      {children}
    </div>
  );
}

/** One approval checkbox beside the button that sends career evidence to the provider. */
export function ProfileGenerationAction({
  outcome,
  mode = "generate",
  profileIdValid,
  providerTransmissionApproved,
  busy,
  generating = false,
  sourceCount,
  providerName,
  fixtureMode = false,
  onApprovalChange,
  onDerive,
}: {
  readonly outcome: CanonicalCandidateProfileOutcome;
  /** Update when a profile already exists, so the button and approval say so. */
  readonly mode?: "generate" | "update";
  readonly profileIdValid: boolean;
  readonly providerTransmissionApproved: boolean;
  readonly busy: boolean;
  readonly generating?: boolean;
  readonly sourceCount?: number | undefined;
  readonly providerName?: string | undefined;
  /** A demo workspace: the approval says nothing is sent. */
  readonly fixtureMode?: boolean;
  readonly onApprovalChange: (approved: boolean) => void;
  readonly onDerive: () => void;
}) {
  const verb = mode === "update" ? "update" : "generate";
  return (
    <div className="profile-generation-action">
      <label className="profile-approval-label">
        {/* The approval a running generation was given stays shown until that generation ends. */}
        <input
          type="checkbox"
          checked={providerTransmissionApproved || generating}
          disabled={busy}
          onChange={(event) => onApprovalChange(event.target.checked)}
        />
        <span>{profileApprovalText({ mode, sourceCount, providerName, fixtureMode })}</span>
      </label>
      <button
        className="button button-primary"
        type="button"
        disabled={busy || !profileIdValid || !providerTransmissionApproved}
        onClick={onDerive}
      >
        {busy
          ? generating
            ? "Generating…"
            : "Working…"
          : outcome.retry
            ? "Retry profile generation"
            : mode === "update"
              ? "Update profile"
              : "Generate profile"}
      </button>
      {!busy && profileIdValid && !providerTransmissionApproved ? (
        <p className="profile-approval-hint">
          {outcome.retry
            ? "Tick the approval box to enable Retry."
            : `Tick the approval box to ${verb}.`}
        </p>
      ) : null}
    </div>
  );
}

/** The re-extract choice, kept under Details; it applies to the next generation or update. */
export function ProfileFullExtractionOption({
  checked,
  disabled,
  onChange,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (fullExtraction: boolean) => void;
}) {
  return (
    <label className="profile-approval-label">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Re-extract all sources</span>
    </label>
  );
}

function shortChecksum(checksum: string): string {
  return `${checksum.slice(0, 12)}…`;
}

/** Version facts for the loaded profile: shown under Details, never at the top of the page. */
export function ProfileVersionDetails({
  record,
  history,
}: {
  readonly record: CanonicalCandidateProfileRecordResult;
  readonly history: readonly CanonicalCandidateProfileRecordResult[];
}) {
  const historical = history.length > 0 && record.version !== history.at(-1)?.version;
  return (
    <>
      <dl className="profile-metadata">
        <div>
          <dt>Version</dt>
          <dd>{record.version}</dd>
        </div>
        <div>
          <dt>Parent</dt>
          <dd>{record.parentVersion === null ? "—" : record.parentVersion}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{record.status}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{record.createdAt}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{record.updatedAt}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>{record.reviewedAt ?? "—"}</dd>
        </div>
        <div>
          <dt>Checksum</dt>
          <dd title={record.checksum}>{shortChecksum(record.checksum)}</dd>
        </div>
      </dl>
      {historical ? (
        <p className="profile-note">Earlier versions cannot be edited.</p>
      ) : record.status === "reviewed" ? (
        <p className="profile-note">Reviewed versions cannot be edited.</p>
      ) : null}
    </>
  );
}

/** Every saved version of the loaded profile; choosing one loads it locally. */
export function ProfileVersionHistory({
  history,
  version,
  disabled,
  onChoose,
}: {
  readonly history: readonly CanonicalCandidateProfileRecordResult[];
  readonly version: number | null;
  readonly disabled: boolean;
  readonly onChoose: (version: number) => void;
}) {
  if (history.length === 0) return null;
  return (
    <label className="profile-history-label">
      <span>Version history</span>
      <select
        aria-label="Profile version"
        value={version ?? ""}
        disabled={disabled}
        onChange={(event) => onChoose(Number(event.target.value))}
      >
        {history.map((entry) => (
          <option key={entry.version} value={entry.version}>
            Version {entry.version} · {entry.status}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Whether the loaded reviewed profile is current with the career evidence. Asked only while
 * `profileId` is set, and again whenever `revision` changes; `undefined` while unknown.
 */
export function useProfileFreshness(
  capabilities: DesktopProfileCapabilities,
  workspaceId: string,
  profileId: string | null,
  revision: string,
): ProfileFreshnessResult | undefined {
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const key = profileId === null ? null : `${workspaceId}\u0000${profileId}\u0000${revision}`;
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly value: ProfileFreshnessResult | undefined;
  } | null>(null);
  useEffect(() => {
    if (key === null || profileId === null) return;
    let active = true;
    void loadProfileFreshness(capabilitiesRef.current, workspaceId, profileId).then((value) => {
      if (!active) return;
      const matches = value?.workspaceId === workspaceId && value.profileId === profileId;
      setAnswer({ key, value: matches ? value : undefined });
    });
    return () => {
      active = false;
    };
  }, [key, workspaceId, profileId]);
  return answer !== null && answer.key === key ? answer.value : undefined;
}

/**
 * How many sources the selected career evidence holds, read through the existing knowledge
 * capabilities; `undefined` when the host cannot say, so the approval never shows a guessed count.
 */
export function useEvidenceSourceCount(
  evidence: CareerEvidenceCapabilities | undefined,
  workspaceId: string,
  revision: string,
): number | undefined {
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;
  const key = `${workspaceId}\u0000${revision}`;
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly value: number | undefined;
  } | null>(null);
  useEffect(() => {
    const capabilities = evidenceRef.current;
    if (capabilities === undefined || workspaceId.trim() === "") return;
    let active = true;
    void loadCareerEvidenceStatus(capabilities, workspaceId, (name) => name).then((status) => {
      if (active)
        setAnswer({ key, value: status.kind === "selected" ? status.sourceCount : undefined });
    });
    return () => {
      active = false;
    };
  }, [key, workspaceId]);
  return answer !== null && answer.key === key ? answer.value : undefined;
}
