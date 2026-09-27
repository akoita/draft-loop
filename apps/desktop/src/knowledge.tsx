import { useEffect, useRef, useState } from "react";

import type { KnowledgeBaseSummary, KnowledgeStoreResult } from "./bridge.js";
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

  const perform = async (operation: (generation: number) => Promise<void>) => {
    if (pendingLatch.current || disabled || !supported) return;
    pendingLatch.current = true;
    setPending(true);
    onPendingChange(workspaceId, true);
    setMessage(null);
    const generation = operationGeneration.current;
    try {
      await operation(generation);
    } catch {
      if (operationGeneration.current === generation) {
        setMessage("The knowledge-store operation could not be completed.");
      }
    } finally {
      pendingLatch.current = false;
      setPending(false);
      onPendingChange(workspaceId, false);
    }
  };

  const readStore = async (result: KnowledgeStoreResult, generation: number) => {
    if (result.storeId.trim() === "") throw new Error("Invalid store result");
    if (operationGeneration.current === generation) setStore(result);
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
      if (refreshed && operationGeneration.current === generation) {
        setMessage("Candidate knowledge selected for this workspace.");
      }
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

  return (
    <section className="panel" aria-labelledby="candidate-knowledge-heading">
      <h2 id="candidate-knowledge-heading">Candidate knowledge</h2>
      <p>
        Reusable candidate knowledge is separate from application material. Selecting one base
        replaces the workspace’s current knowledge selection.
      </p>
      <div className="form-row">
        <label htmlFor="candidate-knowledge-name">New store folder name</label>
        <input
          id="candidate-knowledge-name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          disabled={controlsDisabled}
        />
      </div>
      <div className="button-row">
        <button type="button" disabled={controlsDisabled} onClick={createStore}>
          Create knowledge store
        </button>
        <button type="button" disabled={controlsDisabled} onClick={openStore}>
          Open knowledge store
        </button>
      </div>
      {pending ? <p role="status">Updating candidate knowledge…</p> : null}
      {message === null ? null : <p role="status">{message}</p>}
      {store === null ? null : (
        <ul aria-label="Available candidate knowledge bases">
          {knowledgeBases.map((knowledgeBase) => (
            <li key={knowledgeBase.id}>
              <span>{safeKnowledgeBaseDisplayName(knowledgeBase.displayName)}</span>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => selectKnowledgeBase(store.storeId, knowledgeBase.id)}
              >
                Use this knowledge base
              </button>
            </li>
          ))}
          {knowledgeBases.length === 0 ? <li>No active knowledge bases are available.</li> : null}
        </ul>
      )}
    </section>
  );
}
