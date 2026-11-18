import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { Loaded } from "./operator-model.js";

/** How long typing pauses before a search reads the list again. */
export const searchPauseMs = 300;

/**
 * A search box for an operator list (#3015). It reads again once typing pauses, so a long list
 * is searched on the server rather than scrolled.
 */
export function ListSearch({
  label,
  query,
  onSearch,
}: {
  readonly label: string;
  readonly query: string;
  readonly onSearch: (query: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(query);
  const latest = useRef(onSearch);
  latest.current = onSearch;

  useEffect(() => {
    if (value.trim() === query.trim()) return;
    const timer = setTimeout(() => latest.current(value.trim()), searchPauseMs);
    return () => clearTimeout(timer);
  }, [value, query]);

  return (
    <div className="operator-search">
      <label htmlFor={`${id}-search`}>{label}</label>
      <input
        id={`${id}-search`}
        type="search"
        value={value}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

/** How many rows are shown out of those that match, and a way to read the next page. */
export function ListMore({
  shown,
  total,
  loading,
  problem,
  onMore,
}: {
  readonly shown: number;
  readonly total: number;
  readonly loading: boolean;
  readonly problem?: string | undefined;
  readonly onMore?: (() => void) | undefined;
}) {
  if (total === 0) return null;
  return (
    <div className="operator-more">
      <p className="muted" role="status">
        {t`Showing ${shown} of ${total}`}
      </p>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {shown < total && onMore !== undefined ? (
        <button type="button" className="secondary" disabled={loading} onClick={onMore}>
          {loading ? t`Reading…` : t`Show more`}
        </button>
      ) : null}
    </div>
  );
}

export interface PagedList<P> {
  readonly state: Loaded<P>;
  /** Replaces the page in place, as a triage does. */
  readonly update: (change: (page: P) => P) => void;
  /** Reads the first page again. */
  readonly reload: () => Promise<void>;
  /** Reads the next page and adds its rows. */
  readonly more: () => Promise<void>;
  readonly loadingMore: boolean;
  readonly moreProblem: string | undefined;
}

/**
 * One operator list read a page at a time. `read` changes when the search or filter does, which
 * reads the first page again; an answer to an older read is dropped. The rows shown stay on
 * screen until the new ones arrive.
 */
export function usePagedList<P>(
  read: (offset: number) => Promise<Loaded<P>>,
  merge: (shown: P, next: P) => P,
  size: (page: P) => number,
): PagedList<P> {
  const [state, setState] = useState<Loaded<P>>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProblem, setMoreProblem] = useState<string | undefined>(undefined);
  const generation = useRef(0);
  const shown = useRef<Loaded<P>>(state);
  shown.current = state;
  const helpers = useRef({ merge, size });
  helpers.current = { merge, size };

  const readFirst = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setMoreProblem(undefined);
    const next = await read(0);
    if (mine === generation.current) setState(next);
  }, [read]);

  useEffect(() => {
    void readFirst();
  }, [readFirst]);

  const more = useCallback(async () => {
    const current = shown.current;
    if (current.kind !== "ready") return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreProblem(undefined);
    const next = await read(helpers.current.size(current.value));
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (next.kind === "failed") {
      setMoreProblem(next.message);
      return;
    }
    if (next.kind !== "ready") return;
    setState((previous) =>
      previous.kind === "ready"
        ? { kind: "ready", value: helpers.current.merge(previous.value, next.value) }
        : previous,
    );
  }, [read]);

  const update = useCallback((change: (page: P) => P) => {
    setState((previous) =>
      previous.kind === "ready" ? { kind: "ready", value: change(previous.value) } : previous,
    );
  }, []);

  return { state, update, reload: readFirst, more, loadingMore, moreProblem };
}
