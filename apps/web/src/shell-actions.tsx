import { createContext, type ReactNode, useContext } from "react";

export type Health = "checking" | "serving" | "unreachable";

const healthLabels: Readonly<Record<Health, string>> = {
  checking: "Checking the service",
  serving: "Service is up",
  unreachable: "Service is down",
};

/**
 * The shell's own actions, the service status and sign-out, drawn in the shared screens' header
 * where the desktop has Close workspace (#1933), or above a screen that has no such header.
 */
export const ShellActionsContext = createContext<ReactNode>(null);

/** The service's health as a small dot and a short label. */
export function ServiceStatus({ health }: { readonly health: Health }) {
  return (
    <span className={`service-status service-${health}`} role="status">
      <span className="service-dot" aria-hidden="true" />
      {healthLabels[health]}
    </span>
  );
}

/** The red strip at the top of the page while the service cannot be reached. */
export function ServiceDown() {
  return (
    <p className="service-down" role="alert">
      The service cannot be reached. Your work is saved; try again in a moment.
    </p>
  );
}

export function SignOutButton({ onSignOut }: { readonly onSignOut: () => void }) {
  return (
    <button type="button" className="button button-toolbar" onClick={onSignOut}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M14 8l4 4-4 4M18 12H9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sign out
    </button>
  );
}

export function ConsentButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button type="button" className="button button-toolbar" onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 12l2 2 4-4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Consent, rules &amp; credits
    </button>
  );
}

/** The shell's actions above a screen without the shared header, aligned to the right. */
export function PageActions({ children }: { readonly children?: ReactNode }) {
  const shell = useContext(ShellActionsContext);
  if (shell === null && children === undefined) return null;
  return (
    <div className="page-actions">
      {children}
      {shell}
    </div>
  );
}
