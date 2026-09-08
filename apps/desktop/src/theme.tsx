/**
 * Desk theme preference.
 *
 * The stylesheet carries two token sets: the dark desk on bare `:root` and the light desk on
 * `:root[data-theme="light"]`. Nothing in CSS reads `prefers-color-scheme` any more, because a
 * user who picks a theme has to be able to override the operating system. The renderer resolves
 * the preference — "system" against `matchMedia`, otherwise the literal choice — and writes the
 * result onto `document.documentElement`, so one copy of the light tokens serves both the
 * "the OS is light" case and the "the user asked for light" case.
 *
 * The preference lives in `localStorage`. It never reaches the main process: it changes nothing
 * the main process owns, and the desktop bridge's runtime command allowlist is not worth the
 * drift for a colour scheme.
 */
import { type JSX, useCallback, useEffect, useState } from "react";

/** How the desk chooses its colours: follow the OS, or a fixed choice. */
export type ThemePreference = "system" | "light" | "dark";

/** The cycle order of the toggle, and the only accepted stored values. */
export const themePreferences: readonly ThemePreference[] = Object.freeze([
  "system",
  "light",
  "dark",
] as const);

/** `localStorage` key holding the preference. */
export const themeStorageKey = "draft-loop.theme";

const prefersLightQuery = "(prefers-color-scheme: light)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && themePreferences.includes(value as ThemePreference);
}

/** One click of the toggle: system → light → dark → system. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = themePreferences.indexOf(current);
  return themePreferences[(index + 1) % themePreferences.length] ?? "system";
}

export function themePreferenceLabel(preference: ThemePreference): string {
  switch (preference) {
    case "light":
      return "Light";
    case "dark":
      return "Dark";
    default:
      return "Follow system";
  }
}

/**
 * The resolved desk. Pure, so the resolution rule is testable without a DOM: "system" defers to
 * the reported OS preference and anything else is taken literally.
 */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): "light" | "dark" {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

/**
 * Read the stored preference, defaulting to "system". A browser with site data blocked throws
 * from `getItem` rather than returning null, and a theme is never worth failing the boot for.
 */
export function readStoredThemePreference(storage?: Pick<Storage, "getItem">): ThemePreference {
  if (storage === undefined) return "system";
  try {
    const stored = storage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Persist the preference, ignoring quota and security failures for the same reason. */
export function writeStoredThemePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  preference: ThemePreference,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(themeStorageKey, preference);
  } catch {
    // A blocked or full store costs the user persistence, not the session.
  }
}

/** Write the resolved desk onto the document root, which is what the token selectors read. */
export function applyResolvedTheme(root: HTMLElement, resolved: "light" | "dark"): void {
  root.setAttribute("data-theme", resolved);
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function prefersLightQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(prefersLightQuery);
  } catch {
    return null;
  }
}

/**
 * Hold the preference, persist it, and keep `data-theme` in step with it. While the preference is
 * "system" the OS stays in charge, so the hook listens for the media query flipping under it.
 */
export function useThemePreference(): readonly [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStoredThemePreference(browserStorage()),
  );

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    writeStoredThemePreference(browserStorage(), next);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const query = prefersLightQueryList();
    const apply = () => {
      applyResolvedTheme(root, resolveTheme(preference, query?.matches ?? false));
    };
    apply();
    if (preference !== "system" || query === null) return;
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
    };
  }, [preference]);

  return [preference, choose] as const;
}

function ThemeIcon({ preference }: { readonly preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (preference === "dark") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4V3.8Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The theme control. It owns its own state through `useThemePreference`, so the rail and the boot
 * panels mount it without threading a preference through their props.
 */
export function ThemeToggle({
  className = "rail-button",
}: {
  readonly className?: string;
}): JSX.Element {
  const [preference, choose] = useThemePreference();
  const next = nextThemePreference(preference);
  const label = `Theme: ${themePreferenceLabel(preference)}. Activate to switch to ${themePreferenceLabel(next)}.`;
  return (
    <button className={className} type="button" title={label} onClick={() => choose(next)}>
      <span className="sr-only">{label}</span>
      <ThemeIcon preference={preference} />
    </button>
  );
}

// Resolve before React renders, so a light-desk user never sees a dark frame first.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyResolvedTheme(
    document.documentElement,
    resolveTheme(
      readStoredThemePreference(browserStorage()),
      prefersLightQueryList()?.matches ?? false,
    ),
  );
}
