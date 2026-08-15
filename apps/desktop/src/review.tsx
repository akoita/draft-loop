import { useCallback, useEffect, useMemo, useState } from "react";
import type { CredentialStatus } from "./bridge.js";
import {
  type DesktopReviewState,
  type FindingDecision,
  type ReviewAction,
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

function stateLabel(value: DesktopReviewState["state"]): string {
  return value.replaceAll("-", " ");
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

function claimSourceLabel(claim: DesktopReviewState["artifact"]["claims"][number]): string {
  if (claim.status === "disputed") return "source conflict";
  return claim.evidence.length > 0 ? "source linked" : "not linked to candidate materials";
}

export function ReviewWorkspace({
  state,
  onAction,
  pendingReviewAction,
  onSelectFiles,
  onAddUrl,
  errorMessage,
  getCredentialStatus,
  onSetCredential,
  onRemoveCredential,
}: ReviewWorkspaceProps) {
  const findingSummary = reviewFindingSummary(state);
  const { blocking: blockingFindings, unresolved: unresolvedFindings, warnings } = findingSummary;
  const hasArtifact = state.artifact.version > 0;
  const claimById = useMemo(
    () => new Map(state.artifact.claims.map((claim) => [claim.id, claim])),
    [state.artifact.claims],
  );
  const canApprove =
    hasArtifact && state.state === "awaiting-approval" && blockingFindings.length === 0;
  const approvalLabel =
    state.approval === "approved"
      ? findingSummary.status === "clear"
        ? "Artifact approved"
        : findingSummary.status === "blocked"
          ? `Approved with ${blockingFindings.length} unresolved blocker${blockingFindings.length === 1 ? "" : "s"}`
          : `Approved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Approval pending";
  const validationLabel = !hasArtifact
    ? "No draft artifact available"
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const policyConfirmed =
    confirmedPolicyFingerprint === state.providerTransmissionPreflight.fingerprint;
  const transmissionReady =
    !state.providerTransmissionPreflight.required ||
    state.providerTransmissionPreflight.acknowledged;
  const retryRemainingMs = retryWaitMs(state.providerFailure?.retryNotBefore ?? null, nowMs);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isInput) return;

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }

      if (event.altKey || event.metaKey) {
        if (event.key === "a" || event.key === "A") {
          if (canApprove) {
            event.preventDefault();
            onAction({ type: "approve" });
          }
        } else if (event.key === "r" || event.key === "R") {
          if (state.state === "awaiting-approval" && transmissionReady) {
            event.preventDefault();
            onAction({ type: "request-revision" });
          }
        } else if (event.key === "e" || event.key === "E") {
          if (state.state === "approved") {
            event.preventDefault();
            onAction({ type: "export" });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canApprove, onAction, state.state, settingsOpen, transmissionReady]);

  const submitUrl = (target: "evidence" | "job-description"): void => {
    const value = target === "job-description" ? jobUrl.trim() : evidenceUrl.trim();
    if (value === "" || onAddUrl === undefined) return;
    onAddUrl(target, value);
    if (target === "job-description") setJobUrl("");
    else setEvidenceUrl("");
  };

  const renderSettingsModal = () => {
    if (!settingsOpen) return null;
    return (
      <div className="modal-backdrop">
        <div
          className="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
        >
          <div className="modal-header">
            <div>
              <p className="eyebrow">DraftLoop / Credentials</p>
              <h2 id="settings-dialog-title">Provider API Keys</h2>
            </div>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setSettingsOpen(false)}
            >
              Close
            </button>
          </div>
          <p className="modal-copy">
            App-managed keys override environment variables. Storage protection depends on this
            operating system and is reported for each key below.
          </p>
          {credentialFeedback ? (
            <div className="feedback-banner" role="status">
              <p>{credentialFeedback}</p>
            </div>
          ) : null}
          <div className="credential-sections">
            <div className="credential-row">
              <div className="credential-row-header">
                <strong>Anthropic API Key (Claude)</strong>
                <span className={`status-badge status-${anthropicStatus.source}`}>
                  {anthropicStatus.source === "app"
                    ? "Configured in App"
                    : anthropicStatus.source === "env"
                      ? "Configured via Env"
                      : "Not Configured"}
                </span>
                <span className="credential-protection">
                  {anthropicStatus.protection === "os-backed"
                    ? "OS-backed encryption"
                    : anthropicStatus.protection === "basic-text"
                      ? "Linux basic_text (weak protection)"
                      : anthropicStatus.protection === "local-aes-gcm"
                        ? "Local AES fallback (key stored beside app data)"
                        : anthropicStatus.protection === "environment"
                          ? "Environment variable"
                          : anthropicStatus.protection === "session-memory"
                            ? "Session memory only"
                            : "No credential"}
                </span>
              </div>
              <div className="credential-input-group">
                <input
                  className="url-input"
                  type={showAnthropicKey ? "text" : "password"}
                  placeholder={
                    anthropicStatus.configured ? "••••••••••••••••••••••••" : "sk-ant-api03-…"
                  }
                  value={anthropicKeyInput}
                  onChange={(event) => setAnthropicKeyInput(event.target.value)}
                  aria-label="Anthropic API Key"
                />
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => setShowAnthropicKey((prev) => !prev)}
                >
                  {showAnthropicKey ? "Hide" : "Show"}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={anthropicKeyInput.trim() === ""}
                  onClick={() => void handleSaveCredential("anthropic", anthropicKeyInput)}
                >
                  Save
                </button>
                {anthropicStatus.source === "app" ? (
                  <button
                    className="button button-outline"
                    type="button"
                    onClick={() => void handleRemoveCredential("anthropic")}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            <div className="credential-row">
              <div className="credential-row-header">
                <strong>OpenAI API Key (GPT)</strong>
                <span className={`status-badge status-${openaiStatus.source}`}>
                  {openaiStatus.source === "app"
                    ? "Configured in App"
                    : openaiStatus.source === "env"
                      ? "Configured via Env"
                      : "Not Configured"}
                </span>
                <span className="credential-protection">
                  {openaiStatus.protection === "os-backed"
                    ? "OS-backed encryption"
                    : openaiStatus.protection === "basic-text"
                      ? "Linux basic_text (weak protection)"
                      : openaiStatus.protection === "local-aes-gcm"
                        ? "Local AES fallback (key stored beside app data)"
                        : openaiStatus.protection === "environment"
                          ? "Environment variable"
                          : openaiStatus.protection === "session-memory"
                            ? "Session memory only"
                            : "No credential"}
                </span>
              </div>
              <div className="credential-input-group">
                <input
                  className="url-input"
                  type={showOpenaiKey ? "text" : "password"}
                  placeholder={openaiStatus.configured ? "••••••••••••••••••••••••" : "sk-proj-…"}
                  value={openaiKeyInput}
                  onChange={(event) => setOpenaiKeyInput(event.target.value)}
                  aria-label="OpenAI API Key"
                />
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => setShowOpenaiKey((prev) => !prev)}
                >
                  {showOpenaiKey ? "Hide" : "Show"}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={openaiKeyInput.trim() === ""}
                  onClick={() => void handleSaveCredential("openai", openaiKeyInput)}
                >
                  Save
                </button>
                {openaiStatus.source === "app" ? (
                  <button
                    className="button button-outline"
                    type="button"
                    onClick={() => void handleRemoveCredential("openai")}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
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
    return (
      <main className="app-shell">
        {renderSettingsModal()}
        <header className="topbar">
          <div>
            <p className="eyebrow">DraftLoop / Workspace setup</p>
            <h1>Bring your source material into the loop</h1>
          </div>
          <div className="run-identity">
            <button
              className="button button-quiet button-credentials"
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              API Keys
            </button>
            <span>{state.workspaceId}</span>
            <span className="state-pill state-collecting">Collecting inputs</span>
          </div>
        </header>
        <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
          <p className="eyebrow">Before the first run</p>
          <h2 id="onboarding-title">Add the sources DraftLoop is allowed to use</h2>
          <p className="onboarding-copy">
            Your files stay in this workspace. DraftLoop will not invent missing experience or start
            an agent run until the target job and candidate source material are present.
          </p>
          {errorMessage ? (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          ) : null}
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
              <strong>Candidate source material</strong>
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
            <article className="setup-card">
              <span className="setup-number">03</span>
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
            <button
              className="button button-primary"
              type="button"
              disabled={
                !state.setup.ready || !transmissionReady || pendingReviewAction?.action === "start"
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
              {pendingReviewAction.elapsedSeconds === 1 ? "" : "s"}. Keep this window open while the
              review starts.
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {renderSettingsModal()}
      <header className="topbar">
        <div>
          <p className="eyebrow">DraftLoop / Review workspace</p>
          <h1>Sources before approval</h1>
        </div>
        <div className="run-identity">
          <button
            className="button button-quiet button-credentials"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            API Keys
          </button>
          <span>{state.workspaceId}</span>
          <span className={`state-pill state-${state.state}`}>{stateLabel(state.state)}</span>
          <span className="approval-pill">{approvalLabel}</span>
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
                {retryRemainingMs > 0 ? `Retry in ${retryWaitLabel(retryRemainingMs)}` : "Retry"}
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
            : findingSummary.status === "blocked"
              ? "Approval is unavailable until every blocking finding is resolved or explicitly overridden."
              : findingSummary.status === "warnings"
                ? "Approval remains your decision; unresolved warnings will stay visible in the review history."
                : "All findings have a recorded decision."}
        </span>
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
              {state.artifact.claims.map((claim) => (
                <article className={`claim-card claim-${claim.status}`} key={claim.id}>
                  <div className="claim-heading">
                    <strong>{claim.text}</strong>
                    <span className="status-tag">{claimSourceLabel(claim)}</span>
                  </div>
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
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Critique</p>
                <h2>Findings</h2>
              </div>
              <span className="count-badge">
                {!hasArtifact
                  ? "Not evaluated"
                  : unresolvedFindings.length === 0
                    ? "All resolved"
                    : `${blockingFindings.length} blocking · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {pendingReviewAction?.action === "finding-decision" ? (
              <p className="pending-action-status" role="status" aria-live="polite">
                Saving finding decision… Elapsed {pendingReviewAction.elapsedSeconds} second
                {pendingReviewAction.elapsedSeconds === 1 ? "" : "s"}. Keep this window open while
                the decision is saved.
              </p>
            ) : null}
            {state.findings.map((finding) => {
              const claim =
                finding.claimId === undefined ? undefined : claimById.get(finding.claimId);
              return (
                <article
                  className={`finding-card finding-${finding.severity}${
                    finding.decision === "pending" || finding.decision === "deferred"
                      ? ""
                      : " finding-resolved"
                  }`}
                  key={finding.id}
                >
                  <div className="finding-meta">
                    <span className={`severity severity-${finding.severity}`}>
                      {finding.severity === "error" ? "blocking" : "warning"}
                    </span>
                    <span>{finding.category}</span>
                    <span>{finding.code}</span>
                    <span className={`finding-resolution resolution-${finding.decision}`}>
                      {decisionLabels[finding.decision]}
                    </span>
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
                            pendingReviewAction?.action === "finding-decision" ||
                            (decision === "overridden" &&
                              (overrideReasons[finding.id] ?? finding.rationale ?? "").trim() ===
                                "")
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
            <div className="approval-actions">
              <button
                className="button button-primary"
                type="button"
                aria-keyshortcuts="Alt+A"
                title="Approve artifact (Alt+A)"
                disabled={!canApprove}
                onClick={() => onAction({ type: "approve" })}
              >
                Approve artifact (Alt+A)
              </button>
              <button
                className="button button-quiet"
                type="button"
                aria-keyshortcuts="Alt+R"
                title="Request revision (Alt+R)"
                disabled={state.state !== "awaiting-approval" || !transmissionReady}
                onClick={() => onAction({ type: "request-revision" })}
              >
                Request revision (Alt+R)
              </button>
            </div>
            <div className="export-action">
              <div>
                <strong>Export locally</strong>
                <span>
                  {state.exportPath ??
                    (state.approval === "approved" ? "Available now" : "Available after approval")}
                </span>
              </div>
              <button
                className="button button-outline"
                type="button"
                aria-keyshortcuts="Alt+E"
                title="Export Markdown (Alt+E)"
                disabled={state.state !== "approved"}
                onClick={() => onAction({ type: "export" })}
              >
                Export Markdown (Alt+E)
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
