import { createContext, type ReactNode, useContext } from "react";

/**
 * Panels a host adds to the shared screens. Every slot is optional and renders nothing when the
 * host leaves it out, so a host without extras, such as the desktop, shows the screens unchanged.
 */
export interface HostPanels {
  /** Shown above the Career evidence card, such as a consent the host must record first. */
  readonly evidenceBefore?: ReactNode;
  /**
   * Shown below the Career evidence page's knowledge panel. `revision` changes whenever the page
   * changes the knowledge selection or adds files, so the panel can read its data again.
   */
  readonly evidenceAfter?: (context: { readonly revision: number }) => ReactNode;
  /**
   * Shown in the Start confirmation above its buttons, such as a consent and the run's cost.
   * `applicationId` is the application the run belongs to, when the screen knows it. While the
   * panel holds a reason through `setBlockedReason`, Start stays disabled and shows it; pass
   * `null` to lift it.
   */
  readonly startDialog?: (context: StartDialogContext) => ReactNode;
}

/** What the host's Start confirmation panel is given. */
export interface StartDialogContext {
  readonly applicationId: string | null;
  readonly setBlockedReason: (reason: string | null) => void;
}

/** The host's panels; none until a host provides them. */
export const HostPanelsContext = createContext<HostPanels>({});

/** The host's panel above the Career evidence card; nothing without one. */
export function HostEvidenceBefore() {
  return useContext(HostPanelsContext).evidenceBefore ?? null;
}

/** The host's panel below the Career evidence page's knowledge panel; nothing without one. */
export function HostEvidenceAfter({ revision }: { readonly revision: number }) {
  return useContext(HostPanelsContext).evidenceAfter?.({ revision }) ?? null;
}

/** The host's panel in the Start confirmation; nothing without one. */
export function HostStartDialog(context: StartDialogContext) {
  return useContext(HostPanelsContext).startDialog?.(context) ?? null;
}
