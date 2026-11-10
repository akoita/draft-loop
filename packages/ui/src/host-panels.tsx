import { createContext, type ReactNode, useContext } from "react";
import type { LoadExportPreview } from "./export-preview.js";

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
   * `openHome` opens Home, where Workspace settings are, when the screens offer it.
   */
  readonly evidenceAfter?: (context: EvidenceAfterContext) => ReactNode;
  /**
   * Shown in the Start confirmation above its buttons, such as a consent and the run's cost.
   * `applicationId` is the application the run belongs to, when the screen knows it. While the
   * panel holds a reason through `setBlockedReason`, Start stays disabled and shows it; pass
   * `null` to lift it.
   */
  readonly startDialog?: (context: StartDialogContext) => ReactNode;
  /**
   * Shown inside Home's Career evidence card, such as the work journal notes that wait for review.
   * `openEvidence` opens the Career evidence page.
   */
  readonly homeEvidence?: (context: HomeEvidenceContext) => ReactNode;
  /** Shown under an application's header, such as drafting its cover letter (#2217). */
  readonly application?: (context: ApplicationPanelContext) => ReactNode;
  /**
   * Shown under Home's Workspace settings actions, such as suggested preferences (#2265).
   * `openEvidence` opens the Career evidence page.
   */
  readonly workspaceSettings?: (context: HomeEvidenceContext) => ReactNode;
  /**
   * Reads the file an export would save without saving it, for the review's Preview (#2498).
   * Without it the review offers no preview.
   */
  readonly exportPreview?: LoadExportPreview;
}

/** What the host's panel below the Career evidence page's knowledge panel is given. */
export interface EvidenceAfterContext {
  readonly revision: number;
  readonly openHome?: (() => void) | undefined;
}

/** What the host's panel on an application is given. */
export interface ApplicationPanelContext {
  readonly applicationId: string;
}

/** What the host's panels on Home, in the Career evidence card and Workspace settings, are given. */
export interface HomeEvidenceContext {
  readonly openEvidence: () => void;
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
export function HostEvidenceAfter(context: EvidenceAfterContext) {
  return useContext(HostPanelsContext).evidenceAfter?.(context) ?? null;
}

/** The host's panel in the Start confirmation; nothing without one. */
export function HostStartDialog(context: StartDialogContext) {
  return useContext(HostPanelsContext).startDialog?.(context) ?? null;
}

/** The host's panel in Home's Career evidence card; nothing without one. */
export function HostHomeEvidence(context: HomeEvidenceContext) {
  return useContext(HostPanelsContext).homeEvidence?.(context) ?? null;
}

/** The host's panel under an application's header; nothing without one. */
export function HostApplicationPanel(context: ApplicationPanelContext) {
  return useContext(HostPanelsContext).application?.(context) ?? null;
}

/**
 * Asks the host's application panel to unfold and scroll into view (#2578): the review's toolbar
 * sends it and the panel listens on the window, so neither imports the other.
 */
export const openApplicationPanelEvent = "draft-loop:open-application-panel";

export function requestApplicationPanel(): void {
  globalThis.dispatchEvent?.(new Event(openApplicationPanelEvent));
}

/** Whether the host offers an application panel, so the review can point to it. */
export function useHasApplicationPanel(): boolean {
  return useContext(HostPanelsContext).application !== undefined;
}

/** The host's panel under Home's Workspace settings actions; nothing without one. */
export function HostWorkspaceSettings(context: HomeEvidenceContext) {
  return useContext(HostPanelsContext).workspaceSettings?.(context) ?? null;
}

/** The host's export preview reader, or undefined when the host offers no preview (#2498). */
export function useExportPreview(): LoadExportPreview | undefined {
  return useContext(HostPanelsContext).exportPreview;
}
