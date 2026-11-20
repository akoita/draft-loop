import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { useDisplayFold } from "./display-fold.js";

export interface AdvancedOptionsProps {
  /**
   * Controls the fold. Leave it out to let the person open and close it freely; pass it when an
   * error or a button elsewhere must be able to open the section.
   */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  /**
   * What is not at its default inside, such as "2 private-section rules". It shows on the folded
   * line, so a choice with consequences is never hidden.
   */
  readonly note?: string | null;
  readonly children: ReactNode;
}

/**
 * The one place a card keeps its technical choices: always labelled Advanced options, last in its
 * card and folded, or open when the person chose Show everything. Nothing the basic path needs
 * goes inside.
 */
export function AdvancedOptions({ open, onToggle, note = null, children }: AdvancedOptionsProps) {
  // Show everything (#2789) starts every uncontrolled section open, and a switch applies at once.
  const [freeOpen, setFreeOpen] = useDisplayFold();
  const shownOpen = open ?? freeOpen;
  return (
    <details
      className="advanced-options"
      open={shownOpen}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (open === undefined) setFreeOpen(next);
        onToggle?.(next);
      }}
    >
      <summary>
        {t`Advanced options`}
        {note === null ? null : <span className="advanced-options-note"> · {note}</span>}
      </summary>
      <div className="advanced-options-body">
        <p className="advanced-options-hint">{t`Most people never need these.`}</p>
        {children}
      </div>
    </details>
  );
}

export interface AdvancedOptionProps {
  readonly title: string;
  /** One sentence on what the option does. */
  readonly effect: string;
  /** The option's current state, such as "Off" or the name in use. */
  readonly state?: string | null;
  /** The option's one control, usually a button. */
  readonly children: ReactNode;
}

/** One advanced option: its name, its state, what it does and one control. */
export function AdvancedOption({ title, effect, state = null, children }: AdvancedOptionProps) {
  return (
    <div className="advanced-option">
      <div className="advanced-option-text">
        <strong>{title}</strong>
        {state === null ? null : <span className="meta-chip">{state}</span>}
        <p>{effect}</p>
      </div>
      <div className="advanced-option-control">{children}</div>
    </div>
  );
}
