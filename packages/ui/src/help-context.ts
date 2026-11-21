import type { HelpSectionId } from "@draft-loop/user-guide";
import { useEffect, useSyncExternalStore } from "react";

import type { NextStepStage } from "./next-step.js";

/**
 * Which guide section fits what the person is doing now (#3227), so Quick help opens on it
 * instead of at the top. Screens claim a section while they are shown; the newest claim wins and
 * an unmounted screen gives its claim back. The header's Help menu sits outside the screens, so
 * this is a small shared store rather than React context.
 */
const claims: { readonly token: symbol; readonly section: HelpSectionId }[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): HelpSectionId | null {
  return claims.at(-1)?.section ?? null;
}

/** Claims `section` until the returned function gives it back. */
export function claimHelpSection(section: HelpSectionId): () => void {
  const token = Symbol(section);
  claims.push({ token, section });
  notify();
  return () => {
    const index = claims.findIndex((claim) => claim.token === token);
    if (index >= 0) claims.splice(index, 1);
    notify();
  };
}

/** Claims `section` while the calling screen is shown; null claims nothing. */
export function useHelpSection(section: HelpSectionId | null): void {
  useEffect(() => (section === null ? undefined : claimHelpSection(section)), [section]);
}

/** The section the shown screen claims, or null; Quick help opens on it. */
export function useCurrentHelpSection(): HelpSectionId | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The guide section for a next-step stage, so Home's Help matches its guidance. */
export function helpSectionForStage(stage: NextStepStage): HelpSectionId {
  switch (stage) {
    case "career":
    case "profile":
      return "evidence";
    case "job":
      return "job";
    case "start-review":
    case "drafting":
    case "review-ended":
      return "draft";
    case "reviewing":
    case "export":
    case "done":
      return "review";
  }
}
