import type {
  CanonicalCandidateProfileFactCategory,
  CanonicalCandidateProfileIssueSeverity,
  CanonicalCandidateProfileIssueStatus,
} from "@draft-loop/domain";
import { maximumCanonicalCandidateProfileIdLength } from "@draft-loop/domain";
import { useEffect, useMemo, useState } from "react";
import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileListResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import type { CandidateProfileSelection } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";

const profileIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const absoluteUrlPattern = /\b(?:https?|ftp):\/\/[^\s<>"']+/giu;
const absoluteUrlTestPattern = /\b(?:https?|ftp):\/\/[^\s<>"']+/iu;
const maximumProfileIdLength = maximumCanonicalCandidateProfileIdLength;

export type CanonicalCandidateProfileCapabilities = Required<DesktopProfileCapabilities>;

export interface ProfileWorkspaceProps {
  readonly workspaceId: string;
  readonly capabilities: DesktopProfileCapabilities;
  readonly selectedProfile: CandidateProfileSelection | null;
  readonly onSelectionChange: (selection: CandidateProfileSelection | null) => void;
}

/** The packaged host exposes the profile panel only when the whole API is present. */
export function hasCanonicalCandidateProfileCapabilities(
  capabilities: DesktopProfileCapabilities,
): capabilities is CanonicalCandidateProfileCapabilities {
  return (
    capabilities.deriveCanonicalCandidateProfile !== undefined &&
    capabilities.getCanonicalCandidateProfile !== undefined &&
    capabilities.listCanonicalCandidateProfileVersions !== undefined &&
    capabilities.editCanonicalCandidateProfile !== undefined &&
    capabilities.reviewCanonicalCandidateProfile !== undefined
  );
}

/** Profile identifiers are opaque, bounded tokens, never local paths or URLs. */
export function isCanonicalCandidateProfileId(value: string): boolean {
  return value.length > 0 && value.length <= maximumProfileIdLength && profileIdPattern.test(value);
}

/** Provider consent is scoped to the exact profile ID visible when it was granted. */
export function candidateProfileApprovalAfterIdChange(
  approved: boolean,
  previousProfileId: string,
  nextProfileId: string,
): boolean {
  return previousProfileId === nextProfileId && approved;
}

/** Keep URL-looking content out of renderer text except approved-link fact values. */
export function safeCanonicalCandidateProfileText(value: string, allowUrl = false): string {
  return allowUrl ? value : value.replace(absoluteUrlPattern, "[link omitted]");
}

export function groupCanonicalCandidateProfileFacts(
  facts: readonly CanonicalCandidateProfileFactResult[],
): readonly (readonly [
  CanonicalCandidateProfileFactCategory,
  readonly CanonicalCandidateProfileFactResult[],
])[] {
  const grouped = new Map<
    CanonicalCandidateProfileFactCategory,
    CanonicalCandidateProfileFactResult[]
  >();
  for (const fact of facts) {
    const current = grouped.get(fact.category);
    if (current === undefined) grouped.set(fact.category, [fact]);
    else current.push(fact);
  }
  return [...grouped.entries()];
}

export type CanonicalCandidateProfileIssueGroups = ReadonlyMap<
  CanonicalCandidateProfileIssueSeverity,
  ReadonlyMap<CanonicalCandidateProfileIssueStatus, readonly CanonicalCandidateProfileIssueResult[]>
>;

export function groupCanonicalCandidateProfileIssues(
  issues: readonly CanonicalCandidateProfileIssueResult[],
): CanonicalCandidateProfileIssueGroups {
  const grouped = new Map<
    CanonicalCandidateProfileIssueSeverity,
    Map<CanonicalCandidateProfileIssueStatus, CanonicalCandidateProfileIssueResult[]>
  >();
  for (const issue of issues) {
    let byStatus = grouped.get(issue.severity);
    if (byStatus === undefined) {
      byStatus = new Map();
      grouped.set(issue.severity, byStatus);
    }
    const current = byStatus.get(issue.status);
    if (current === undefined) byStatus.set(issue.status, [issue]);
    else current.push(issue);
  }
  return grouped;
}

export function canEditCanonicalCandidateProfile(
  record: CanonicalCandidateProfileRecordResult | null,
  latestVersion: number | null,
): boolean {
  return record !== null && record.status === "draft" && record.version === latestVersion;
}

export function candidateProfileSelectionForRecord(
  record: CanonicalCandidateProfileRecordResult | null,
): CandidateProfileSelection | null {
  return record?.status === "reviewed"
    ? { profileId: record.profileId, version: record.version }
    : null;
}

function profileErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : "";
  // Provider/host failures are expected to be content-free. If a fixture or
  // future adapter violates that contract, do not let a path or URL reach the
  // renderer's alert.
  if (
    message === "" ||
    message.length > 240 ||
    message.includes("/") ||
    message.includes("\\") ||
    absoluteUrlTestPattern.test(message)
  ) {
    return "The canonical candidate profile operation could not be completed.";
  }
  return message;
}

function shortChecksum(checksum: string): string {
  return `${checksum.slice(0, 12)}…`;
}

function latestVersionOf(
  history: readonly CanonicalCandidateProfileRecordResult[],
  record: CanonicalCandidateProfileRecordResult | null,
): number | null {
  return history.at(-1)?.version ?? record?.version ?? null;
}

function ProfileFact({
  fact,
  editable,
  onValueChange,
  onRemove,
}: {
  readonly fact: CanonicalCandidateProfileFactResult;
  readonly editable: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onRemove: () => void;
}) {
  const allowUrl = fact.category === "approved-link";
  return (
    <li className="profile-fact">
      <div className="profile-fact-heading">
        <strong>{safeCanonicalCandidateProfileText(fact.field)}</strong>
        {fact.subjectId === undefined ? null : (
          <span className="profile-opaque-id">
            subject {safeCanonicalCandidateProfileText(fact.subjectId)}
          </span>
        )}
      </div>
      <input
        className="profile-fact-value"
        type="text"
        aria-label={`Value for fact ${fact.id}`}
        value={safeCanonicalCandidateProfileText(fact.value, allowUrl)}
        disabled={!editable}
        onChange={(event) =>
          onValueChange(
            allowUrl ? event.target.value : safeCanonicalCandidateProfileText(event.target.value),
          )
        }
      />
      <fieldset className="profile-provenance" aria-label={`Provenance for fact ${fact.id}`}>
        {fact.provenance.map((reference) => (
          <dl className="profile-provenance-entry" key={JSON.stringify(reference)}>
            <div>
              <dt>Store</dt>
              <dd>{safeCanonicalCandidateProfileText(reference.storeId)}</dd>
            </div>
            <div>
              <dt>CKB</dt>
              <dd>{safeCanonicalCandidateProfileText(reference.knowledgeBaseId)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{safeCanonicalCandidateProfileText(reference.sourceId)}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{safeCanonicalCandidateProfileText(reference.versionId)}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{reference.kind}</dd>
            </div>
          </dl>
        ))}
      </fieldset>
      {editable ? (
        <button className="button button-quiet profile-remove" type="button" onClick={onRemove}>
          Remove fact
        </button>
      ) : null}
    </li>
  );
}

function ProfileIssue({
  issue,
  editable,
  onStatusChange,
}: {
  readonly issue: CanonicalCandidateProfileIssueResult;
  readonly editable: boolean;
  readonly onStatusChange: (status: CanonicalCandidateProfileIssueStatus) => void;
}) {
  return (
    <li className="profile-issue">
      <div className="profile-issue-heading">
        <strong>{issue.code}</strong>
        <span className={`profile-issue-severity profile-issue-${issue.severity}`}>
          {issue.severity}
        </span>
      </div>
      <p>{safeCanonicalCandidateProfileText(issue.message)}</p>
      <label className="profile-issue-status">
        <span>Status</span>
        <select
          aria-label={`Status for issue ${issue.id}`}
          value={issue.status}
          disabled={!editable}
          onChange={(event) =>
            onStatusChange(event.target.value as CanonicalCandidateProfileIssueStatus)
          }
        >
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      {issue.factIds.length === 0 ? null : (
        <span className="profile-opaque-id">
          Facts:{" "}
          {issue.factIds.map((factId) => safeCanonicalCandidateProfileText(factId)).join(", ")}
        </span>
      )}
      {issue.sourceRefs.length === 0 ? null : (
        <fieldset className="profile-provenance" aria-label={`Provenance for issue ${issue.id}`}>
          {issue.sourceRefs.map((reference) => (
            <dl className="profile-provenance-entry" key={JSON.stringify(reference)}>
              <div>
                <dt>Store</dt>
                <dd>{safeCanonicalCandidateProfileText(reference.storeId)}</dd>
              </div>
              <div>
                <dt>CKB</dt>
                <dd>{safeCanonicalCandidateProfileText(reference.knowledgeBaseId)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{safeCanonicalCandidateProfileText(reference.sourceId)}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{safeCanonicalCandidateProfileText(reference.versionId)}</dd>
              </div>
              <div>
                <dt>Kind</dt>
                <dd>{reference.kind}</dd>
              </div>
            </dl>
          ))}
        </fieldset>
      )}
    </li>
  );
}

export function ProfileDetails({
  record,
  history,
  draftFacts,
  draftIssues,
  editable,
  busy,
  onFactValueChange,
  onRemoveFact,
  onIssueStatusChange,
  onSave,
  onReview,
}: {
  readonly record: CanonicalCandidateProfileRecordResult;
  readonly history: readonly CanonicalCandidateProfileRecordResult[];
  readonly draftFacts: readonly CanonicalCandidateProfileFactResult[];
  readonly draftIssues: readonly CanonicalCandidateProfileIssueResult[];
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onFactValueChange: (factId: string, value: string) => void;
  readonly onRemoveFact: (factId: string) => void;
  readonly onIssueStatusChange: (
    issueId: string,
    status: CanonicalCandidateProfileIssueStatus,
  ) => void;
  readonly onSave: () => void;
  readonly onReview: () => void;
}) {
  const factGroups = useMemo(() => groupCanonicalCandidateProfileFacts(draftFacts), [draftFacts]);
  const issueGroups = useMemo(
    () => groupCanonicalCandidateProfileIssues(draftIssues),
    [draftIssues],
  );
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
        <p className="profile-note">Historical versions are immutable.</p>
      ) : record.status === "reviewed" ? (
        <p className="profile-note">Reviewed versions are immutable.</p>
      ) : null}

      <section className="profile-subsection" aria-labelledby="profile-facts-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Canonical facts</p>
            <h3 id="profile-facts-title">Facts by category</h3>
          </div>
          <span className="meta-chip">{draftFacts.length}</span>
        </div>
        {factGroups.length === 0 ? (
          <p className="profile-empty">No facts are recorded in this version.</p>
        ) : (
          <div className="profile-groups">
            {factGroups.map(([category, facts]) => (
              <section
                className="profile-group"
                key={category}
                aria-labelledby={`profile-facts-${category}`}
              >
                <h4 id={`profile-facts-${category}`}>{category}</h4>
                <ul className="profile-fact-list">
                  {facts.map((fact) => (
                    <ProfileFact
                      key={fact.id}
                      fact={fact}
                      editable={editable}
                      onValueChange={(value) => onFactValueChange(fact.id, value)}
                      onRemove={() => onRemoveFact(fact.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="profile-subsection" aria-labelledby="profile-issues-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Review blockers</p>
            <h3 id="profile-issues-title">Issues by severity and status</h3>
          </div>
          <span className="meta-chip">{draftIssues.length}</span>
        </div>
        {draftIssues.length === 0 ? (
          <p className="profile-empty">No issues are recorded in this version.</p>
        ) : (
          <div className="profile-groups">
            {[...issueGroups.entries()].map(([severity, byStatus]) => (
              <section
                className="profile-group"
                key={severity}
                aria-labelledby={`profile-issues-${severity}`}
              >
                <h4 id={`profile-issues-${severity}`}>{severity}</h4>
                {[...byStatus.entries()].map(([status, issues]) => (
                  <div className="profile-issue-group" key={status}>
                    <h5>{status}</h5>
                    <ul className="profile-issue-list">
                      {issues.map((issue) => (
                        <ProfileIssue
                          key={issue.id}
                          issue={issue}
                          editable={editable}
                          onStatusChange={(nextStatus) => onIssueStatusChange(issue.id, nextStatus)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>

      <div className="profile-actions">
        <button
          className="button button-outline"
          type="button"
          disabled={!editable || busy}
          onClick={onSave}
        >
          {busy ? "Saving profile…" : "Save draft edits"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={!editable || busy}
          onClick={onReview}
        >
          Mark latest draft reviewed
        </button>
      </div>
    </>
  );
}

export function ProfileWorkspace({
  workspaceId,
  capabilities,
  selectedProfile,
  onSelectionChange,
}: ProfileWorkspaceProps) {
  const [profileId, setProfileId] = useState("");
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly CanonicalCandidateProfileRecordResult[]>([]);
  const [record, setRecord] = useState<CanonicalCandidateProfileRecordResult | null>(null);
  const [draftFacts, setDraftFacts] = useState<readonly CanonicalCandidateProfileFactResult[]>([]);
  const [draftIssues, setDraftIssues] = useState<readonly CanonicalCandidateProfileIssueResult[]>(
    [],
  );
  const [providerTransmissionApproved, setProviderTransmissionApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const available = hasCanonicalCandidateProfileCapabilities(capabilities);
  const latestVersion = latestVersionOf(history, record);
  const editable = canEditCanonicalCandidateProfile(record, latestVersion);
  const selectedThisRecord =
    selectedProfile !== null &&
    record !== null &&
    selectedProfile.profileId === record.profileId &&
    selectedProfile.version === record.version;

  useEffect(() => {
    if (workspaceId.trim() === "") return;
    setProfileId("");
    setLoadedProfileId(null);
    setHistory([]);
    setRecord(null);
    setDraftFacts([]);
    setDraftIssues([]);
    setProviderTransmissionApproved(false);
    setStatusMessage("");
    setErrorMessage(null);
  }, [workspaceId]);

  if (!available) return null;

  const applyRecord = (nextRecord: CanonicalCandidateProfileRecordResult): void => {
    setRecord(nextRecord);
    setDraftFacts(nextRecord.facts);
    setDraftIssues(nextRecord.issues);
    onSelectionChange(candidateProfileSelectionForRecord(nextRecord));
  };

  const withBusy = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErrorMessage(null);
    setStatusMessage("Working with the canonical candidate profile…");
    try {
      await operation();
      setStatusMessage("Canonical candidate profile ready.");
    } catch (reason: unknown) {
      setErrorMessage(profileErrorMessage(reason));
      setStatusMessage("The canonical candidate profile operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const normalizedProfileId = profileId.trim();
  const refresh = async (id: string, version?: number): Promise<void> => {
    const listing: CanonicalCandidateProfileListResult =
      await capabilities.listCanonicalCandidateProfileVersions(id);
    setHistory(listing.versions);
    const targetVersion = version ?? listing.versions.at(-1)?.version;
    if (targetVersion === undefined) {
      setLoadedProfileId(id);
      setRecord(null);
      setDraftFacts([]);
      setDraftIssues([]);
      onSelectionChange(null);
      return;
    }
    const nextRecord = await capabilities.getCanonicalCandidateProfile(id, targetVersion);
    setLoadedProfileId(id);
    applyRecord(nextRecord);
  };

  const loadLatest = (): void => {
    if (!isCanonicalCandidateProfileId(normalizedProfileId)) {
      setErrorMessage("Enter a valid opaque profile ID.");
      return;
    }
    void withBusy(() => refresh(normalizedProfileId));
  };

  const loadVersion = (version: number): void => {
    if (loadedProfileId === null || !Number.isSafeInteger(version) || version < 1) return;
    void withBusy(async () => {
      const nextRecord = await capabilities.getCanonicalCandidateProfile(loadedProfileId, version);
      applyRecord(nextRecord);
    });
  };

  const derive = (): void => {
    if (!isCanonicalCandidateProfileId(normalizedProfileId) || !providerTransmissionApproved)
      return;
    setProviderTransmissionApproved(false);
    void withBusy(async () => {
      const derived = await capabilities.deriveCanonicalCandidateProfile({
        profileId: normalizedProfileId,
        providerTransmissionApproved: true,
      });
      await refresh(normalizedProfileId, derived.version);
    });
  };

  const save = (): void => {
    if (!editable || record === null) return;
    void withBusy(async () => {
      const nextRecord = await capabilities.editCanonicalCandidateProfile({
        profileId: record.profileId,
        expectedVersion: record.version,
        patch: {
          facts: draftFacts,
          issues: draftIssues,
        },
      });
      await refresh(record.profileId, nextRecord.version);
    });
  };

  const review = (): void => {
    if (!editable || record === null) return;
    void withBusy(async () => {
      const reviewed = await capabilities.reviewCanonicalCandidateProfile(
        record.profileId,
        record.version,
      );
      await refresh(record.profileId, reviewed.version);
    });
  };

  return (
    <section className="panel profile-panel" aria-labelledby="canonical-profile-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Candidate profile workflow</p>
          <h2 id="canonical-profile-title">Canonical candidate profile</h2>
        </div>
        {selectedThisRecord ? <span className="state-pill state-approved">Selected</span> : null}
      </div>
      <p className="profile-copy">
        Derive a bounded, provider-independent profile from the configured candidate knowledge. Only
        an exact reviewed version can be selected for a new review run.
      </p>
      <div className="profile-controls">
        <label className="profile-id-label">
          <span>Opaque profile ID</span>
          <input
            type="text"
            value={profileId}
            maxLength={maximumProfileIdLength}
            pattern={profileIdPattern.source}
            autoComplete="off"
            disabled={busy}
            aria-label="Opaque profile ID"
            onChange={(event) => {
              const next = event.target.value;
              if (
                next === "" ||
                (next.length <= maximumProfileIdLength && profileIdPattern.test(next))
              ) {
                setProviderTransmissionApproved((approved) =>
                  candidateProfileApprovalAfterIdChange(approved, profileId, next),
                );
                setProfileId(next);
                setErrorMessage(null);
                if (loadedProfileId !== next) {
                  setLoadedProfileId(null);
                  setHistory([]);
                  setRecord(null);
                  setDraftFacts([]);
                  setDraftIssues([]);
                  onSelectionChange(null);
                }
              }
            }}
          />
        </label>
        <button
          className="button button-outline"
          type="button"
          disabled={busy || !isCanonicalCandidateProfileId(normalizedProfileId)}
          onClick={loadLatest}
        >
          Load latest
        </button>
        <label className="profile-approval-label">
          <input
            type="checkbox"
            checked={providerTransmissionApproved}
            disabled={busy}
            onChange={(event) => setProviderTransmissionApproved(event.target.checked)}
          />
          <span>I approve sending selected candidate material to the configured provider.</span>
        </label>
        <button
          className="button button-primary"
          type="button"
          disabled={
            busy ||
            !isCanonicalCandidateProfileId(normalizedProfileId) ||
            !providerTransmissionApproved
          }
          onClick={derive}
        >
          {busy ? "Deriving profile…" : "Derive profile"}
        </button>
      </div>
      <div className="profile-status" role="status" aria-live="polite">
        {statusMessage}
      </div>
      {errorMessage === null ? null : (
        <div className="error-banner profile-error" role="alert">
          <p>{errorMessage}</p>
        </div>
      )}
      {history.length === 0 ? null : (
        <label className="profile-history-label">
          <span>Immutable profile history</span>
          <select
            aria-label="Canonical candidate profile version"
            value={record?.version ?? ""}
            disabled={busy || loadedProfileId === null}
            onChange={(event) => loadVersion(Number(event.target.value))}
          >
            {history.map((version) => (
              <option key={version.version} value={version.version}>
                Version {version.version} · {version.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {record === null ? (
        <p className="profile-empty">Load a profile ID to inspect its immutable history.</p>
      ) : (
        <ProfileDetails
          record={record}
          history={history}
          draftFacts={draftFacts}
          draftIssues={draftIssues}
          editable={editable}
          busy={busy}
          onFactValueChange={(factId, value) =>
            setDraftFacts((facts) =>
              facts.map((fact) => (fact.id === factId ? { ...fact, value } : fact)),
            )
          }
          onRemoveFact={(factId) =>
            setDraftFacts((facts) => facts.filter((fact) => fact.id !== factId))
          }
          onIssueStatusChange={(issueId, status) =>
            setDraftIssues((issues) =>
              issues.map((issue) => (issue.id === issueId ? { ...issue, status } : issue)),
            )
          }
          onSave={save}
          onReview={review}
        />
      )}
    </section>
  );
}
