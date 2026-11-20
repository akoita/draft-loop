import { useSyncExternalStore } from "react";

/** The width at and under which the shared screens switch to their phone layout. */
export const phoneLayoutQuery = "(max-width: 640px)";

function phoneQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(phoneLayoutQuery);
}

function subscribe(onChange: () => void): () => void {
  const query = phoneQuery();
  if (query === null) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True while the window is phone-sized, as the stylesheet's phone rules see it. False outside a
 * browser, so a server-rendered screen keeps the wide layout.
 */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => phoneQuery()?.matches ?? false,
    () => false,
  );
}
