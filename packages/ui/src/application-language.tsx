import {
  detectTextLanguage,
  documentLanguageChoiceLabel,
  documentLanguageLabel,
  documentLanguages,
  isDocumentLanguage,
} from "@draft-loop/domain/document-language";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

/** The select value that keeps the workspace's language. */
export const workspaceLanguageValue = "";

/**
 * The language a pasted job posting is written in, when it is an offered language other than the
 * one already chosen; `undefined` when the guess is unsure or there is nothing to propose.
 */
export function proposedJobLanguage(jobText: string, chosen: string): string | undefined {
  const detected = detectTextLanguage(jobText)?.code;
  if (detected === undefined || !isDocumentLanguage(detected) || detected === chosen) {
    return undefined;
  }
  return detected;
}

export interface DocumentLanguageSelectProps {
  /** An offered language code, or "" for the workspace's language. */
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}

/** Picks the language an application's documents are written in. */
export function DocumentLanguageSelect({ value, disabled, onChange }: DocumentLanguageSelectProps) {
  const id = useId();
  return (
    <span className="document-language-select">
      <label htmlFor={id}>{t`Write its documents in`}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={workspaceLanguageValue}>{t`The workspace's language`}</option>
        {documentLanguages.map((language) => (
          <option key={language.code} value={language.code}>
            {documentLanguageChoiceLabel(language)}
          </option>
        ))}
      </select>
    </span>
  );
}

export interface JobLanguageProposalProps {
  readonly language: string;
  readonly disabled: boolean;
  readonly onAccept: () => void;
}

/** Offers the job posting's own language, which the person can take or ignore. */
export function JobLanguageProposal({ language, disabled, onAccept }: JobLanguageProposalProps) {
  const label = documentLanguageLabel(language);
  return (
    <p className="job-language-proposal" role="status">
      {t`This job posting looks ${label}.`}{" "}
      <button className="button button-quiet" type="button" disabled={disabled} onClick={onAccept}>
        {t`Write in ${label}`}
      </button>
    </p>
  );
}

export interface ApplicationLanguageControlProps {
  /** The application's own language; null uses the workspace's. */
  readonly language: string | null;
  readonly disabled: boolean;
  /** Saves the choice; rejects with the message to show. */
  readonly onSave: (language: string | null) => Promise<void>;
}

/** The application page's language choice: it saves as soon as the person picks one. */
export function ApplicationLanguageControl({
  language,
  disabled,
  onSave,
}: ApplicationLanguageControlProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (value: string) => {
    if (saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value === workspaceLanguageValue ? null : value);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error && reason.message.trim() !== ""
          ? reason.message
          : t`The language could not be saved.`,
      );
    }
    setSaving(false);
  };
  return (
    <div className="application-language">
      <DocumentLanguageSelect
        value={language ?? workspaceLanguageValue}
        disabled={disabled || saving}
        onChange={(value) => void choose(value)}
      />
      <p className="subtle">
        {t`The CV, cover letter and interview questions of new runs use this language.`}
      </p>
      {error === null ? null : (
        <p className="setup-blocker" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
