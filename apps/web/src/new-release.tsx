import { useEffect, useState } from "react";

import { NEW_RELEASE_MESSAGE, watchForNewRelease } from "./new-release-model.js";

/** The entry script the running page loaded. */
function runningEntryScript(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null;
}

/** Watches this tab for a new release, in a browser. */
function useNewRelease(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(
    () =>
      watchForNewRelease({
        running: runningEntryScript(),
        fetchIndex: async () => {
          const response = await fetch("/", { cache: "no-store" });
          if (!response.ok) throw new Error(`The page answered ${response.status}.`);
          return response.text();
        },
        onNewRelease: () => setAvailable(true),
        onFocus: (check) => {
          const visible = () => {
            if (document.visibilityState === "visible") check();
          };
          window.addEventListener("focus", check);
          document.addEventListener("visibilitychange", visible);
          return () => {
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", visible);
          };
        },
        every: (intervalMs, check) => {
          const timer = window.setInterval(check, intervalMs);
          return () => window.clearInterval(timer);
        },
      }),
    [],
  );
  return available;
}

export interface NewReleaseNoticeProps {
  readonly onReload: () => void;
}

/** Says a new release is serving, with the one action that picks it up. */
export function NewReleaseNotice({ onReload }: NewReleaseNoticeProps) {
  return (
    <div className="notice new-release" role="status">
      <span>{NEW_RELEASE_MESSAGE}</span>
      <button type="button" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}

/** Shows the notice once this tab finds a new release. */
export function NewReleaseWatch() {
  const available = useNewRelease();
  return available ? <NewReleaseNotice onReload={() => location.reload()} /> : null;
}
