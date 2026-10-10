import { useEffect, useRef, useState } from "react";

import type { DesktopKnowledgeCapabilities } from "./native.js";
import {
  type CandidateEvidenceKind,
  candidateEvidenceKinds,
  evidenceKindLabel,
  evidenceKindOriginLabel,
  type SourceEvidenceKindSummary,
} from "./source-evidence-kind-contract.js";

/** What the Manage career evidence panel knows about the kinds of the base's sources. */
export type SourceEvidenceKindsState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly sources: readonly SourceEvidenceKindSummary[];
      readonly truncated: boolean;
      /** The source whose kind is being saved; its control is disabled meanwhile. */
      readonly savingSourceId: string | null;
      readonly error: string | null;
    };

export type SourceEvidenceKindCapabilities = Pick<
  DesktopKnowledgeCapabilities,
  "listSourceEvidenceKinds" | "setSourceEvidenceKind"
>;

/** Sources listed open; a longer list starts folded so the add actions stay in view. */
const openListMaximum = 5;

export interface SourceEvidenceKindListProps {
  readonly state: SourceEvidenceKindsState;
  readonly disabled: boolean;
  readonly onChange: (sourceId: string, kind: CandidateEvidenceKind | null) => void;
}

/** Each source with its evidence kind, where it came from, and a select to correct it. */
export function SourceEvidenceKindList({ state, disabled, onChange }: SourceEvidenceKindListProps) {
  if (state.status === "loading") {
    return <span className="setup-card-line">Reading what each source is…</span>;
  }
  if (state.status === "unavailable") {
    return <span className="setup-card-line">What each source is could not be read.</span>;
  }
  if (state.sources.length === 0) return null;
  return (
    <details
      className="setup-details evidence-kinds"
      open={state.sources.length <= openListMaximum}
    >
      <summary>What each source is ({state.sources.length})</summary>
      <ul className="evidence-kind-list">
        {state.sources.map((source) => {
          const saving = state.savingSourceId === source.sourceId;
          const locked = disabled || state.savingSourceId !== null;
          return (
            <li className="evidence-kind-row" key={source.sourceId}>
              <span className="evidence-kind-name" title={source.displayName}>
                {source.displayName}
              </span>
              <select
                aria-label={`Evidence kind of ${source.displayName}`}
                value={source.kind}
                disabled={locked}
                onChange={(event) => {
                  const kind = candidateEvidenceKinds.find(
                    (candidate) => candidate === event.target.value,
                  );
                  if (kind !== undefined) onChange(source.sourceId, kind);
                }}
              >
                {candidateEvidenceKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {evidenceKindLabel(kind)}
                  </option>
                ))}
              </select>
              <span className="evidence-kind-origin">
                {saving ? "saving…" : evidenceKindOriginLabel(source.origin)}
                {source.origin === "user" && !saving ? (
                  <>
                    {" · "}
                    <button
                      className="evidence-kind-clear"
                      type="button"
                      disabled={locked}
                      onClick={() => onChange(source.sourceId, null)}
                    >
                      use detected
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {state.truncated ? (
        <span className="evidence-kind-origin">Only the first sources are listed.</span>
      ) : null}
      {state.error === null ? null : (
        <span className="evidence-kind-origin" role="alert">
          {state.error}
        </span>
      )}
    </details>
  );
}

function failureText(reason: unknown): string {
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : "The evidence kind could not be saved.";
}

/**
 * Follows the kinds of one knowledge base's sources through the host, re-reading whenever the
 * base or `revision` changes. Null when the host offers no evidence kinds or no base is in use.
 */
export function useSourceEvidenceKinds(
  capabilities: SourceEvidenceKindCapabilities | undefined,
  target: { readonly storeId: string; readonly knowledgeBaseId: string } | null,
  revision: number | undefined,
): {
  readonly state: SourceEvidenceKindsState | null;
  readonly change: (sourceId: string, kind: CandidateEvidenceKind | null) => void;
} {
  const list = capabilities?.listSourceEvidenceKinds;
  const set = capabilities?.setSourceEvidenceKind;
  const supported = list !== undefined && set !== undefined;
  const storeId = target?.storeId;
  const knowledgeBaseId = target?.knowledgeBaseId;
  const [state, setState] = useState<SourceEvidenceKindsState>({ status: "loading" });
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const generation = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` re-reads the kinds after the base's sources change; the capabilities go through a ref so a new object never refetches.
  useEffect(() => {
    const read = capabilitiesRef.current?.listSourceEvidenceKinds;
    if (
      !supported ||
      read === undefined ||
      storeId === undefined ||
      knowledgeBaseId === undefined
    ) {
      return;
    }
    const token = ++generation.current;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    read(storeId, knowledgeBaseId).then(
      (result) => {
        if (generation.current !== token) return;
        setState({
          status: "ready",
          sources: result.sources,
          truncated: result.truncated,
          savingSourceId: null,
          error: null,
        });
      },
      () => {
        if (generation.current === token) setState({ status: "unavailable" });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [supported, storeId, knowledgeBaseId, revision]);

  const change = (sourceId: string, kind: CandidateEvidenceKind | null): void => {
    const write = capabilitiesRef.current?.setSourceEvidenceKind;
    if (write === undefined || storeId === undefined || knowledgeBaseId === undefined) return;
    if (state.status !== "ready" || state.savingSourceId !== null) return;
    const token = ++generation.current;
    setState({ ...state, savingSourceId: sourceId, error: null });
    write({ storeId, knowledgeBaseId, sourceId, kind }).then(
      (result) => {
        if (generation.current !== token) return;
        setState((current) =>
          current.status !== "ready"
            ? current
            : {
                ...current,
                sources: current.sources.map((source) =>
                  source.sourceId === result.source.sourceId ? result.source : source,
                ),
                savingSourceId: null,
              },
        );
      },
      (reason: unknown) => {
        if (generation.current !== token) return;
        setState((current) =>
          current.status !== "ready"
            ? current
            : { ...current, savingSourceId: null, error: failureText(reason) },
        );
      },
    );
  };

  return { state: supported && target !== null ? state : null, change };
}
