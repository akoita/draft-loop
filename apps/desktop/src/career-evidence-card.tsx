import { useEffect, useRef, useState } from "react";

import {
  addCareerEvidence,
  type CareerEvidenceCapabilities,
  type CareerEvidenceSource,
  type CareerEvidenceStatus,
  careerEvidenceReadinessText,
  careerEvidenceReady,
  careerEvidenceSourcesText,
  loadCareerEvidenceStatus,
  supportsCareerEvidence,
} from "./career-evidence.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import { isKnowledgeOperationCancelled } from "./knowledge-cancel.js";
import type { WorkspaceReadiness } from "./model.js";

/** The host connection that lets the card follow, and add to, the workspace's knowledge base. */
export interface CareerEvidenceBinding {
  readonly workspaceId: string;
  readonly capabilities: CareerEvidenceCapabilities;
  /** Bumped whenever the workspace's knowledge selection or contents may have changed. */
  readonly revision: number;
  readonly disabled: boolean;
  readonly onChanged: (workspaceId: string) => Promise<boolean>;
  readonly onPendingChange: (workspaceId: string, pending: boolean) => void;
}

export const knowledgeStoreFocusTargetId = "candidate-knowledge-name";

/** Takes the person to the Knowledge store section so they can create or choose a base. */
export function focusKnowledgeStore(documentRef: Document = document): boolean {
  const target = documentRef.getElementById(knowledgeStoreFocusTargetId);
  if (target === null) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
  return true;
}

export function legacyRetrievalText(
  setup: Pick<
    WorkspaceReadiness,
    "retrievalStatus" | "selectedEvidenceChunkCount" | "selectedEvidenceSourceCount"
  >,
): string {
  const chunks = setup.selectedEvidenceChunkCount;
  const sources = setup.selectedEvidenceSourceCount;
  switch (setup.retrievalStatus) {
    case "matched":
      return `${chunks} relevant excerpt${chunks === 1 ? "" : "s"} selected from ${sources} source${sources === 1 ? "" : "s"}`;
    case "fallback":
      return `No lexical match; ${chunks} bounded fallback excerpt${chunks === 1 ? "" : "s"} selected`;
    case "no-query":
      return "The job description has no searchable role terms";
    case "unavailable":
      return "Retrieval readiness is unavailable";
    case "not-indexed":
      return "Evidence will be indexed when the review starts";
  }
}

export interface CareerEvidenceCardViewProps {
  readonly status: CareerEvidenceStatus;
  readonly setup: Pick<
    WorkspaceReadiness,
    | "evidenceSourceCount"
    | "retrievalStatus"
    | "selectedEvidenceChunkCount"
    | "selectedEvidenceSourceCount"
  >;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly url: string;
  readonly onUrlChange: (url: string) => void;
  readonly onAddFile: () => void;
  readonly onAddUrl: () => void;
  readonly onChooseKnowledgeBase: () => void;
  /** False when the host offers no way to add files or a URL in the current mode. */
  readonly canAddFile: boolean;
  readonly canAddUrl: boolean;
}

export function CareerEvidenceCardView({
  status,
  setup,
  pending,
  disabled,
  message,
  error,
  url,
  onUrlChange,
  onAddFile,
  onAddUrl,
  onChooseKnowledgeBase,
  canAddFile,
  canAddUrl,
}: CareerEvidenceCardViewProps) {
  const ready = careerEvidenceReady(status, setup.evidenceSourceCount);
  const legacyCount = setup.evidenceSourceCount;
  const inKnowledgeBase = status.kind === "selected" || status.kind === "loading";
  const showAdd = status.kind !== "unavailable";
  const blocked = disabled || pending;
  const addDisabled = blocked || status.kind === "loading";
  const fileLabel =
    status.kind === "none"
      ? "Add to legacy workspace evidence"
      : status.kind === "unsupported"
        ? "Add source files"
        : "Add files";
  const urlLabel =
    status.kind === "none" ? "Add URL to legacy evidence" : "Review and fetch source URL";
  return (
    <article className={`setup-card${ready ? " setup-card-ready" : ""}`}>
      <div className="setup-card-head">
        <span className="setup-number">02</span>
        <span className={`setup-state${ready ? " setup-state-ready" : ""}`}>
          {ready ? "Ready" : "Required"}
        </span>
      </div>
      <strong>Career evidence</strong>
      {status.kind === "loading" ? (
        <span role="status">Checking the knowledge base…</span>
      ) : status.kind === "selected" ? (
        <>
          <span>{careerEvidenceSourcesText(status)}</span>
          <span className="setup-retrieval-status setup-card-line" role="status">
            {careerEvidenceReadinessText(status)}
          </span>
          {status.semanticLine === null ? null : (
            <span className="setup-card-line">{status.semanticLine}</span>
          )}
        </>
      ) : status.kind === "unavailable" ? (
        <span role="status">
          The selected knowledge base could not be opened. Open its store in the Knowledge store
          section below.
        </span>
      ) : status.kind === "none" ? (
        <>
          <span role="status">
            No knowledge base selected — runs will use legacy workspace evidence
            {legacyCount > 0 ? ` (${legacyCount} source${legacyCount === 1 ? "" : "s"})` : ""}.
          </span>
          <button
            className="button button-primary"
            type="button"
            disabled={blocked}
            onClick={onChooseKnowledgeBase}
          >
            Create or choose a knowledge base
          </button>
        </>
      ) : (
        <>
          <span>
            {legacyCount === 0
              ? "Add a CV, portfolio, or other source"
              : `${legacyCount} source${legacyCount === 1 ? "" : "s"} ready`}
          </span>
          {legacyCount > 0 ? (
            <span className="setup-retrieval-status" role="status">
              {legacyRetrievalText(setup)}
            </span>
          ) : null}
        </>
      )}
      {message === null ? null : (
        <span className="setup-retrieval-status setup-card-line" role="status">
          {message}
        </span>
      )}
      {error === null ? null : (
        <span className="setup-card-line" role="alert">
          {error}
        </span>
      )}
      {showAdd ? (
        <>
          <button
            className="button button-quiet"
            type="button"
            disabled={addDisabled || !canAddFile}
            onClick={onAddFile}
          >
            {fileLabel}
          </button>
          <label className="url-input-label">
            <span>Or provide a public URL</span>
            <input
              className="url-input"
              type="url"
              placeholder="https://github.com/…"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              aria-label={inKnowledgeBase ? "Career evidence URL" : "Candidate source URL"}
            />
          </label>
          <button
            className="button button-outline"
            type="button"
            disabled={addDisabled || !canAddUrl || url.trim() === ""}
            onClick={onAddUrl}
          >
            {urlLabel}
          </button>
        </>
      ) : null}
    </article>
  );
}

export interface CareerEvidenceCardProps {
  readonly setup: CareerEvidenceCardViewProps["setup"];
  readonly knowledge?: CareerEvidenceBinding | undefined;
  readonly onSelectLegacyFiles?: (() => void) | undefined;
  readonly onAddLegacyUrl?: ((url: string) => void) | undefined;
}

function failureText(reason: unknown): string {
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : "The source could not be added to the knowledge base.";
}

/** Setup card 02: the knowledge base the run will use, with add actions that import into it. */
export function CareerEvidenceCard({
  setup,
  knowledge,
  onSelectLegacyFiles,
  onAddLegacyUrl,
}: CareerEvidenceCardProps) {
  const capabilities = knowledge?.capabilities;
  const supported = capabilities !== undefined && supportsCareerEvidence(capabilities);
  const workspaceId = knowledge?.workspaceId;
  const revision = knowledge?.revision;
  const [status, setStatus] = useState<CareerEvidenceStatus>(
    supported ? { kind: "loading" } : { kind: "unsupported" },
  );
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const loadGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const pendingLatch = useRef(false);
  const loadedWorkspace = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      operationGeneration.current += 1;
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` re-reads the base after the knowledge changes, and `supported` re-reads when the host gains the capability; the capabilities themselves go through a ref so a new object never refetches.
  useEffect(() => {
    const current = capabilitiesRef.current;
    if (current === undefined || workspaceId === undefined || !supportsCareerEvidence(current)) {
      setStatus({ kind: "unsupported" });
      return;
    }
    const token = ++loadGeneration.current;
    if (loadedWorkspace.current !== workspaceId) {
      // A different workspace: drop its predecessor's status, message and in-flight add.
      operationGeneration.current += 1;
      setStatus({ kind: "loading" });
      setMessage(null);
      setError(null);
    }
    loadedWorkspace.current = workspaceId;
    void loadCareerEvidenceStatus(current, workspaceId, safeKnowledgeBaseDisplayName).then(
      (loaded) => {
        if (loadGeneration.current === token) setStatus(loaded);
      },
    );
    return () => {
      loadGeneration.current += 1;
    };
  }, [workspaceId, revision, supported]);

  const addToKnowledgeBase = (source: CareerEvidenceSource) => {
    if (
      knowledge === undefined ||
      status.kind !== "selected" ||
      pendingLatch.current ||
      knowledge.disabled
    ) {
      return;
    }
    const { storeId, knowledgeBaseId, displayName } = status;
    const operationWorkspaceId = knowledge.workspaceId;
    const generation = operationGeneration.current;
    pendingLatch.current = true;
    setPending(true);
    knowledge.onPendingChange(operationWorkspaceId, true);
    setMessage(null);
    setError(null);
    void addCareerEvidence({
      capabilities: knowledge.capabilities,
      workspaceId: operationWorkspaceId,
      target: { storeId, knowledgeBaseId },
      displayName,
      source,
      isCurrent: () => operationGeneration.current === generation,
      onChanged: knowledge.onChanged,
    })
      .then((outcome) => {
        if (outcome.status !== "added" || operationGeneration.current !== generation) return;
        setMessage(outcome.message);
        if (source.kind === "url") setUrl("");
      })
      .catch((reason: unknown) => {
        if (operationGeneration.current !== generation || isKnowledgeOperationCancelled(reason)) {
          return;
        }
        setError(failureText(reason));
      })
      .finally(() => {
        pendingLatch.current = false;
        setPending(false);
        knowledge.onPendingChange(operationWorkspaceId, false);
      });
  };

  const inKnowledgeBase = status.kind === "selected" || status.kind === "loading";

  return (
    <CareerEvidenceCardView
      status={status}
      setup={setup}
      pending={pending}
      disabled={knowledge?.disabled ?? false}
      message={message}
      error={error}
      url={url}
      onUrlChange={setUrl}
      canAddFile={inKnowledgeBase || onSelectLegacyFiles !== undefined}
      canAddUrl={inKnowledgeBase || onAddLegacyUrl !== undefined}
      onChooseKnowledgeBase={() => {
        focusKnowledgeStore();
      }}
      onAddFile={() => {
        if (inKnowledgeBase) addToKnowledgeBase({ kind: "file" });
        else onSelectLegacyFiles?.();
      }}
      onAddUrl={() => {
        const value = url.trim();
        if (value === "") return;
        if (inKnowledgeBase) {
          addToKnowledgeBase({ kind: "url", url: value });
        } else if (onAddLegacyUrl !== undefined) {
          onAddLegacyUrl(value);
          setUrl("");
        }
      }}
    />
  );
}
