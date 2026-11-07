import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { pastedTextMaxLength, pastedTextProblem, pastedTitleMaxLength } from "./pasted-evidence.js";

export interface PastedEvidenceFormProps {
  /** Saves the text; resolves true once it is in the base, so the box can clear and close. */
  readonly onSave: (pasted: { readonly title: string; readonly text: string }) => Promise<boolean>;
  readonly disabled: boolean;
}

/**
 * The "Paste text" button of the Career evidence card and the box it opens (#2417): an optional
 * title and the text, saved as one more source of the base in use.
 */
export function PastedEvidenceForm({ onSave, disabled }: PastedEvidenceFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const panelId = useId();
  const hintId = useId();
  const problem = pastedTextProblem(text);
  const tooLong = text.length > pastedTextMaxLength;
  const count = text.length.toLocaleString();
  const limit = pastedTextMaxLength.toLocaleString();

  const close = () => {
    setOpen(false);
    setTried(false);
  };

  return (
    <>
      <button
        className="button button-quiet"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled && !open}
        onClick={() => (open ? close() : setOpen(true))}
      >{t`Paste text`}</button>
      {open ? (
        <form
          id={panelId}
          className="pasted-evidence"
          aria-label={t`Paste text as career evidence`}
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (problem !== undefined || disabled) return;
            void onSave({ title, text }).then((saved) => {
              if (!saved) return;
              setTitle("");
              setText("");
              close();
            });
          }}
        >
          <label className="pasted-evidence-field">
            <span>{t`Title (optional)`}</span>
            <input
              type="text"
              value={title}
              maxLength={pastedTitleMaxLength}
              placeholder={t`Project notes, profile summary…`}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="pasted-evidence-field">
            <span>{t`Text`}</span>
            <textarea
              rows={8}
              value={text}
              aria-describedby={hintId}
              aria-invalid={tried && problem !== undefined}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="pasted-evidence-hint" id={hintId}>
            <span>{t`Paste a CV, a profile summary or notes about your work. Leave out passwords and other people's personal data. It is checked for hidden instructions like any file.`}</span>
            <span className={tooLong ? "pasted-evidence-count-over" : undefined}>
              {t`${count} / ${limit}`}
            </span>
          </div>
          {tried && problem !== undefined ? (
            <span className="setup-card-line" role="alert">
              {problem}
            </span>
          ) : null}
          <div className="pasted-evidence-actions">
            <button className="button button-primary" type="submit" disabled={disabled}>
              {t`Save to career evidence`}
            </button>
            <button className="button button-quiet" type="button" onClick={close}>
              {t`Cancel`}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
