import { t } from "@lingui/core/macro";

/** The notice at the top of the Cover letter tab, before any button (#3277). */
export function CoverLetterRiskNotice() {
  return (
    <div className="cover-letter-risk" role="note">
      <p className="cover-letter-risk-title">{t`Write the letter yourself.`}</p>
      <p>{t`Recruiters and AI-detection tools often spot a letter written entirely by AI, and it can count against you. Use what DraftLoop gives you here as material, then write the letter in your own words.`}</p>
    </div>
  );
}

export interface CoverLetterRiskChoiceProps {
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
}

/** Asked once per application before the first full letter is drafted. */
export function CoverLetterRiskChoice({ busy, onAccept, onCancel }: CoverLetterRiskChoiceProps) {
  return (
    <section className="cover-letter-risk" aria-labelledby="cover-letter-risk-question">
      <p id="cover-letter-risk-question" className="cover-letter-risk-title">
        {t`This letter is written by AI.`}
      </p>
      <p>{t`Sending it as it is can be spotted and can count against you. Draft it to read and rewrite in your own words.`}</p>
      <div className="application-material-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={onAccept}>
          {t`I accept the risk, draft it`}
        </button>
        <button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>
          {t`Not now`}
        </button>
      </div>
    </section>
  );
}

/** The label on a saved letter that is still the model's text. */
export function CoverLetterModelLabel() {
  return <p className="cover-letter-model-label">{t`AI draft: rewrite before sending`}</p>;
}
