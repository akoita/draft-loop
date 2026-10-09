import { type ReactNode, useEffect, useRef, useState } from "react";

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
import { defaultKnowledgeStoreDestinationLabel } from "./career-evidence-contract.js";
import {
  addFirstCareerEvidence,
  type NoSelectionMode,
  noSelectionMode,
  supportsAutomaticKnowledgeBase,
} from "./career-evidence-setup.js";
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
  /** Asks the Knowledge base section to open its create-or-open form and focus it. */
  readonly onRequestStoreForm?: () => void;
  readonly onPendingChange: (workspaceId: string, pending: boolean) => void;
}

export const knowledgeStoreFocusTargetId = "candidate-knowledge-heading";

/** Takes the person to the Knowledge base section, where they can choose or switch the base. */
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

/** The URLs typed in the card, one per line or separated by spaces, without blanks or repeats. */
export function parseSourceUrls(text: string): readonly string[] {
  return [...new Set(text.split(/\s+/u).filter((value) => value !== ""))];
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
  /** Imports a whole folder into the base; shown only when evidence goes into a knowledge base. */
  readonly onAddFolder?: () => void;
  readonly onAddUrl: () => void;
  readonly onChooseKnowledgeBase: () => void;
  /** False when the host offers no way to add files or a URL in the current mode. */
  readonly canAddFile: boolean;
  readonly canAddUrl: boolean;
  /**
   * The Knowledge base section: which base the workspace uses, the legacy import and the store.
   * It sits inside the card so the page has one place for career evidence.
   */
  readonly knowledgeBase?: ReactNode;
  /**
   * True when the host can create and select a knowledge base itself, so the first add creates
   * one instead of going to legacy workspace evidence.
   */
  readonly automatic?: boolean;
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
  onAddFolder,
  onAddUrl,
  onChooseKnowledgeBase,
  canAddFile,
  canAddUrl,
  automatic = false,
  knowledgeBase = null,
}: CareerEvidenceCardViewProps) {
  const legacyCount = setup.evidenceSourceCount;
  const mode: NoSelectionMode | null = status.kind === "none" ? noSelectionMode(automatic) : null;
  // Without a base the first add creates one; legacy workspace evidence no longer counts here.
  const ready = mode !== "first-add" && careerEvidenceReady(status, legacyCount);
  const intoKnowledgeBase = status.kind === "selected" || status.kind === "loading";
  const inKnowledgeBase = intoKnowledgeBase || mode === "first-add";
  const showAdd = status.kind !== "unavailable";
  const blocked = disabled || pending;
  const addDisabled = blocked || status.kind === "loading";
  const fileLabel =
    mode === "legacy"
      ? "Add to legacy workspace evidence"
      : status.kind === "unsupported"
        ? "Add source files"
        : "Add files";
  const urlCount = parseSourceUrls(url).length;
  // Legacy workspace evidence imports one URL per request; only a knowledge base takes several.
  const tooManyForLegacy = !inKnowledgeBase && urlCount > 1;
  const urlLabel = tooManyForLegacy
    ? "Legacy evidence takes one URL at a time"
    : mode === "legacy"
      ? "Add URL to legacy evidence"
      : urlCount > 1
        ? `Review and fetch ${urlCount} source URLs`
        : "Review and fetch source URL";
  return (
    <article className={`setup-card${ready ? " setup-card-ready" : ""}`}>
      <div className="setup-card-head">
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
          The selected knowledge base could not be opened. Open its store in the Knowledge base
          section below.
        </span>
      ) : status.kind === "none" && mode === "first-add" ? (
        <>
          <span role="status">
            No career evidence yet. Adding the first source creates a knowledge base for this
            workspace in {defaultKnowledgeStoreDestinationLabel}.
          </span>
          <button
            className="button button-quiet"
            type="button"
            disabled={blocked}
            onClick={onChooseKnowledgeBase}
          >
            Create or choose a knowledge base
          </button>
        </>
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
          {inKnowledgeBase && onAddFolder !== undefined ? (
            <button
              className="button button-quiet"
              type="button"
              disabled={addDisabled}
              onClick={onAddFolder}
            >
              Add folder
            </button>
          ) : null}
          <label className="url-input-label">
            <span>Or provide public URLs, one per line</span>
            <textarea
              className="url-input"
              rows={3}
              placeholder={"https://github.com/…\nhttps://www.linkedin.com/in/…"}
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              aria-label={
                inKnowledgeBase ? "Career evidence URLs" : "Legacy workspace evidence URLs"
              }
            />
          </label>
          <button
            className="button button-outline"
            type="button"
            disabled={addDisabled || !canAddUrl || urlCount === 0 || tooManyForLegacy}
            onClick={onAddUrl}
          >
            {urlLabel}
          </button>
        </>
      ) : null}
      {knowledgeBase}
    </article>
  );
}

export interface CareerEvidenceCardProps {
  readonly setup: CareerEvidenceCardViewProps["setup"];
  readonly knowledge?: CareerEvidenceBinding | undefined;
  readonly onSelectLegacyFiles?: (() => void) | undefined;
  readonly onAddLegacyUrl?: ((url: string) => void) | undefined;
  /** The Knowledge base section shown at the bottom of the card. */
  readonly knowledgeBase?: ReactNode;
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
  knowledgeBase,
}: CareerEvidenceCardProps) {
  const capabilities = knowledge?.capabilities;
  const supported = capabilities !== undefined && supportsCareerEvidence(capabilities);
  const automatic = supported && supportsAutomaticKnowledgeBase(capabilities);
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

  /**
   * Runs one host operation under the card's single-flight latch. `work` resolves to the text to
   * show, or null when the operation was superseded and must stay silent.
   */
  const runOperation = (
    work: (isCurrent: () => boolean) => Promise<string | null>,
    options: { readonly progress?: string; readonly failureFallback?: string } = {},
  ): Promise<boolean> => {
    if (knowledge === undefined || pendingLatch.current || knowledge.disabled) {
      return Promise.resolve(false);
    }
    const operationWorkspaceId = knowledge.workspaceId;
    const generation = operationGeneration.current;
    pendingLatch.current = true;
    setPending(true);
    knowledge.onPendingChange(operationWorkspaceId, true);
    setMessage(options.progress ?? null);
    setError(null);
    return work(() => operationGeneration.current === generation)
      .then((text) => {
        if (text === null || operationGeneration.current !== generation) return false;
        setMessage(text);
        return true;
      })
      .catch((reason: unknown) => {
        if (operationGeneration.current !== generation) return false;
        setMessage(null);
        if (!isKnowledgeOperationCancelled(reason)) setError(failureText(reason));
        return false;
      })
      .finally(() => {
        pendingLatch.current = false;
        setPending(false);
        knowledge.onPendingChange(operationWorkspaceId, false);
      });
  };

  /** Adds one source to the base in use, creating the base on a first add. Null when stale. */
  const addOne = async (
    binding: CareerEvidenceBinding,
    source: CareerEvidenceSource,
    isCurrent: () => boolean,
  ): Promise<string | null> => {
    if (status.kind === "none") {
      const outcome = await addFirstCareerEvidence({
        capabilities: binding.capabilities,
        workspaceId: binding.workspaceId,
        source,
        safeName: safeKnowledgeBaseDisplayName,
        isCurrent,
        onChanged: binding.onChanged,
      });
      return outcome.status === "added" ? outcome.message : null;
    }
    if (status.kind !== "selected") return null;
    const { storeId, knowledgeBaseId, displayName } = status;
    const outcome = await addCareerEvidence({
      capabilities: binding.capabilities,
      workspaceId: binding.workspaceId,
      target: { storeId, knowledgeBaseId },
      displayName,
      source,
      isCurrent,
      onChanged: binding.onChanged,
    });
    return outcome.status === "added" ? outcome.message : null;
  };

  const addToKnowledgeBase = (source: CareerEvidenceSource) => {
    if (knowledge === undefined) return;
    if (status.kind !== "none" && status.kind !== "selected") return;
    void runOperation((isCurrent) => addOne(knowledge, source, isCurrent)).then((added) => {
      if (added && source.kind === "url") setUrl("");
    });
  };

  /**
   * Fetches several URLs one after another. A URL that fails does not stop the others; the
   * failed ones stay in the box so the person can fix or retry them.
   */
  const addUrlsToKnowledgeBase = (urls: readonly string[]) => {
    if (knowledge === undefined) return;
    if (status.kind !== "none" && status.kind !== "selected") return;
    void runOperation(
      async (isCurrent) => {
        const failed: string[] = [];
        const reasons: string[] = [];
        let added = 0;
        let last: string | null = null;
        for (const [index, value] of urls.entries()) {
          if (!isCurrent()) return null;
          setMessage(`Fetching URL ${index + 1} of ${urls.length}…`);
          try {
            const text = await addOne(knowledge, { kind: "url", url: value }, isCurrent);
            if (text === null) return null;
            added += 1;
            last = text;
          } catch (reason: unknown) {
            if (isKnowledgeOperationCancelled(reason)) throw reason;
            failed.push(value);
            reasons.push(`${value}: ${failureText(reason)}`);
          }
        }
        if (!isCurrent()) return null;
        setUrl(failed.join("\n"));
        if (failed.length > 0) setError(`Not added: ${reasons.join(" ")}`);
        if (added === 0) {
          setMessage(null);
          return null;
        }
        return `Added ${added} of ${urls.length} URLs. ${last ?? ""}`.trim();
      },
      { progress: `Fetching URL 1 of ${urls.length}…` },
    );
  };

  const mode: NoSelectionMode | null = status.kind === "none" ? noSelectionMode(automatic) : null;
  const inKnowledgeBase =
    status.kind === "selected" || status.kind === "loading" || mode === "first-add";

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
      automatic={automatic}
      canAddFile={inKnowledgeBase || onSelectLegacyFiles !== undefined}
      canAddUrl={inKnowledgeBase || onAddLegacyUrl !== undefined}
      onChooseKnowledgeBase={() => {
        knowledge?.onRequestStoreForm?.();
        focusKnowledgeStore();
      }}
      {...(inKnowledgeBase && capabilities?.importCandidateKnowledgeDirectory !== undefined
        ? { onAddFolder: () => addToKnowledgeBase({ kind: "directory" }) }
        : {})}
      knowledgeBase={knowledgeBase}
      onAddFile={() => {
        if (inKnowledgeBase) addToKnowledgeBase({ kind: "file" });
        else onSelectLegacyFiles?.();
      }}
      onAddUrl={() => {
        const urls = parseSourceUrls(url);
        const [first] = urls;
        if (first === undefined) return;
        if (inKnowledgeBase) {
          if (urls.length === 1) addToKnowledgeBase({ kind: "url", url: first });
          else addUrlsToKnowledgeBase(urls);
        } else if (onAddLegacyUrl !== undefined && urls.length === 1) {
          onAddLegacyUrl(first);
          setUrl("");
        }
      }}
    />
  );
}
