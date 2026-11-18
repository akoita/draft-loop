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
  /**
   * Reads the first page again in the background (#3024): a failed read keeps the rows shown, and
   * a list grown with "Show more" is left alone so the operator's place is kept.
   */
  readonly refresh: () => Promise<void>;
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

  const grown = useRef(false);
  const readingMore = useRef(false);

  const readFirst = useCallback(async () => {
    grown.current = false;
    generation.current += 1;
    const mine = generation.current;
    setMoreProblem(undefined);
    const next = await read(0);
    if (mine === generation.current) setState(next);
  }, [read]);

  useEffect(() => {
    void readFirst();
  }, [readFirst]);

  const refresh = useCallback(async () => {
    if (grown.current || readingMore.current || shown.current.kind !== "ready") return;
    generation.current += 1;
    const mine = generation.current;
    const next = await read(0);
    if (mine === generation.current && next.kind === "ready" && !grown.current) setState(next);
  }, [read]);

  const more = useCallback(async () => {
    const current = shown.current;
    if (current.kind !== "ready") return;
    const mine = generation.current;
    setLoadingMore(true);
    readingMore.current = true;
    setMoreProblem(undefined);
    const next = await read(helpers.current.size(current.value));
    readingMore.current = false;
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (next.kind === "failed") {
      setMoreProblem(next.message);
      return;
    }
    if (next.kind !== "ready") return;
    grown.current = true;
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

  return { state, update, reload: readFirst, refresh, more, loadingMore, moreProblem };
}

/** How often an open operator page reads its lists again while the tab is visible. */
export const operatorRefreshMs = 30_000;

/** What the background refresh needs from the browser; tests pass a fake. */
export interface RefreshHost {
  readonly visible: () => boolean;
  readonly every: (work: () => void, ms: number) => () => void;
  readonly onShown: (work: () => void) => () => void;
}

const browserHost: RefreshHost = {
  visible: () => document.visibilityState === "visible",
  every: (work, ms) => {
    const timer = window.setInterval(work, ms);
    return () => window.clearInterval(timer);
  },
  onShown: (work) => {
    document.addEventListener("visibilitychange", work);
    window.addEventListener("focus", work);
    return () => {
      document.removeEventListener("visibilitychange", work);
      window.removeEventListener("focus", work);
    };
  },
};

/**
 * Calls `refresh` every `intervalMs` while the tab is visible, and again when the tab comes back
 * into view; never while it is hidden. Returns the function that stops it.
 */
export function startBackgroundRefresh(
  refresh: () => void,
  intervalMs: number,
  host: RefreshHost = browserHost,
): () => void {
  const tick = () => {
    if (host.visible()) refresh();
  };
  const stopTimer = host.every(tick, intervalMs);
  const stopShown = host.onShown(tick);
  return () => {
    stopTimer();
    stopShown();
  };
}

/**
 * Keeps the operator page current without a socket (#3024), through `startBackgroundRefresh`.
 * While `paused`, as during an invite, it waits.
 */
export function useBackgroundRefresh(
  refresh: () => void,
  paused: boolean,
  intervalMs: number = operatorRefreshMs,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (paused) return;
    return startBackgroundRefresh(() => latest.current(), intervalMs);
  }, [paused, intervalMs]);
}
