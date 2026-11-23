import { t } from "@lingui/core/macro";
import { useId } from "react";

import { type CoverLetterHelp, coverLetterHelpLevels } from "./cover-letter-kit-model.js";

/**
 * "How much help do you want?" on the Cover letter tab (#3279). The writing kit is the default
 * and the recommended choice; the annotated draft (#3281) is named but not ready yet; the full
 * draft keeps its one-time risk choice (#3277).
 */

const helpLabels = (): Readonly<Record<CoverLetterHelp, string>> => ({
  kit: t`Writing kit`,
  annotated: t`Annotated draft`,
  full: t`Full draft`,
});

const helpDescriptions = (): Readonly<Record<CoverLetterHelp, string>> => ({
  kit: t`The facts and notes to write from. You write the letter.`,
  annotated: t`A draft with a note on each paragraph, to rewrite in your words.`,
  full: t`A letter written by AI. It can be spotted and count against you.`,
});

export interface CoverLetterHelpChoiceProps {
  readonly value: CoverLetterHelp;
  readonly disabled?: boolean;
  readonly onChange: (help: CoverLetterHelp) => void;
}

export function CoverLetterHelpChoice({ value, disabled, onChange }: CoverLetterHelpChoiceProps) {
  const name = useId();
  return (
    <fieldset className="cover-letter-help" disabled={disabled}>
      <legend>{t`How much help do you want?`}</legend>
      <div className="cover-letter-help-options">
        {coverLetterHelpLevels.map((level) => (
          <label key={level} className="cover-letter-help-option">
            <input
              type="radio"
              name={name}
              value={level}
              checked={value === level}
              onChange={() => onChange(level)}
            />
            <span className="cover-letter-help-title">
              {helpLabels()[level]}
              {level === "kit" ? (
                <span className="cover-letter-help-badge">{t`Recommended`}</span>
              ) : null}
              {level === "annotated" ? (
                <span className="cover-letter-help-badge cover-letter-help-badge-soon">
                  {t`Coming soon`}
                </span>
              ) : null}
            </span>
            <span className="cover-letter-help-line">{helpDescriptions()[level]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Shown in place of the annotated draft until it ships (#3281). */
export function AnnotatedDraftComingSoon({ onUseKit }: { readonly onUseKit: () => void }) {
  return (
    <div className="cover-letter-help-soon" role="note">
      <p>{t`The annotated draft is not ready yet. Use the writing kit for now: it gives the same facts and notes, and you write the letter.`}</p>
      <div className="cover-letter-kit-actions">
        <button type="button" className="button button-outline" onClick={onUseKit}>
          {t`Use the writing kit`}
        </button>
      </div>
    </div>
  );
}
