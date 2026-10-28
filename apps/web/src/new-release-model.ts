/**
 * Noticing a new release while a tab stays open (#1904). The API serves the built screen with a
 * revalidated `index.html` and content-hashed assets, so a release changes the entry script the
 * page names. A tab compares the one it runs with the one served now.
 */

/** How often an open tab checks, besides whenever it regains focus. */
export const RELEASE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const NEW_RELEASE_MESSAGE = "A new version of DraftLoop is available.";

/** The module script an HTML page loads, as written in its `src`, or null without one. */
export function entryScriptOf(html: string): string | null {
  for (const match of html.matchAll(/<script\b([^>]*)>/giu)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*["']?module\b/iu.test(attributes)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (src !== undefined) return src;
  }
  return null;
}

/** True only when both pages name an entry script and they differ. */
export function isNewRelease(running: string | null, served: string | null): boolean {
  return running !== null && served !== null && running !== served;
}

export interface ReleaseWatch {
  /** The entry script this tab runs. */
  readonly running: string | null;
  /** Reads the page the API serves now, bypassing the browser's cache. */
  readonly fetchIndex: () => Promise<string>;
  readonly onNewRelease: () => void;
  /** Calls back when the tab regains focus or becomes visible; returns how to stop. */
  readonly onFocus: (check: () => void) => () => void;
  /** Calls back every interval; returns how to stop. */
  readonly every: (intervalMs: number, check: () => void) => () => void;
}

/**
 * Checks on focus and on a timer until a new release is found, then stops: the notice stays
 * until the person reloads. A failed check is ignored, as the next one may succeed.
 */
export function watchForNewRelease(watch: ReleaseWatch): () => void {
  if (watch.running === null) return () => undefined;
  let stopped = false;
  let checking = false;
  const stop = () => {
    stopped = true;
    stopFocus();
    stopTimer();
  };
  const check = () => {
    if (stopped || checking) return;
    checking = true;
    watch
      .fetchIndex()
      .then((html) => {
        if (!stopped && isNewRelease(watch.running, entryScriptOf(html))) {
          stop();
          watch.onNewRelease();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  };
  const stopFocus = watch.onFocus(check);
  const stopTimer = watch.every(RELEASE_CHECK_INTERVAL_MS, check);
  return stop;
}
