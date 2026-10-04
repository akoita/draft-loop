import { useEffect, useRef, useState } from "react";

import type { KnowledgeBaseSummary, KnowledgeStoreResult } from "./bridge.js";
import { isKnowledgeOperationCancelled } from "./knowledge-cancel.js";
import {
  hasDesktopKnowledgeIntakeCapabilities,
  hasWorkspaceSourcesIntakeCapabilities,
  knowledgeIntakeSummary,
  knowledgeReadinessSummary,
  runKnowledgeIntake,
} from "./knowledge-intake.js";
import type { DesktopKnowledgeCapabilities } from "./native.js";

export interface KnowledgeWorkspaceProps {
  readonly workspaceId: string;
  readonly capabilities: DesktopKnowledgeCapabilities;
  readonly disabled: boolean;
  readonly onPendingChange: (workspaceId: string, pending: boolean) => void;
  readonly onSelectionSaved: (workspaceId: string) => Promise<boolean>;
}

export function hasDesktopKnowledgeCapabilities(
  capabilities: DesktopKnowledgeCapabilities,
): capabilities is Required<DesktopKnowledgeCapabilities> {
  return (
    capabilities.createCandidateKnowledgeStore !== undefined &&
    capabilities.openCandidateKnowledgeStore !== undefined &&
    capabilities.selectCandidateKnowledgeBase !== undefined
  );
}

export function activeKnowledgeBases(
  result: KnowledgeStoreResult,
): readonly KnowledgeBaseSummary[] {
  return result.knowledgeBases.filter((knowledgeBase) => knowledgeBase.state === "active");
}

export function safeKnowledgeBaseDisplayName(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed === "" ||
    /[\\/]/u.test(trimmed) ||
    /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ||
    /^[a-z]:/iu.test(trimmed)
  ) {
    return "Candidate knowledge base";
  }
  return trimmed;
}

export async function selectCandidateKnowledgeBaseAndRefresh(input: {
  readonly workspaceId: string;
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly isCurrent: () => boolean;
  readonly select: (
    workspaceId: string,
    entry: { readonly storeId: string; readonly knowledgeBaseId: string },
  ) => Promise<{
    readonly workspaceId: string;
    readonly entries: readonly { readonly storeId: string; readonly knowledgeBaseId: string }[];
  }>;
  readonly refresh: (workspaceId: string) => Promise<boolean>;
}): Promise<boolean> {
  const result = await input.select(input.workspaceId, {
    storeId: input.storeId,
    knowledgeBaseId: input.knowledgeBaseId,
  });
  if (
    result.workspaceId !== input.workspaceId ||
    result.entries.length !== 1 ||
    result.entries[0]?.storeId !== input.storeId ||
    result.entries[0]?.knowledgeBaseId !== input.knowledgeBaseId
  ) {
    throw new Error("Selection result did not match the requested workspace");
  }
  if (!input.isCurrent()) return false;
  return input.refresh(input.workspaceId);
}

export interface KnowledgeBaseListProps {
  readonly storeId: string;
  readonly knowledgeBases: readonly KnowledgeBaseSummary[];
  readonly disabled: boolean;
  readonly intakeSupported: boolean;
  readonly workspaceSourcesSupported: boolean;
  /** Bases of this store the workspace already uses; marked "In use". */
  readonly selectedKnowledgeBaseIds?: readonly string[];
  readonly onSelect: (storeId: string, knowledgeBaseId: string) => void;
  readonly onImport: (
    storeId: string,
    knowledgeBaseId: string,
    kind: "file" | "directory" | "workspace",
  ) => void;
}

export function KnowledgeBaseList({
  storeId,
  knowledgeBases,
  disabled,
  intakeSupported,
  workspaceSourcesSupported,
  selectedKnowledgeBaseIds = [],
  onSelect,
  onImport,
}: KnowledgeBaseListProps) {
  return (
    <ul className="knowledge-base-list" aria-label="Available candidate knowledge bases">
      {knowledgeBases.map((knowledgeBase) => {
        const inUse = selectedKnowledgeBaseIds.includes(knowledgeBase.id);
        return (
          <li className="knowledge-base-card" key={knowledgeBase.id}>
            <div className="knowledge-base-header">
              <strong>{safeKnowledgeBaseDisplayName(knowledgeBase.displayName)}</strong>
              {knowledgeBase.isDefault ? <span className="meta-chip">Default</span> : null}
              {inUse ? <span className="meta-chip">In use</span> : null}
            </div>
            <div className="knowledge-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={disabled || inUse}
                onClick={() => onSelect(storeId, knowledgeBase.id)}
              >
                {inUse ? "In use" : "Use this knowledge base"}
              </button>
              {intakeSupported ? (
                <>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={disabled}
                    onClick={() => onImport(storeId, knowledgeBase.id, "file")}
                  >
                    Add file
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={disabled}
                    onClick={() => onImport(storeId, knowledgeBase.id, "directory")}
                  >
                    Add directory
                  </button>
                </>
              ) : null}
            </div>
            {intakeSupported ? null : (
              <p className="knowledge-hint">
                File and directory intake is unavailable in this desktop host.
              </p>
            )}
            {workspaceSourcesSupported ? (
              <div className="knowledge-workspace-import">
                <div className="knowledge-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={disabled}
                    onClick={() => onImport(storeId, knowledgeBase.id, "workspace")}
                  >
                    Import workspace candidate sources
                  </button>
                </div>
                <p className="knowledge-hint">
                  This imports all supported files from this workspace’s configured candidate-source
                  directory. It does not select the base automatically. Directory limits can produce
                  a partial result, and previously imported directories are rejected.
                </p>
              </div>
            ) : (
              <p className="knowledge-hint">
                Workspace candidate-source import is unavailable in this desktop host.
              </p>
            )}
          </li>
        );
      })}
      {knowledgeBases.length === 0 ? (
        <li className="knowledge-hint">No active knowledge bases are available.</li>
      ) : null}
    </ul>
  );
}

export const savedKnowledgeUnavailableMessage =
  "The saved knowledge store could not be opened from its saved location. Open it again to continue.";

export function SavedKnowledgeStatus({
  loading,
  unavailable,
}: {
  readonly loading: boolean;
  readonly unavailable: boolean;
}) {
  if (loading) {
    return (
      <p className="knowledge-status" role="status">
        Loading saved knowledge…
      </p>
    );
  }
  if (unavailable) {
    return (
      <p className="knowledge-status" role="status">
        {savedKnowledgeUnavailableMessage}
      </p>
    );
  }
  return null;
}

export function KnowledgeWorkspace({
  workspaceId,
  capabilities,
  disabled,
  onPendingChange,
  onSelectionSaved,
}: KnowledgeWorkspaceProps) {
  const supported = hasDesktopKnowledgeCapabilities(capabilities);
  const [store, setStore] = useState<KnowledgeStoreResult | null>(null);
  const [name, setName] = useState("candidate-knowledge");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    readonly storeId: string;
    readonly ids: readonly string[];
  } | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedUnavailable, setSavedUnavailable] = useState(false);
  const loadCurrent = capabilities.getCurrentCandidateKnowledge;
  const loadCurrentRef = useRef(loadCurrent);
  loadCurrentRef.current = loadCurrent;
  const hasLoadCurrent = loadCurrent !== undefined;
  // Set once the user opens, creates or selects, so a late saved-store response
  // cannot overwrite what they just did.
  const userTouched = useRef(false);
  const pendingLatch = useRef(false);
  const operationGeneration = useRef(0);

  useEffect(() => {
    const generation = ++operationGeneration.current;
    const operationWorkspaceId = workspaceId;
    return () => {
      if (operationGeneration.current === generation && operationWorkspaceId === workspaceId) {
        operationGeneration.current += 1;
      }
    };
  }, [workspaceId]);

  useEffect(() => {
    userTouched.current = false;
    const load = loadCurrentRef.current;
    if (!hasLoadCurrent || load === undefined) return;
    const generation = operationGeneration.current;
    const isCurrent = () => operationGeneration.current === generation && !userTouched.current;
    setStore(null);
    setSelection(null);
    setSavedUnavailable(false);
    setLoadingSaved(true);
    void load(workspaceId).then(
      (result) => {
        if (operationGeneration.current !== generation) return;
        setLoadingSaved(false);
        if (!isCurrent()) return;
        if (result.store === null) {
          setSavedUnavailable(result.unavailable === true);
          return;
        }
        setStore(result.store);
        setSelection({ storeId: result.store.storeId, ids: result.selectedKnowledgeBaseIds });
      },
      () => {
        if (operationGeneration.current !== generation) return;
        setLoadingSaved(false);
        if (isCurrent()) setSavedUnavailable(true);
      },
    );
  }, [workspaceId, hasLoadCurrent]);

  const perform = async (operation: (generation: number) => Promise<void>) => {
    if (pendingLatch.current || disabled || !supported) return;
    pendingLatch.current = true;
    setPending(true);
    onPendingChange(workspaceId, true);
    setMessage(null);
    const generation = operationGeneration.current;
    try {
      await operation(generation);
    } catch (reason: unknown) {
      if (operationGeneration.current === generation && !isKnowledgeOperationCancelled(reason)) {
        setMessage("The candidate knowledge operation could not be completed.");
      }
    } finally {
      pendingLatch.current = false;
      setPending(false);
      onPendingChange(workspaceId, false);
    }
  };

  const readStore = async (result: KnowledgeStoreResult, generation: number) => {
    if (result.storeId.trim() === "") throw new Error("Invalid store result");
    if (operationGeneration.current === generation) {
      userTouched.current = true;
      setStore(result);
      setSavedUnavailable(false);
    }
  };

  const createStore = () => {
    if (!supported) return;
    const trimmedName = name.trim();
    if (trimmedName === "" || /[\\/]/u.test(trimmedName)) {
      setMessage("Enter a folder name without path separators.");
      return;
    }
    void perform(async (generation) => {
      const result = await capabilities.createCandidateKnowledgeStore({ name: trimmedName });
      await readStore(result, generation);
    });
  };

  const openStore = () => {
    if (!supported) return;
    void perform(async (generation) => {
      await readStore(await capabilities.openCandidateKnowledgeStore(), generation);
    });
  };

  const selectKnowledgeBase = (storeId: string, knowledgeBaseId: string) => {
    if (!supported) return;
    const expectedWorkspaceId = workspaceId;
    void perform(async (generation) => {
      const refreshed = await selectCandidateKnowledgeBaseAndRefresh({
        workspaceId: expectedWorkspaceId,
        storeId,
        knowledgeBaseId,
        select: capabilities.selectCandidateKnowledgeBase,
        isCurrent: () => operationGeneration.current === generation,
        refresh: onSelectionSaved,
      });
      if (operationGeneration.current === generation) {
        userTouched.current = true;
        setSelection({ storeId, ids: [knowledgeBaseId] });
      }
      if (refreshed && operationGeneration.current === generation) {
        setMessage("Candidate knowledge selected for this workspace.");
      }
    });
  };

  const importIntoKnowledgeBase = (
    storeId: string,
    knowledgeBaseId: string,
    kind: "file" | "directory" | "workspace",
  ) => {
    const importFile = capabilities.importCandidateKnowledgeFile;
    const importDirectory = capabilities.importCandidateKnowledgeDirectory;
    const importWorkspaceSources = capabilities.importWorkspaceCandidateSources;
    const readReadiness = capabilities.getCandidateKnowledgeReadiness;
    if (
      readReadiness === undefined ||
      (kind === "file" && importFile === undefined) ||
      (kind === "directory" && importDirectory === undefined) ||
      (kind === "workspace" && importWorkspaceSources === undefined)
    ) {
      return;
    }
    void perform(async (generation) => {
      const outcome = await runKnowledgeIntake({
        workspaceId,
        target: { storeId, knowledgeBaseId },
        isCurrent: () => operationGeneration.current === generation,
        importSource: () => {
          if (kind === "file" && importFile !== undefined) {
            return importFile(storeId, knowledgeBaseId);
          }
          if (kind === "directory" && importDirectory !== undefined) {
            return importDirectory(storeId, knowledgeBaseId);
          }
          if (kind === "workspace" && importWorkspaceSources !== undefined) {
            return importWorkspaceSources({
              workspaceId,
              storeId,
              knowledgeBaseId,
              approved: true,
            });
          }
          throw new Error("Candidate knowledge intake is unavailable");
        },
        readReadiness: () => readReadiness(storeId, knowledgeBaseId),
        refreshWorkspace: onSelectionSaved,
      });
      if (outcome.status === "stale" || operationGeneration.current !== generation) return;
      if (outcome.status === "readiness-unavailable") {
        setMessage(
          `${knowledgeIntakeSummary(outcome.result)} Readiness could not be checked; some sources may not be ready.`,
        );
        return;
      }
      if (outcome.status === "refresh-unavailable") {
        setMessage(
          `${knowledgeIntakeSummary(outcome.result)} ${
            outcome.readiness === null ? "Readiness could not be checked. " : ""
          }Workspace review could not be refreshed. Reopen the workspace before continuing.${
            outcome.readiness === null ? "" : ` ${knowledgeReadinessSummary(outcome.readiness)}`
          }`,
        );
        return;
      }
      setMessage(
        `${knowledgeIntakeSummary(outcome.result)} ${knowledgeReadinessSummary(outcome.readiness)}`,
      );
    });
  };

  if (!supported) {
    return (
      <section className="panel" aria-labelledby="candidate-knowledge-heading">
        <h2 id="candidate-knowledge-heading">Candidate knowledge</h2>
        <p>Knowledge-store selection is unavailable in this desktop host.</p>
      </section>
    );
  }

  const knowledgeBases = store === null ? [] : activeKnowledgeBases(store);
  const controlsDisabled = disabled || pending;
  const intakeSupported = hasDesktopKnowledgeIntakeCapabilities(capabilities);
  const workspaceSourcesSupported = hasWorkspaceSourcesIntakeCapabilities(capabilities);

  return (
    <section className="panel knowledge-panel" aria-labelledby="candidate-knowledge-heading">
      <div>
        <p className="eyebrow">Candidate knowledge</p>
        <h2 id="candidate-knowledge-heading">Knowledge store</h2>
      </div>
      <p className="knowledge-copy">
        Reusable career evidence, kept separate from application material. Choosing a base replaces
        this workspace’s current knowledge selection.
      </p>
      <div className="knowledge-store-row">
        <label className="setup-field" htmlFor="candidate-knowledge-name">
          <span>New store folder name</span>
          <input
            id="candidate-knowledge-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={controlsDisabled}
          />
        </label>
        <div className="knowledge-store-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={controlsDisabled}
            onClick={createStore}
          >
            Create knowledge store
          </button>
          <button
            type="button"
            className="button button-outline"
            disabled={controlsDisabled}
            onClick={openStore}
          >
            Open knowledge store
          </button>
        </div>
      </div>
      {pending ? (
        <p className="knowledge-status" role="status">
          Updating candidate knowledge…
        </p>
      ) : null}
      <SavedKnowledgeStatus loading={loadingSaved} unavailable={savedUnavailable} />
      {message === null ? null : (
        <p className="knowledge-status" role="status">
          {message}
        </p>
      )}
      {store === null ? null : (
        <KnowledgeBaseList
          storeId={store.storeId}
          knowledgeBases={knowledgeBases}
          disabled={controlsDisabled}
          intakeSupported={intakeSupported}
          workspaceSourcesSupported={workspaceSourcesSupported}
          selectedKnowledgeBaseIds={
            selection !== null && selection.storeId === store.storeId ? selection.ids : []
          }
          onSelect={selectKnowledgeBase}
          onImport={importIntoKnowledgeBase}
        />
      )}
    </section>
  );
}
