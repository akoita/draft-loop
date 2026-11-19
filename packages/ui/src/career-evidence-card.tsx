import { plural, t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AdvancedOptions } from "./advanced-options.js";
import { CareerStartChoice, useCareerConversationOffered } from "./career-conversation-start.js";
import {
  addCareerEvidence,
  type CareerEvidenceCapabilities,
  type CareerEvidenceSource,
  type CareerEvidenceStatus,
  careerEvidenceReadinessText,
  careerEvidenceReady,
  careerEvidenceSourcesText,
  defaultCareerEvidenceName,
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
import { countedNouns } from "./counted-nouns.js";
import { useShowEverything } from "./display-preference.js";
import { useHostEvidenceAdvanced } from "./host-panels.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import { isKnowledgeOperationCancelled } from "./knowledge-cancel.js";
import type { WorkspaceReadiness } from "./model.js";
import { pastedSourceTitle } from "./pasted-evidence.js";
import { PastedEvidenceForm } from "./pasted-evidence-form.js";
import {
  SourceEvidenceKindList,
  type SourceEvidenceKindListProps,
  useSourceEvidenceKinds,
} from "./source-evidence-kinds.js";

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
      return t`${plural(chunks, { one: "# relevant excerpt", other: "# relevant excerpts" })} selected from ${countedNouns.source(sources)}`;
    case "fallback":
      return plural(chunks, {
        one: "No lexical match; # bounded fallback excerpt selected",
        other: "No lexical match; # bounded fallback excerpts selected",
      });
    case "no-query":
      return t`The job description has no searchable role terms`;
    case "unavailable":
      return t`Retrieval readiness is unavailable`;
    case "not-indexed":
      return t`Evidence will be indexed when the review starts`;
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
  readonly onAddUrl: () => void;
  readonly onChooseKnowledgeBase: () => void;
  /** False when the host offers no way to add files or a URL in the current mode. */
  readonly canAddFile: boolean;
  readonly canAddUrl: boolean;
  /** False when the host fetches no URL at all, such as the hosted service: the URL box is hidden. */
  readonly urlsOffered?: boolean;
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
  /** Each source's evidence kind, when the host reports them for the selected base. */
  readonly evidenceKinds?: Omit<SourceEvidenceKindListProps, "disabled">;
  /** Opens Career profile, the next step once a document is ready; absent without a profile. */
  readonly onOpenProfile?: () => void;
  /** Saves pasted text as a source; absent when the host takes no text or no base is in use. */
  readonly onAddText?: (pasted: {
    readonly title: string;
    readonly text: string;
  }) => Promise<boolean>;
  /** True when the host shows the career interview, so an empty card offers a conversation too. */
  readonly conversationOffered?: boolean;
  /**
   * Whether Advanced options is unfolded. Without it the section follows the card: open only
   * when the next step is inside it, such as a base that could not be opened.
   */
  readonly advancedOpen?: boolean | null;
  readonly onAdvancedToggle?: (open: boolean) => void;
  /** More advanced choices from the page or the host, shown after the card's own. */
  readonly advancedExtra?: ReactNode;
  /** What is not at its default among them, for the folded line. */
  readonly advancedExtraNote?: string | null;
}

/** The card's next step once a document is ready. */
export function CareerEvidenceNextStep({ onOpenProfile }: { readonly onOpenProfile: () => void }) {
  return (
    <aside className="career-next-step" aria-labelledby="career-next-step-heading">
      <strong id="career-next-step-heading">{t`Next: build your career profile`}</strong>
      <p>{t`Your documents are saved. DraftLoop reads them and lists the facts it finds for you to check. You can add more documents at any time.`}</p>
      <button className="button button-primary" type="button" onClick={onOpenProfile}>
        {t`Continue to Career profile`} <span aria-hidden="true">→</span>
      </button>
    </aside>
  );
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
  urlsOffered = true,
  automatic = false,
  knowledgeBase = null,
  evidenceKinds,
  onOpenProfile,
  onAddText,
  conversationOffered = false,
  advancedOpen = null,
  onAdvancedToggle,
  advancedExtra = null,
  advancedExtraNote = null,
}: CareerEvidenceCardViewProps) {
  const legacyCount = setup.evidenceSourceCount;
  const mode: NoSelectionMode | null = status.kind === "none" ? noSelectionMode(automatic) : null;
  // Runs read the workspace evidence files while no base is selected, so they count as ready.
  const ready = careerEvidenceReady(status, legacyCount);
  const intoKnowledgeBase = status.kind === "selected" || status.kind === "loading";
  const inKnowledgeBase = intoKnowledgeBase || mode === "first-add";
  const showAdd = status.kind !== "unavailable";
  const blocked = disabled || pending;
  const addDisabled = blocked || status.kind === "loading";
  const fileLabel =
    mode === "legacy"
      ? t`Add to legacy workspace evidence`
      : status.kind === "unsupported"
        ? t`Add source files`
        : t`Add documents`;
  // An empty record with an interview on the page: the two ways to start carry Add documents.
  const startChoice = conversationOffered && mode === "first-add" && legacyCount === 0;
  const urlCount = parseSourceUrls(url).length;
  // Legacy workspace evidence imports one URL per request; only a knowledge base takes several.
  const tooManyForLegacy = !inKnowledgeBase && urlCount > 1;
  const urlLabel = tooManyForLegacy
    ? t`Legacy evidence takes one URL at a time`
    : mode === "legacy"
      ? t`Add URL to legacy evidence`
      : urlCount > 1
        ? t`Review and fetch ${urlCount} source URLs`
        : t`Review and fetch source URL`;
  // Nothing added yet and the host makes the base itself: the card is the person's first step.
  const firstDocument = mode === "first-add" && legacyCount === 0;
  const showKinds = status.kind === "selected" && evidenceKinds !== undefined;
  const hasKnowledgeBase =
    knowledgeBase !== null && knowledgeBase !== undefined && status.kind !== "unsupported";
  const hasExtra = advancedExtra !== null && advancedExtra !== undefined;
  const showAdvanced = showKinds || hasKnowledgeBase || hasExtra;
  // The next step is inside the section when the base cannot be opened or none can be made here.
  const advancedNeeded = status.kind === "unavailable" || mode === "legacy";
  // Show everything (#2789) opens the section too, until the person folds it.
  const everything = useShowEverything();
  // A base the person named themselves is a choice away from the default, so the fold says so.
  const baseNote =
    status.kind === "selected" && status.displayName !== defaultCareerEvidenceName
      ? t`Knowledge base: ${status.displayName}`
      : null;
  const notes = [baseNote, advancedExtraNote].filter((note) => note !== null);
  const advancedNote = notes.length === 0 ? null : notes.join(" · ");
  return (
    <article className={`setup-card${ready ? " setup-card-ready" : ""}`}>
      <div className="setup-card-head">
        <span className={`setup-state${ready ? " setup-state-ready" : ""}`}>
          {ready ? t`Ready` : firstDocument ? t`Start here` : t`Required`}
        </span>
      </div>
      <strong>{firstDocument ? t`Add your career documents` : t`Your documents`}</strong>
      {status.kind === "loading" ? (
        <span role="status">{t`Checking your documents…`}</span>
      ) : status.kind === "selected" ? (
        <>
          <span>{careerEvidenceSourcesText(status)}</span>
          <span className="setup-retrieval-status setup-card-line" role="status">
            {careerEvidenceReadinessText(status)}
          </span>
        </>
      ) : status.kind === "unavailable" ? (
        <span role="status">{t`Your documents could not be opened. Open their store under Advanced options below.`}</span>
      ) : status.kind === "none" && mode === "first-add" && legacyCount > 0 ? (
        <>
          <span>{t`Workspace evidence files: ${countedNouns.file(legacyCount)}`}</span>
          <span className="setup-retrieval-status setup-card-line" role="status">
            {t`Runs use these files while no knowledge base is selected. Adding a source creates a knowledge base for this workspace in`}{" "}
            {defaultKnowledgeStoreDestinationLabel()}
            {t`; runs then use it instead, and these files are not copied into it.`}
          </span>
          <button
            className="button button-quiet"
            type="button"
            disabled={blocked}
            onClick={onChooseKnowledgeBase}
          >{t`Create or choose a knowledge base`}</button>
        </>
      ) : status.kind === "none" && mode === "first-add" ? (
        <>
          {startChoice ? (
            <>
              <span role="status">{t`No career evidence yet`}</span>
              <CareerStartChoice
                onAddDocuments={onAddFile}
                addDisabled={addDisabled || !canAddFile}
                disabled={blocked}
              />
            </>
          ) : (
            <span role="status">{t`No career evidence yet. Your CV is enough to start, and you can add more at any time.`}</span>
          )}
        </>
      ) : status.kind === "none" ? (
        <>
          <span role="status">
            {t`No knowledge base selected — runs will use legacy workspace evidence`}
            {legacyCount > 0 ? ` (${countedNouns.source(legacyCount)})` : ""}.
          </span>
          <button
            className="button button-primary"
            type="button"
            disabled={blocked}
            onClick={onChooseKnowledgeBase}
          >{t`Create or choose a knowledge base`}</button>
        </>
      ) : (
        <>
          <span>
            {legacyCount === 0
              ? t`Add a CV, portfolio, or other source`
              : plural(legacyCount, { one: "# source ready", other: "# sources ready" })}
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
          {startChoice ? null : (
            <button
              className="button button-quiet"
              type="button"
              disabled={addDisabled || !canAddFile}
              onClick={onAddFile}
            >
              {fileLabel}
            </button>
          )}
          {inKnowledgeBase && onAddText !== undefined ? (
            <PastedEvidenceForm onSave={onAddText} disabled={addDisabled} />
          ) : null}
          {urlsOffered ? (
            <>
              <label className="url-input-label">
                <span>{t`Or provide public URLs, one per line`}</span>
                <textarea
                  className="url-input"
                  rows={3}
                  placeholder={t`https://github.com/…
https://www.linkedin.com/in/…`}
                  value={url}
                  onChange={(event) => onUrlChange(event.target.value)}
                  aria-label={
                    inKnowledgeBase ? t`Career evidence URLs` : t`Legacy workspace evidence URLs`
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
        </>
      ) : null}
      {ready && !pending && onOpenProfile !== undefined ? (
        <CareerEvidenceNextStep onOpenProfile={onOpenProfile} />
      ) : null}
      {showAdvanced ? (
        <AdvancedOptions
          open={advancedOpen ?? (advancedNeeded || everything)}
          note={advancedNote}
          {...(onAdvancedToggle === undefined ? {} : { onToggle: onAdvancedToggle })}
        >
          {showKinds ? <SourceEvidenceKindList {...evidenceKinds} disabled={blocked} /> : null}
          {knowledgeBase}
          {advancedExtra}
        </AdvancedOptions>
      ) : null}
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
  /** Opens Career profile, the next step once a document is ready. */
  readonly onOpenProfile?: (() => void) | undefined;
  /** The page's own advanced panel, such as how the documents are searched. */
  readonly advanced?: ReactNode;
}

function failureText(reason: unknown): string {
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : t`The source could not be added to the knowledge base.`;
}

/** Setup card 02: the knowledge base the run will use, with add actions that import into it. */
export function CareerEvidenceCard({
  setup,
  knowledge,
  onSelectLegacyFiles,
  onAddLegacyUrl,
  knowledgeBase,
  onOpenProfile,
  advanced = null,
}: CareerEvidenceCardProps) {
  const hostAdvanced = useHostEvidenceAdvanced();
  const [hostNote, setHostNote] = useState<string | null>(null);
  const capabilities = knowledge?.capabilities;
  const supported = capabilities !== undefined && supportsCareerEvidence(capabilities);
  const conversationOffered = useCareerConversationOffered();
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
  const [advancedOpen, setAdvancedOpen] = useState<boolean | null>(null);
  // A new Display choice replaces the person's last fold, so the switch shows at once.
  const everything = useShowEverything();
  const shownMode = useRef(everything);
  useEffect(() => {
    if (shownMode.current === everything) return;
    shownMode.current = everything;
    setAdvancedOpen(null);
  }, [everything]);
  const [chooseRequest, setChooseRequest] = useState(0);
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

  // The Knowledge base section sits in Advanced options, so it is unfolded before it takes focus.
  useEffect(() => {
    if (chooseRequest > 0) focusKnowledgeStore();
  }, [chooseRequest]);

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

  const addToKnowledgeBase = (source: CareerEvidenceSource): Promise<boolean> => {
    if (knowledge === undefined) return Promise.resolve(false);
    if (status.kind !== "none" && status.kind !== "selected") return Promise.resolve(false);
    return runOperation((isCurrent) => addOne(knowledge, source, isCurrent)).then((added) => {
      if (added && source.kind === "url") setUrl("");
      return added;
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
  const evidenceKinds = useSourceEvidenceKinds(
    capabilities,
    status.kind === "selected"
      ? { storeId: status.storeId, knowledgeBaseId: status.knowledgeBaseId }
      : null,
    revision,
  );

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
      conversationOffered={conversationOffered}
      canAddFile={inKnowledgeBase || onSelectLegacyFiles !== undefined}
      canAddUrl={inKnowledgeBase || onAddLegacyUrl !== undefined}
      advancedOpen={advancedOpen}
      onAdvancedToggle={setAdvancedOpen}
      advancedExtra={
        advanced === null && hostAdvanced === undefined ? null : (
          <>
            {advanced}
            {hostAdvanced?.({ revision: revision ?? 0, setNote: setHostNote })}
          </>
        )
      }
      advancedExtraNote={hostNote}
      onChooseKnowledgeBase={() => {
        setAdvancedOpen(true);
        knowledge?.onRequestStoreForm?.();
        setChooseRequest((current) => current + 1);
      }}
      {...(inKnowledgeBase && capabilities?.importCandidateKnowledgeUrl === undefined
        ? { urlsOffered: false }
        : {})}
      {...(inKnowledgeBase && capabilities?.importCandidateKnowledgeText !== undefined
        ? {
            onAddText: ({ title, text }: { readonly title: string; readonly text: string }) =>
              addToKnowledgeBase({
                kind: "text",
                title: pastedSourceTitle(title, new Date()),
                text,
              }),
          }
        : {})}
      knowledgeBase={knowledgeBase}
      {...(onOpenProfile === undefined ? {} : { onOpenProfile })}
      {...(evidenceKinds.state === null
        ? {}
        : { evidenceKinds: { state: evidenceKinds.state, onChange: evidenceKinds.change } })}
      onAddFile={() => {
        if (inKnowledgeBase) void addToKnowledgeBase({ kind: "file" });
        else onSelectLegacyFiles?.();
      }}
      onAddUrl={() => {
        const urls = parseSourceUrls(url);
        const [first] = urls;
        if (first === undefined) return;
        if (inKnowledgeBase) {
          if (urls.length === 1) void addToKnowledgeBase({ kind: "url", url: first });
          else addUrlsToKnowledgeBase(urls);
        } else if (onAddLegacyUrl !== undefined && urls.length === 1) {
          onAddLegacyUrl(first);
          setUrl("");
        }
      }}
    />
  );
}
