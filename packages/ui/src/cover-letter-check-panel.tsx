import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";

import type {
  CoverLetterCheckSkipReason,
  CoverLetterCheckView,
  CoverLetterClaimFindingView,
  CoverLetterWordingCode,
} from "./cover-letter-check-contract.js";
import { maximumCoverLetterCheckCharacters } from "./cover-letter-check-contract.js";
import { formatNumber } from "./locale-format.js";

export type { CheckCoverLetter } from "./cover-letter-check-capabilities.js";
export { createCoverLetterCheckCapability } from "./cover-letter-check-capabilities.js";
export type { CoverLetterCheckView } from "./cover-letter-check-contract.js";

/**
 * Check my letter (#3280): a panel under the candidate's own letter. One press sends the text to
 * the host once and shows three groups of findings, never a rewrite: claims the approved facts do
 * not support, requirements not answered yet, and wording that reads as machine-made. The host
 * keeps no copy of the letter, and the consent line says so before the press.
 */

/** What the panel shows: nothing yet, a check running, a result, or a failed check. */
export type CoverLetterCheckState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "done"; readonly check: CoverLetterCheckView }
  | { readonly kind: "failed" };

/** Why the letter cannot be checked as it stands, or undefined when it can. */
export function coverLetterCheckBlock(text: string): "empty" | "too_long" | undefined {
  if (text.trim() === "") return "empty";
  if (text.length > maximumCoverLetterCheckCharacters) return "too_long";
  return undefined;
}

/** Runs one check and returns the state to show; a thrown error becomes `failed`. */
export async function runCoverLetterCheck(
  check: (text: string) => Promise<CoverLetterCheckView>,
  text: string,
): Promise<CoverLetterCheckState> {
  try {
    return { kind: "done", check: await check(text) };
  } catch {
    return { kind: "failed" };
  }
}

function skipLabel(reason: CoverLetterCheckSkipReason | null): string {
  switch (reason) {
    case "model_calls_paused":
      return t`The claim check is paused for a short while. The other checks ran.`;
    case "consent_required":
      return t`To check claims, allow sending career material to Anthropic in your consent settings. The other checks ran.`;
    case "no_facts":
      return t`Your career profile has no approved facts to check claims against yet.`;
    default:
      return t`This server cannot check claims. The other checks ran.`;
  }
}

function claimReason(finding: CoverLetterClaimFindingView): string {
  if (finding.reason === "number_not_in_fact") {
    const numbers = finding.numbers.join(", ");
    return t`No approved fact states ${numbers}.`;
  }
  if (finding.reason === "joins_different_roles") {
    return t`It joins facts from different roles.`;
  }
  return finding.about === "employer"
    ? t`No research finding or job requirement says this.`
    : t`No approved fact says this.`;
}

function wordingLabel(code: CoverLetterWordingCode, match: string | null): string {
  switch (code) {
    case "job_ad_echo":
      return t`Copied from the job ad`;
    case "empty_superlative":
      return t`Praise with no fact behind it`;
    case "stock_phrase":
      return t`Stock phrase`;
    case "heavy_dashes":
      return t`Many dashes`;
    case "list_of_three":
      return t`A list of three`;
    case "mirrored_openings":
      return t`Paragraphs open the same way`;
    case "word_count": {
      const words = match ?? "";
      return t`Length: ${words} words; aim for 250 to 350`;
    }
  }
}

export interface CoverLetterCheckPanelViewProps {
  readonly text: string;
  readonly state: CoverLetterCheckState;
  readonly onCheck: () => void;
}

/** The panel for a given state, without effects: the host component and tests render it. */
export function CoverLetterCheckPanelView({
  text,
  state,
  onCheck,
}: CoverLetterCheckPanelViewProps) {
  const id = useId();
  const block = coverLetterCheckBlock(text);
  const checking = state.kind === "checking";
  const maximum = formatNumber(maximumCoverLetterCheckCharacters);
  return (
    <section className="cover-letter-check" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t`Check my letter`}</h3>
      <p className="cover-letter-check-consent" id={`${id}-consent`}>
        {t`Pressing Check my letter sends this text once to Anthropic's model to compare its claims with your approved facts. Nothing is rewritten, and Redakloop does not keep the letter.`}
      </p>
      <div className="cover-letter-check-actions">
        <button
          className="button button-outline"
          type="button"
          disabled={checking || block !== undefined}
          aria-describedby={`${id}-consent`}
          onClick={onCheck}
        >
          {checking ? t`Checking…` : t`Check my letter`}
        </button>
        {block === "too_long" ? (
          <span className="cover-letter-check-note">{t`The letter is longer than ${maximum} characters; shorten it to check it.`}</span>
        ) : null}
      </div>
      <div aria-live="polite">
        {state.kind === "failed" ? (
          <p className="cover-letter-check-note" role="alert">
            {t`The check did not finish. Your letter is unchanged; try again.`}
          </p>
        ) : null}
        {state.kind === "done" ? <CoverLetterCheckFindings check={state.check} /> : null}
      </div>
    </section>
  );
}

function CoverLetterCheckFindings({ check }: { readonly check: CoverLetterCheckView }) {
  const { claims, requirements, wording } = check;
  const claimCount = claims.findings.length;
  const unansweredCount = requirements.unanswered.length;
  const wordingCount = wording.length;
  return (
    <div className="cover-letter-check-groups">
      <section className="cover-letter-check-group">
        <h4>
          {t`Claims your approved facts do not support`}
          {claims.status === "checked" ? (
            <span className="cover-letter-check-count">{claimCount}</span>
          ) : null}
        </h4>
        {claims.status === "skipped" ? (
          <p className="cover-letter-check-note">{skipLabel(claims.reason)}</p>
        ) : claimCount === 0 ? (
          <p className="cover-letter-check-note">{t`Every claim matches an approved fact.`}</p>
        ) : (
          <ul>
            {claims.findings.map((finding) => (
              <li key={`${finding.paragraph}:${finding.sentence}`}>
                <q>{finding.sentence}</q>
                <span className="cover-letter-check-why">{claimReason(finding)}</span>
                {finding.closestFact === null ? (
                  <span className="cover-letter-check-fact">{t`No approved fact is close.`}</span>
                ) : (
                  <span className="cover-letter-check-fact">
                    {t`Closest approved fact:`} {finding.closestFact.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cover-letter-check-group">
        <h4>
          {t`Requirements not answered yet`}
          <span className="cover-letter-check-count">{unansweredCount}</span>
        </h4>
        {requirements.source === "none" ? (
          <p className="cover-letter-check-note">{t`The job lists no requirements to check against.`}</p>
        ) : unansweredCount === 0 ? (
          <p className="cover-letter-check-note">{t`The letter answers every requirement.`}</p>
        ) : (
          <>
            <p className="cover-letter-check-note">
              {requirements.source === "kit"
                ? plural(requirements.total, {
                    one: "From your writing kit's # requirement.",
                    other: "From your writing kit's # requirements.",
                  })
                : plural(requirements.total, {
                    one: "From the job's top requirement.",
                    other: "From the job's top # requirements.",
                  })}
            </p>
            <ul>
              {requirements.unanswered.map((requirement) => (
                <li key={requirement.requirementId}>
                  <span>{requirement.text}</span>
                  {requirement.facts.map((fact) => (
                    <span className="cover-letter-check-fact" key={fact.factId}>
                      {t`Approved fact that proves it:`} {fact.text}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="cover-letter-check-group">
        <h4>
          {t`Wording that reads as machine-made`}
          <span className="cover-letter-check-count">{wordingCount}</span>
        </h4>
        {wordingCount === 0 ? (
          <p className="cover-letter-check-note">{t`No machine-sounding wording found.`}</p>
        ) : (
          <ul>
            {wording.map((finding) => (
              <li key={`${finding.code}:${finding.paragraph}:${finding.sentence}:${finding.match}`}>
                <span className="cover-letter-check-why">
                  {wordingLabel(finding.code, finding.match)}
                </span>
                {finding.sentence === null ? null : <q>{finding.sentence}</q>}
                {finding.match === null || finding.code === "word_count" ? null : (
                  <span className="cover-letter-check-fact">“{finding.match}”</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export interface CoverLetterCheckPanelProps {
  /** The letter as the candidate has written it so far. */
  readonly text: string;
  /** The host's check for this application, such as a bound `CheckCoverLetter`. */
  readonly check: (text: string) => Promise<CoverLetterCheckView>;
}

/** The panel with its state: one check at a time, on the candidate's press only. */
export function CoverLetterCheckPanel({ text, check }: CoverLetterCheckPanelProps) {
  const [state, setState] = useState<CoverLetterCheckState>({ kind: "idle" });
  const onCheck = () => {
    if (state.kind === "checking" || coverLetterCheckBlock(text) !== undefined) return;
    setState({ kind: "checking" });
    void runCoverLetterCheck(check, text).then(setState);
  };
  return <CoverLetterCheckPanelView text={text} state={state} onCheck={onCheck} />;
}
