import { useCallback, useEffect, useId, useRef, useState } from "react";

import type {
  EmbeddingModelPlanResult,
  EmbeddingModelStatusResult,
  WorkspaceRetrievalModeResult,
} from "./bridge.js";
import type { DesktopSemanticRetrievalCapabilities } from "./native.js";
import {
  defaultEmbeddingModelTier,
  defaultRetrievalMode,
  type EmbeddingModelTier,
  embeddingModelDestinationLabel,
  embeddingModelInstallCancelledMessage,
  embeddingModelTiers,
  type RetrievalMode,
} from "./semantic-retrieval-contract.js";
import {
  embeddingModelStateLabel,
  embeddingTierChoices,
  formatModelSize,
  installProgressPercent,
  retrievalFallbackNote,
  retrievalModeChoices,
} from "./semantic-retrieval-presentation.js";

export const semanticRetrievalUnavailableMessage =
  "Local semantic retrieval is unavailable in this desktop host. Runs use keyword retrieval.";

const installProgressPollMs = 500;

export interface InstallProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

/** Whether the host offers every command the model controls need. */
export function hasSemanticRetrievalCapabilities(
  capabilities: DesktopSemanticRetrievalCapabilities,
): capabilities is DesktopSemanticRetrievalCapabilities &
  Required<
    Pick<
      DesktopSemanticRetrievalCapabilities,
      | "getEmbeddingModelStatus"
      | "planEmbeddingModelInstall"
      | "installEmbeddingModel"
      | "removeEmbeddingModel"
      | "getRetrievalMode"
      | "setRetrievalMode"
    >
  > {
  return (
    capabilities.getEmbeddingModelStatus !== undefined &&
    capabilities.planEmbeddingModelInstall !== undefined &&
    capabilities.installEmbeddingModel !== undefined &&
    capabilities.removeEmbeddingModel !== undefined &&
    capabilities.getRetrievalMode !== undefined &&
    capabilities.setRetrievalMode !== undefined
  );
}

/** A host with no semantic capability at all (browser or fixture) shows no panel. */
export function hasAnySemanticRetrievalCapability(
  capabilities: DesktopSemanticRetrievalCapabilities,
): boolean {
  return (
    capabilities.getEmbeddingModelStatus !== undefined ||
    capabilities.getRetrievalMode !== undefined
  );
}

function isInstallCancelled(reason: unknown): boolean {
  return reason instanceof Error && reason.message === embeddingModelInstallCancelledMessage;
}

function sourceLabel(sourceUrl: string): string {
  return sourceUrl.replace(/^https:\/\//u, "");
}

/** The approval step: everything the download involves, before anything is downloaded. */
export function EmbeddingInstallApproval({
  plan,
  onConfirm,
  onDismiss,
}: {
  readonly plan: EmbeddingModelPlanResult;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}) {
  const headingId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.focus();
  }, []);
  return (
    <section
      className="semantic-approval"
      aria-labelledby={headingId}
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDismiss();
      }}
    >
      <h3 id={headingId}>Approve model download</h3>
      <p className="knowledge-copy">
        DraftLoop will download this model once and keep it on this computer. Nothing is downloaded
        until you confirm, and your candidate material is never uploaded.
      </p>
      <dl className="semantic-approval-facts">
        <div>
          <dt>Source</dt>
          <dd>
            Hugging Face, {sourceLabel(plan.sourceUrl)} (pinned revision{" "}
            <code>{plan.revision.slice(0, 12)}</code>)
          </dd>
        </div>
        <div>
          <dt>Download size</dt>
          <dd>{formatModelSize(plan.totalSizeBytes)}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{plan.license}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{embeddingModelDestinationLabel}</dd>
        </div>
      </dl>
      <ul className="semantic-approval-files" aria-label="Files to download">
        {plan.files.map((file) => (
          <li key={file.path}>
            <code>{file.path}</code>
            <span>{formatModelSize(file.sizeBytes)}</span>
          </li>
        ))}
      </ul>
      <div className="knowledge-actions">
        <button type="button" className="button button-primary" onClick={onConfirm}>
          Confirm download
        </button>
        <button type="button" className="button button-outline" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export interface SemanticRetrievalViewProps {
  readonly tier: EmbeddingModelTier;
  readonly mode: RetrievalMode;
  readonly status: EmbeddingModelStatusResult | null;
  readonly loading: boolean;
  readonly approval: EmbeddingModelPlanResult | null;
  readonly installing: boolean;
  readonly progress?: InstallProgress | undefined;
  readonly cancelRequested: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onTierChange: (tier: EmbeddingModelTier) => void;
  readonly onModeChange: (mode: RetrievalMode) => void;
  readonly onRequestInstall: () => void;
  readonly onConfirmInstall: () => void;
  readonly onDismissApproval: () => void;
  readonly onCancelInstall: () => void;
  readonly onRemove: () => void;
}

export function SemanticRetrievalView({
  tier,
  mode,
  status,
  loading,
  approval,
  installing,
  progress,
  cancelRequested,
  message,
  error,
  disabled,
  onTierChange,
  onModeChange,
  onRequestInstall,
  onConfirmInstall,
  onDismissApproval,
  onCancelInstall,
  onRemove,
}: SemanticRetrievalViewProps) {
  const tierId = useId();
  const state = installing ? "installing" : status?.state;
  const fallback = loading ? null : retrievalFallbackNote(mode, state);
  const percent =
    progress === undefined
      ? 0
      : installProgressPercent(progress.receivedBytes, progress.totalBytes);
  const installable = state === "absent" || state === "corrupt";
  const controlsDisabled = disabled || installing;
  return (
    <section
      className="panel knowledge-panel semantic-panel"
      aria-labelledby="semantic-retrieval-heading"
    >
      <div>
        <p className="eyebrow">Career evidence</p>
        <h2 id="semantic-retrieval-heading">Semantic retrieval</h2>
      </div>
      <p className="knowledge-copy">
        Choose how this workspace searches your candidate knowledge. Semantic and hybrid modes use a
        small model that runs on this computer; the model is downloaded only after you approve it.
      </p>

      <div className="semantic-model">
        <label className="setup-field" htmlFor={tierId}>
          <span>Model size</span>
          <select
            id={tierId}
            value={tier}
            disabled={controlsDisabled}
            onChange={(event) => onTierChange(event.currentTarget.value as EmbeddingModelTier)}
          >
            {embeddingTierChoices.map((choice) => (
              <option key={choice.tier} value={choice.tier}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <div className="semantic-model-status">
          <span className="semantic-status-label">Model status</span>
          {state === undefined ? (
            <span className="meta-chip semantic-badge" data-state="loading">
              {loading ? "Checking…" : "Unknown"}
            </span>
          ) : (
            <span className="meta-chip semantic-badge" data-state={state}>
              {embeddingModelStateLabel(state)}
            </span>
          )}
          {status === null ? null : (
            <span className="semantic-model-size">{formatModelSize(status.totalSizeBytes)}</span>
          )}
        </div>
        <div className="knowledge-actions">
          {installable ? (
            <button
              type="button"
              className="button button-primary"
              disabled={controlsDisabled || approval !== null}
              onClick={onRequestInstall}
            >
              {state === "corrupt" ? "Reinstall model" : "Install model"}
            </button>
          ) : null}
          {state === "ready" || state === "corrupt" ? (
            <button
              type="button"
              className="button button-outline"
              disabled={controlsDisabled}
              onClick={onRemove}
            >
              Remove model
            </button>
          ) : null}
        </div>
      </div>

      {approval === null || installing ? null : (
        <EmbeddingInstallApproval
          plan={approval}
          onConfirm={onConfirmInstall}
          onDismiss={onDismissApproval}
        />
      )}

      {installing ? (
        <div className="semantic-progress">
          <p className="sr-only" role="status">
            Downloading the local model.
          </p>
          <div className="semantic-progress-row" aria-hidden="true">
            <strong>Downloading model…</strong>
            {progress === undefined ? null : (
              <span className="semantic-progress-figures">
                {formatModelSize(progress.receivedBytes)} of {formatModelSize(progress.totalBytes)}{" "}
                ({percent}%)
              </span>
            )}
          </div>
          <progress
            className="semantic-progress-bar"
            max={100}
            {...(progress === undefined ? {} : { value: percent })}
            aria-label="Model download progress"
          />
          <button
            type="button"
            className="button button-outline semantic-cancel"
            disabled={cancelRequested}
            onClick={onCancelInstall}
          >
            {cancelRequested ? "Cancelling…" : "Cancel download"}
          </button>
        </div>
      ) : null}

      <fieldset className="semantic-mode" disabled={disabled}>
        <legend>Retrieval mode</legend>
        {retrievalModeChoices.map((choice) => (
          <label className="semantic-mode-choice" key={choice.mode}>
            <input
              type="radio"
              name="workspace-retrieval-mode"
              value={choice.mode}
              checked={mode === choice.mode}
              onChange={() => onModeChange(choice.mode)}
            />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {fallback === null ? null : (
        <p className="semantic-fallback" role="note">
          {fallback}
        </p>
      )}
      {message === null ? null : (
        <p className="knowledge-status" role="status">
          {message}
        </p>
      )}
      {error === null ? null : (
        <p className="semantic-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export interface SemanticRetrievalPanelProps {
  readonly workspaceId: string;
  readonly capabilities: DesktopSemanticRetrievalCapabilities;
  readonly disabled: boolean;
}

function failureMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() !== "" ? reason.message : fallback;
}

/** The workspace's semantic retrieval settings and the local model they depend on. */
export function SemanticRetrievalPanel({
  workspaceId,
  capabilities,
  disabled,
}: SemanticRetrievalPanelProps) {
  const supported = hasSemanticRetrievalCapabilities(capabilities);
  const [tier, setTier] = useState<EmbeddingModelTier>(defaultEmbeddingModelTier);
  const [mode, setMode] = useState<RetrievalMode>(defaultRetrievalMode);
  const [status, setStatus] = useState<EmbeddingModelStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [approval, setApproval] = useState<EmbeddingModelPlanResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | undefined>(undefined);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const generation = useRef(0);
  const installLatch = useRef(false);
  const installingTier = useRef<EmbeddingModelTier>(defaultEmbeddingModelTier);

  const loadStatus = useCallback(async (forTier: EmbeddingModelTier, token: number) => {
    const read = capabilitiesRef.current.getEmbeddingModelStatus;
    if (read === undefined) return;
    setLoading(true);
    try {
      const result = await read(forTier);
      if (generation.current !== token) return;
      setStatus(result);
      setError(null);
    } catch (reason: unknown) {
      if (generation.current !== token) return;
      setStatus(null);
      setError(failureMessage(reason, "The model status could not be read."));
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }, []);

  // Load the saved retrieval setting and the status of its tier whenever the workspace changes.
  useEffect(() => {
    const token = ++generation.current;
    const read = capabilitiesRef.current.getRetrievalMode;
    setApproval(null);
    setMessage(null);
    setError(null);
    setStatus(null);
    if (read === undefined || capabilitiesRef.current.getEmbeddingModelStatus === undefined) {
      setLoading(false);
      return () => {
        generation.current += 1;
      };
    }
    setLoading(true);
    void read(workspaceId).then(
      (record: WorkspaceRetrievalModeResult) => {
        if (generation.current !== token) return;
        setMode(record.mode);
        setTier(record.modelTier);
        void loadStatus(record.modelTier, token);
      },
      (reason: unknown) => {
        if (generation.current !== token) return;
        setLoading(false);
        setError(failureMessage(reason, "The retrieval mode could not be read."));
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [workspaceId, loadStatus]);

  const pollProgress = capabilities.getEmbeddingModelProgress;
  useEffect(() => {
    if (!installing || pollProgress === undefined) return;
    let active = true;
    const timer = setInterval(() => {
      void pollProgress(installingTier.current)
        .then((result) => {
          if (!active || !result.active) return;
          if (result.receivedBytes === undefined || result.totalBytes === undefined) return;
          setProgress({ receivedBytes: result.receivedBytes, totalBytes: result.totalBytes });
        })
        .catch(() => {
          // Progress is advisory; a missed poll never fails the install itself.
        });
    }, installProgressPollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [installing, pollProgress]);

  if (!supported) {
    return (
      <section className="panel knowledge-panel" aria-labelledby="semantic-retrieval-heading">
        <h2 id="semantic-retrieval-heading">Semantic retrieval</h2>
        <p className="knowledge-copy">{semanticRetrievalUnavailableMessage}</p>
      </section>
    );
  }

  const saveSetting = (nextMode: RetrievalMode, nextTier: EmbeddingModelTier) => {
    const token = generation.current;
    const previous = { mode, tier };
    setMode(nextMode);
    setTier(nextTier);
    setMessage(null);
    setError(null);
    void capabilities.setRetrievalMode(workspaceId, nextMode, nextTier).then(
      (record) => {
        if (generation.current !== token) return;
        setMode(record.mode);
        setTier(record.modelTier);
        setMessage("Retrieval setting saved for this workspace.");
      },
      (reason: unknown) => {
        if (generation.current !== token) return;
        setMode(previous.mode);
        setTier(previous.tier);
        setError(failureMessage(reason, "The retrieval setting could not be saved."));
      },
    );
  };

  const changeTier = (nextTier: EmbeddingModelTier) => {
    if (!embeddingModelTiers.includes(nextTier) || nextTier === tier) return;
    // A new token drops any late answer about the previous tier.
    const token = ++generation.current;
    setApproval(null);
    setStatus(null);
    saveSetting(mode, nextTier);
    void loadStatus(nextTier, token);
  };

  const requestInstall = () => {
    if (installLatch.current) return;
    const token = generation.current;
    setError(null);
    setMessage(null);
    void capabilities.planEmbeddingModelInstall(tier).then(
      (plan) => {
        if (generation.current === token) setApproval(plan);
      },
      (reason: unknown) => {
        if (generation.current === token) {
          setError(failureMessage(reason, "The model download could not be prepared."));
        }
      },
    );
  };

  const confirmInstall = () => {
    if (installLatch.current) return;
    installLatch.current = true;
    installingTier.current = tier;
    const token = generation.current;
    setApproval(null);
    setProgress(undefined);
    setCancelRequested(false);
    setInstalling(true);
    void capabilities
      .installEmbeddingModel(tier)
      .then(
        (result) => {
          if (generation.current !== token) return;
          setStatus(result);
          setMessage("The local model is installed.");
        },
        (reason: unknown) => {
          if (generation.current !== token) return;
          if (isInstallCancelled(reason)) {
            setMessage("Download cancelled. Nothing was installed.");
          } else {
            setError(failureMessage(reason, "The model could not be installed."));
          }
        },
      )
      .finally(() => {
        installLatch.current = false;
        if (generation.current !== token) return;
        setInstalling(false);
        setProgress(undefined);
        setCancelRequested(false);
        void loadStatus(installingTier.current, token);
      });
  };

  const cancelInstall = () => {
    const cancel = capabilities.cancelEmbeddingModelInstall;
    if (cancel === undefined || cancelRequested) return;
    setCancelRequested(true);
    void cancel(installingTier.current).catch(() => {
      // The download keeps running; let the candidate try again.
      setCancelRequested(false);
    });
  };

  const remove = () => {
    const token = generation.current;
    setError(null);
    setMessage(null);
    void capabilities.removeEmbeddingModel(tier).then(
      (result) => {
        if (generation.current !== token) return;
        setStatus(result);
        setMessage("The local model was removed.");
      },
      (reason: unknown) => {
        if (generation.current === token) {
          setError(failureMessage(reason, "The model could not be removed."));
        }
      },
    );
  };

  return (
    <SemanticRetrievalView
      tier={tier}
      mode={mode}
      status={status}
      loading={loading}
      approval={approval}
      installing={installing}
      progress={progress}
      cancelRequested={cancelRequested}
      message={message}
      error={error}
      disabled={disabled}
      onTierChange={changeTier}
      onModeChange={(nextMode) => saveSetting(nextMode, tier)}
      onRequestInstall={requestInstall}
      onConfirmInstall={confirmInstall}
      onDismissApproval={() => setApproval(null)}
      onCancelInstall={cancelInstall}
      onRemove={remove}
    />
  );
}
