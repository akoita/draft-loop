import type {
  CanonicalCandidateProfileFactCategory,
  CanonicalCandidateProfileIssueSeverity,
  CanonicalCandidateProfileIssueStatus,
} from "@draft-loop/domain";
import { maximumCanonicalCandidateProfileIdLength } from "@draft-loop/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileListResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import type { CandidateProfileSelection } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import {
  findReviewedCanonicalCandidateProfileChoice,
  parseReviewedCanonicalCandidateProfileCatalogResult,
  type ReviewedCanonicalCandidateProfileSummary,
  reviewedCanonicalCandidateProfileChoice,
} from "./profile-catalog.js";
import {
  type CanonicalCandidateProfileOutcome,
  canReviewCanonicalCandidateProfile,
  canSelectReviewedCanonicalCandidateProfile,
  projectCanonicalCandidateProfileOperationResult,
  projectCanonicalCandidateProfileOutcome,
  safeCanonicalCandidateProfileFeedback,
} from "./profile-outcome.js";

const profileIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const absoluteUrlPattern = /\b(?:https?|ftp):\/\/[^\s<>"']+/giu;
const maximumProfileIdLength = maximumCanonicalCandidateProfileIdLength;

export type CanonicalCandidateProfileCapabilities = Required<
  Omit<DesktopProfileCapabilities, "listReviewedCanonicalCandidateProfiles">
> &
  Pick<DesktopProfileCapabilities, "listReviewedCanonicalCandidateProfiles">;

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
  return record !== null && canSelectReviewedCanonicalCandidateProfile(record)
    ? { profileId: record.profileId, version: record.version }
    : null;
}

function shortChecksum(checksum: string): string {
  return `${checksum.slice(0, 12)}…`;
}

export function ProfileOutcomeFeedback({
  outcome,
  showMessage = true,
}: {
  readonly outcome: CanonicalCandidateProfileOutcome;
  readonly showMessage?: boolean;
}) {
  return (
    <section className="profile-outcome" aria-label="Canonical profile status">
      {showMessage ? <p>{outcome.message}</p> : null}
      {outcome.failureReasons.length === 0 ? null : (
        <>
          <p>Saved issue guidance</p>
          <ul aria-label="Saved profile issue guidance">
            {outcome.failureReasons.map((reason) => (
              <li key={reason}>{safeCanonicalCandidateProfileFeedback(reason)}</li>
            ))}
          </ul>
        </>
      )}
      {outcome.kind === "extraction-failure" ? (
        <p>
          Follow the displayed cause and recovery steps first; changing the profile name alone will
          not fix the underlying input or provider failure.
        </p>
      ) : outcome.kind === "empty" && outcome.retry ? (
        <p>
          Check that the selected source material includes the facts you need; renaming adds no
          evidence.
        </p>
      ) : null}
      {outcome.retry ? (
        <p>
          Retrying sends the selected material again, can consume provider credits, and bounded
          recovery may make multiple requests.
        </p>
      ) : null}
    </section>
  );
}

export function ProfileGenerationAction({
  outcome,
  profileIdValid,
  providerTransmissionApproved,
  busy,
  onApprovalChange,
  onDerive,
}: {
  readonly outcome: CanonicalCandidateProfileOutcome;
  readonly profileIdValid: boolean;
  readonly providerTransmissionApproved: boolean;
  readonly busy: boolean;
  readonly onApprovalChange: (approved: boolean) => void;
  readonly onDerive: () => void;
}) {
  return (
    <>
      <label className="profile-approval-label">
        <input
          type="checkbox"
          checked={providerTransmissionApproved}
          disabled={busy}
          onChange={(event) => onApprovalChange(event.target.checked)}
        />
        <span>I approve sending selected candidate material to the configured provider.</span>
      </label>
      <button
        className="button button-primary"
        type="button"
        disabled={busy || !profileIdValid || !providerTransmissionApproved}
        onClick={onDerive}
      >
        {busy ? "Working…" : outcome.retry ? "Retry profile generation" : "Derive profile"}
      </button>
    </>
  );
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
  const reviewAllowed = canReviewCanonicalCandidateProfile(record, draftFacts, draftIssues);

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
          disabled={!editable || busy || !reviewAllowed}
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
  const [catalogProfiles, setCatalogProfiles] = useState<
    readonly ReviewedCanonicalCandidateProfileSummary[]
  >([]);
  const [catalogWorkspaceId, setCatalogWorkspaceId] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(
    capabilities.listReviewedCanonicalCandidateProfiles !== undefined,
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogChoice, setCatalogChoice] = useState("");
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const workspaceIdRef = useRef(workspaceId);
  const catalogRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const catalogChoiceRef = useRef<string | null>(null);
  const selectedProfileRef = useRef(selectedProfile);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const catalogEpochRef = useRef(catalogEpoch);
  workspaceIdRef.current = workspaceId;
  selectedProfileRef.current = selectedProfile;
  onSelectionChangeRef.current = onSelectionChange;
  catalogEpochRef.current = catalogEpoch;

  const available = hasCanonicalCandidateProfileCapabilities(capabilities);
  const normalizedProfileId = profileId.trim();
  const latestVersion = latestVersionOf(history, record);
  const editable = canEditCanonicalCandidateProfile(record, latestVersion);
  const currentOutcome = projectCanonicalCandidateProfileOutcome(
    record,
    normalizedProfileId,
    loadedProfileId,
    draftFacts,
    draftIssues,
  );
  const selectedThisRecord =
    selectedProfile !== null &&
    record !== null &&
    currentOutcome.kind === "reviewed" &&
    selectedProfile.profileId === record.profileId &&
    selectedProfile.version === record.version;

  useEffect(() => {
    if (workspaceId.trim() === "") return;
    selectionRequestRef.current += 1;
    catalogChoiceRef.current = null;
    setCatalogChoice("");
    setCatalogProfiles([]);
    setCatalogWorkspaceId(null);
    setProfileId("");
    setLoadedProfileId(null);
    setHistory([]);
    setRecord(null);
    setDraftFacts([]);
    setDraftIssues([]);
    setProviderTransmissionApproved(false);
    setBusy(false);
    setStatusMessage("");
    setErrorMessage(null);
  }, [workspaceId]);

  useEffect(() => {
    const listCatalog = capabilities.listReviewedCanonicalCandidateProfiles;
    if (!available || listCatalog === undefined || workspaceId.trim() === "") {
      setCatalogProfiles([]);
      setCatalogWorkspaceId(null);
      setCatalogLoading(false);
      setCatalogError(null);
      return;
    }
    const epoch = catalogEpoch;
    const request = ++catalogRequestRef.current;
    let active = true;
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogWorkspaceId(null);
    void listCatalog(workspaceId)
      .then((value) => parseReviewedCanonicalCandidateProfileCatalogResult(value, workspaceId))
      .then((catalog) => {
        if (!active || request !== catalogRequestRef.current || epoch !== catalogEpochRef.current)
          return;
        const selectedChoice = catalogChoiceRef.current;
        if (
          selectedChoice !== null &&
          findReviewedCanonicalCandidateProfileChoice(selectedChoice, catalog.profiles) ===
            undefined
        ) {
          catalogChoiceRef.current = null;
          setCatalogChoice("");
          if (
            selectedProfileRef.current !== null &&
            `${selectedProfileRef.current.profileId}@${selectedProfileRef.current.version}` ===
              selectedChoice
          ) {
            onSelectionChangeRef.current(null);
          }
        }
        setCatalogProfiles(catalog.profiles);
        setCatalogWorkspaceId(catalog.workspaceId);
        setCatalogLoading(false);
      })
      .catch(() => {
        if (!active || request !== catalogRequestRef.current || epoch !== catalogEpochRef.current)
          return;
        setCatalogLoading(false);
        setCatalogError("Could not load reviewed profiles. Refresh to try again.");
      });
    return () => {
      active = false;
    };
  }, [available, workspaceId, capabilities.listReviewedCanonicalCandidateProfiles, catalogEpoch]);

  if (!available) return null;

  const applyRecord = (nextRecord: CanonicalCandidateProfileRecordResult): void => {
    setRecord(nextRecord);
    setDraftFacts(nextRecord.facts);
    setDraftIssues(nextRecord.issues);
    onSelectionChange(candidateProfileSelectionForRecord(nextRecord));
  };

  const withBusy = async (
    operation: () => Promise<CanonicalCandidateProfileRecordResult | null>,
  ): Promise<void> => {
    setBusy(true);
    setErrorMessage(null);
    setStatusMessage("Working with the canonical candidate profile…");
    try {
      const result = await operation();
      setStatusMessage(projectCanonicalCandidateProfileOperationResult(result).message);
    } catch (reason: unknown) {
      setErrorMessage(safeCanonicalCandidateProfileFeedback(reason));
      setStatusMessage("The operation did not complete. No new profile version was confirmed.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (
    id: string,
    version?: number,
  ): Promise<CanonicalCandidateProfileRecordResult | null> => {
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
      return null;
    }
    const nextRecord = await capabilities.getCanonicalCandidateProfile(id, targetVersion);
    setLoadedProfileId(id);
    applyRecord(nextRecord);
    return nextRecord;
  };

  const refreshCatalog = (): void => {
    if (capabilities.listReviewedCanonicalCandidateProfiles !== undefined) {
      setCatalogEpoch((epoch) => epoch + 1);
    }
  };

  const selectReviewedProfile = async (choice: string): Promise<void> => {
    const summary = findReviewedCanonicalCandidateProfileChoice(choice, catalogProfiles);
    if (summary === undefined || catalogWorkspaceId !== workspaceId) return;
    const request = ++selectionRequestRef.current;
    const selectedWorkspaceId = workspaceId;
    const current = (): boolean =>
      request === selectionRequestRef.current && workspaceIdRef.current === selectedWorkspaceId;
    catalogChoiceRef.current = reviewedCanonicalCandidateProfileChoice(summary);
    setCatalogChoice(choice);
    setProfileId(summary.profileId);
    setProviderTransmissionApproved(false);
    setStatusMessage("Loading the selected reviewed profile locally…");
    setErrorMessage(null);
    setLoadedProfileId(null);
    setHistory([]);
    setRecord(null);
    setDraftFacts([]);
    setDraftIssues([]);
    onSelectionChange(null);
    setBusy(true);
    try {
      const listing = await capabilities.listCanonicalCandidateProfileVersions(summary.profileId);
      if (!current()) return;
      if (
        listing.workspaceId !== selectedWorkspaceId ||
        listing.profileId !== summary.profileId ||
        !listing.versions.some((entry) => entry.version === summary.version)
      ) {
        throw new Error("catalog selection mismatch");
      }
      const selected = await capabilities.getCanonicalCandidateProfile(
        summary.profileId,
        summary.version,
      );
      if (!current()) return;
      if (
        selected.workspaceId !== selectedWorkspaceId ||
        selected.profileId !== summary.profileId ||
        selected.version !== summary.version ||
        !canSelectReviewedCanonicalCandidateProfile(selected)
      ) {
        throw new Error("catalog selection mismatch");
      }
      setHistory(listing.versions);
      setLoadedProfileId(summary.profileId);
      applyRecord(selected);
      setStatusMessage(`Loaded reviewed profile version ${summary.version} locally.`);
    } catch {
      if (!current()) return;
      catalogChoiceRef.current = null;
      setCatalogChoice("");
      setLoadedProfileId(null);
      setHistory([]);
      setRecord(null);
      setDraftFacts([]);
      setDraftIssues([]);
      onSelectionChange(null);
      setStatusMessage("");
      setErrorMessage(
        "Could not load that reviewed profile version. Choose it again or load by name.",
      );
    } finally {
      if (current()) setBusy(false);
    }
  };

  const loadLatest = (): void => {
    if (!isCanonicalCandidateProfileId(normalizedProfileId)) {
      setErrorMessage("Enter a valid opaque profile ID.");
      return;
    }
    selectionRequestRef.current += 1;
    catalogChoiceRef.current = null;
    setCatalogChoice("");
    void withBusy(() => refresh(normalizedProfileId));
  };

  const loadVersion = (version: number): void => {
    if (loadedProfileId === null || !Number.isSafeInteger(version) || version < 1) return;
    catalogChoiceRef.current = null;
    setCatalogChoice("");
    void withBusy(async () => {
      const nextRecord = await capabilities.getCanonicalCandidateProfile(loadedProfileId, version);
      applyRecord(nextRecord);
      return nextRecord;
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
      const refreshed = await refresh(normalizedProfileId, derived.version);
      refreshCatalog();
      return refreshed;
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
      const refreshed = await refresh(record.profileId, nextRecord.version);
      refreshCatalog();
      return refreshed;
    });
  };

  const review = (): void => {
    if (!editable || record === null) return;
    void withBusy(async () => {
      const reviewed = await capabilities.reviewCanonicalCandidateProfile(
        record.profileId,
        record.version,
      );
      const refreshed = await refresh(record.profileId, reviewed.version);
      refreshCatalog();
      return refreshed;
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
      <p className="profile-note">
        Source compatibility is checked again before starting a review.
      </p>
      {capabilities.listReviewedCanonicalCandidateProfiles === undefined ? null : (
        <div className="profile-catalog-picker">
          <label htmlFor="reviewed-profile-catalog">Existing reviewed profiles</label>
          <div className="profile-catalog-controls">
            <select
              id="reviewed-profile-catalog"
              aria-label="Existing reviewed profiles"
              value={catalogChoice}
              disabled={busy || catalogLoading}
              onChange={(event) => {
                const choice = event.target.value;
                if (choice === "") {
                  selectionRequestRef.current += 1;
                  catalogChoiceRef.current = null;
                  setCatalogChoice("");
                  setProviderTransmissionApproved(false);
                  setLoadedProfileId(null);
                  setHistory([]);
                  setRecord(null);
                  setDraftFacts([]);
                  setDraftIssues([]);
                  onSelectionChange(null);
                  setStatusMessage("");
                  setErrorMessage(null);
                  return;
                }
                void selectReviewedProfile(choice);
              }}
            >
              <option value="">Choose a reviewed profile…</option>
              {(catalogWorkspaceId === workspaceId ? catalogProfiles : []).map((profile) => {
                const choice = reviewedCanonicalCandidateProfileChoice(profile);
                return (
                  <option key={choice} value={choice}>
                    {profile.profileId} · v{profile.version}
                  </option>
                );
              })}
            </select>
            <button
              className="button button-outline"
              type="button"
              disabled={busy || catalogLoading}
              onClick={() => setCatalogEpoch((epoch) => epoch + 1)}
            >
              Refresh
            </button>
          </div>
          {catalogLoading ? <p role="status">Loading reviewed profiles…</p> : null}
          {catalogError === null ? null : (
            <p className="profile-error" role="alert">
              {catalogError}
            </p>
          )}
          {!catalogLoading &&
          catalogError === null &&
          catalogWorkspaceId === workspaceId &&
          catalogProfiles.length === 0 ? (
            <p className="profile-empty">No reviewed profiles are available in this workspace.</p>
          ) : null}
        </div>
      )}
      <div className="profile-controls">
        <label className="profile-id-label">
          <span>Profile name</span>
          <input
            type="text"
            value={profileId}
            maxLength={maximumProfileIdLength}
            pattern={profileIdPattern.source}
            autoComplete="off"
            disabled={busy}
            aria-label="Profile name"
            placeholder="e.g. senior-data-engineer-cv"
            aria-describedby="profile-id-hint"
            onChange={(event) => {
              const next = event.target.value;
              if (
                next === "" ||
                (next.length <= maximumProfileIdLength && profileIdPattern.test(next))
              ) {
                selectionRequestRef.current += 1;
                catalogChoiceRef.current = null;
                setCatalogChoice("");
                setProviderTransmissionApproved((approved) =>
                  candidateProfileApprovalAfterIdChange(approved, profileId, next),
                );
                setProfileId(next);
                setStatusMessage("");
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
        <p className="field-hint" id="profile-id-hint">
          Choose a name for this profile: letters, digits, dots, dashes, or underscores. Approval
          applies to this name only.
        </p>
        <ProfileGenerationAction
          outcome={currentOutcome}
          profileIdValid={isCanonicalCandidateProfileId(normalizedProfileId)}
          providerTransmissionApproved={providerTransmissionApproved}
          busy={busy}
          onApprovalChange={setProviderTransmissionApproved}
          onDerive={derive}
        />
      </div>
      {record === null ||
      busy ||
      errorMessage !== null ||
      (!currentOutcome.retry &&
        currentOutcome.failureReasons.length === 0 &&
        statusMessage === currentOutcome.message) ? null : (
        <ProfileOutcomeFeedback
          outcome={currentOutcome}
          showMessage={statusMessage !== currentOutcome.message}
        />
      )}
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
        <p className="profile-empty">
          {currentOutcome.kind === "no-version"
            ? currentOutcome.message
            : "Enter a profile name and choose Load latest to see its history."}
        </p>
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
