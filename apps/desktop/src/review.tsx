import { useMemo, useState } from "react";

import {
  type DesktopReviewState,
  type FindingDecision,
  type ReviewAction,
  unresolvedBlockingFindings,
} from "./model.js";

interface ReviewWorkspaceProps {
  readonly state: DesktopReviewState;
  readonly onAction: (action: ReviewAction) => void;
  readonly onSelectFiles?: (target: "evidence" | "job-description") => void;
  readonly onAddUrl?: (target: "evidence" | "job-description", url: string) => void;
}

const decisionLabels: Readonly<Record<FindingDecision, string>> = {
  pending: "Pending",
  accepted: "Accept",
  rejected: "Reject",
  deferred: "Defer",
  overridden: "Override",
};

function stateLabel(value: DesktopReviewState["state"]): string {
  return value.replaceAll("-", " ");
}

export function ReviewWorkspace({
  state,
  onAction,
  onSelectFiles,
  onAddUrl,
}: ReviewWorkspaceProps) {
  const blockingFindings = unresolvedBlockingFindings(state);
  const unresolvedFindings = state.findings.filter(
    (finding) => finding.decision === "pending" || finding.decision === "deferred",
  );
  const claimById = useMemo(
    () => new Map(state.artifact.claims.map((claim) => [claim.id, claim])),
    [state.artifact.claims],
  );
  const canApprove = state.state === "awaiting-approval" && blockingFindings.length === 0;
  const [jobUrl, setJobUrl] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [overrideReasons, setOverrideReasons] = useState<Readonly<Record<string, string>>>({});

  const submitUrl = (target: "evidence" | "job-description"): void => {
    const value = target === "job-description" ? jobUrl.trim() : evidenceUrl.trim();
    if (value === "" || onAddUrl === undefined) return;
    onAddUrl(target, value);
    if (target === "job-description") setJobUrl("");
    else setEvidenceUrl("");
  };

  if (state.state === "collecting") {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">DraftLoop / Workspace setup</p>
            <h1>Bring your evidence into the loop</h1>
          </div>
          <div className="run-identity">
            <span>{state.workspaceId}</span>
            <span className="state-pill state-collecting">Collecting inputs</span>
          </div>
        </header>
        <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
          <p className="eyebrow">Before the first run</p>
          <h2 id="onboarding-title">Add the sources DraftLoop is allowed to use</h2>
          <p className="onboarding-copy">
            Your files stay in this workspace. DraftLoop will not invent missing experience or start
            an agent run until the target job and candidate evidence are present.
          </p>
          <div className="setup-grid">
            <article className="setup-card">
              <span className="setup-number">01</span>
              <strong>Target job description</strong>
              <span>
                {state.setup.jobDescriptionReady ? "Ready for review" : "Required input missing"}
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
            <article className="setup-card">
              <span className="setup-number">02</span>
              <strong>Candidate evidence</strong>
              <span>
                {state.setup.evidenceSourceCount === 0
                  ? "Add a CV, portfolio, or other source"
                  : `${state.setup.evidenceSourceCount} source${state.setup.evidenceSourceCount === 1 ? "" : "s"} ready`}
              </span>
              <button
                className="button button-quiet"
                type="button"
                disabled={onSelectFiles === undefined}
                onClick={() => onSelectFiles?.("evidence")}
              >
                Add evidence files
              </button>
              <label className="url-input-label">
                <span>Or provide a public URL</span>
                <input
                  className="url-input"
                  type="url"
                  placeholder="https://github.com/…"
                  value={evidenceUrl}
                  onChange={(event) => setEvidenceUrl(event.target.value)}
                  aria-label="Candidate evidence URL"
                />
              </label>
              <button
                className="button button-outline"
                type="button"
                disabled={onAddUrl === undefined || evidenceUrl.trim() === ""}
                onClick={() => submitUrl("evidence")}
              >
                Review and fetch evidence URL
              </button>
            </article>
          </div>
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
            <button
              className="button button-primary"
              type="button"
              disabled={!state.setup.ready}
              onClick={() => onAction({ type: "start" })}
            >
              Start author–critic review
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">DraftLoop / Review workspace</p>
          <h1>Evidence before approval</h1>
        </div>
        <div className="run-identity">
          <span>{state.workspaceId}</span>
          <span className={`state-pill state-${state.state}`}>{stateLabel(state.state)}</span>
          <span className="approval-pill">
            {state.approval === "approved" ? "Artifact approved" : "Approval pending"}
          </span>
          <span>Round {state.round}</span>
        </div>
      </header>

      <section className="trust-strip" aria-label="trust and policy summary">
        <div>
          <span className="label">Author</span>
          <strong>{state.providerExposure.author.company}</strong>
          <span>{state.providerExposure.author.model}</span>
        </div>
        <div>
          <span className="label">Independent critic</span>
          <strong>{state.providerExposure.critic.company}</strong>
          <span>{state.providerExposure.critic.model}</span>
        </div>
        <div>
          <span className="label">Data policy</span>
          <strong>
            {state.providerExposure.transmissionAllowed ? "Transmission approved" : "Local only"}
          </strong>
          <span>
            {state.providerExposure.requestedRetention} · sensitive material{" "}
            {state.providerExposure.sensitiveData ? "present" : "absent"}
          </span>
        </div>
        <div>
          <span className="label">Budget</span>
          <strong>${state.totalCostUsd.toFixed(3)} used</strong>
          <span>
            {state.budgetUsd === null ? "No cap configured" : `$${state.budgetUsd.toFixed(2)} cap`}
          </span>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="review-column" aria-label="artifact review">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Artifact review</p>
              <h2>Version {state.artifact.version}</h2>
            </div>
            <span className="subtle">Agent output is a draft, not proof.</span>
          </div>

          <div className="diff-grid">
            <article className="artifact-pane previous-pane">
              <div className="pane-heading">
                <span>Previous version</span>
                <span>
                  {state.previousArtifact === null ? "None" : `v${state.previousArtifact.version}`}
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
            <article className="artifact-pane current-pane">
              <div className="pane-heading">
                <span>Current draft</span>
                <span>v{state.artifact.version} · editable</span>
              </div>
              {state.artifact.sections.map((section) => (
                <section className="artifact-section" key={section.id}>
                  <h3>{section.title}</h3>
                  {section.blocks.map((block) => (
                    <label className="editable-block" key={block.id}>
                      <span className="sr-only">Edit {section.title}</span>
                      <textarea
                        aria-label={`Edit ${section.title}`}
                        value={block.text}
                        rows={block.type === "bullet" ? 3 : 4}
                        onChange={(event) =>
                          onAction({
                            type: "edit-block",
                            blockId: block.id,
                            text: event.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </section>
              ))}
            </article>
          </div>

          <section className="claims-panel" aria-label="claim to evidence inspection">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Traceability</p>
                <h2>Claims and evidence</h2>
              </div>
              <span className="subtle">
                Evidence links support review; they do not guarantee truth.
              </span>
            </div>
            <div className="claim-list">
              {state.artifact.claims.map((claim) => (
                <article className={`claim-card claim-${claim.status}`} key={claim.id}>
                  <div className="claim-heading">
                    <strong>{claim.text}</strong>
                    <span className="status-tag">{claim.status}</span>
                  </div>
                  {claim.evidence.length === 0 ? (
                    <p className="warning-copy">No evidence is linked to this claim.</p>
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
              ))}
            </div>
          </section>
        </section>

        <aside className="side-column">
          <section className="panel progress-panel" aria-label="run progress">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Run progress</p>
                <h2>{stateLabel(state.state)}</h2>
              </div>
              {state.state === "paused" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => onAction({ type: "resume" })}
                >
                  Resume
                </button>
              ) : state.state !== "approved" && state.state !== "exported" ? (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => onAction({ type: "pause" })}
                >
                  Pause
                </button>
              ) : null}
            </div>
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
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Critique</p>
                <h2>Findings</h2>
              </div>
              <span className="count-badge">{unresolvedFindings.length} unresolved</span>
            </div>
            {state.findings.map((finding) => {
              const claim =
                finding.claimId === undefined ? undefined : claimById.get(finding.claimId);
              return (
                <article className={`finding-card finding-${finding.severity}`} key={finding.id}>
                  <div className="finding-meta">
                    <span className={`severity severity-${finding.severity}`}>
                      {finding.severity}
                    </span>
                    <span>{finding.category}</span>
                    <span>{finding.code}</span>
                  </div>
                  <p>{finding.message}</p>
                  {finding.agreement === "critic-only" ? (
                    <p className="disagreement">Disagreement · critic-only finding</p>
                  ) : null}
                  {claim === undefined ? null : (
                    <p className="linked-claim">Linked claim: {claim.text}</p>
                  )}
                  <label className="rationale-input-label">
                    <span>Override rationale (required for Override)</span>
                    <input
                      className="rationale-input"
                      type="text"
                      value={overrideReasons[finding.id] ?? finding.rationale ?? ""}
                      onChange={(event) =>
                        setOverrideReasons((current) => ({
                          ...current,
                          [finding.id]: event.target.value,
                        }))
                      }
                      aria-label={`Override rationale for ${finding.code}`}
                    />
                  </label>
                  <fieldset className="finding-actions" aria-label={`Decision for ${finding.code}`}>
                    <legend className="sr-only">Decision for {finding.code}</legend>
                    {(Object.keys(decisionLabels) as FindingDecision[])
                      .filter((decision) => decision !== "pending")
                      .map((decision) => (
                        <button
                          className={
                            finding.decision === decision
                              ? "button button-selected"
                              : "button button-quiet"
                          }
                          type="button"
                          key={decision}
                          disabled={
                            decision === "overridden" &&
                            (overrideReasons[finding.id] ?? finding.rationale ?? "").trim() === ""
                          }
                          onClick={() => {
                            const rationale = (
                              overrideReasons[finding.id] ??
                              finding.rationale ??
                              ""
                            ).trim();
                            onAction({
                              type: "finding-decision",
                              findingId: finding.id,
                              decision,
                              ...(decision === "overridden" ? { rationale } : {}),
                            });
                          }}
                        >
                          {decisionLabels[decision]}
                        </button>
                      ))}
                  </fieldset>
                </article>
              );
            })}
          </section>

          <section className="panel approval-panel" aria-label="approval and export">
            <p className="eyebrow">Human gate</p>
            <h2>Approval is separate from export</h2>
            <p className="subtle approval-status">
              Artifact: {state.approval === "approved" ? "approved" : "not approved"} · Export:{" "}
              {state.exportPath === null ? "not exported" : "exported"}
            </p>
            {blockingFindings.length > 0 ? (
              <p className="warning-copy">
                Resolve or override {blockingFindings.length} blocking finding before approval.
              </p>
            ) : (
              <p className="safe-copy">
                No unresolved blocking findings. The final decision remains yours.
              </p>
            )}
            <div className="approval-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={!canApprove}
                onClick={() => onAction({ type: "approve" })}
              >
                Approve artifact
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={state.state !== "awaiting-approval"}
                onClick={() => onAction({ type: "request-revision" })}
              >
                Request revision
              </button>
            </div>
            <div className="export-action">
              <div>
                <strong>Export locally</strong>
                <span>{state.exportPath ?? "Available only after approval"}</span>
              </div>
              <button
                className="button button-outline"
                type="button"
                disabled={state.state !== "approved"}
                onClick={() => onAction({ type: "export" })}
              >
                Export Markdown
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
