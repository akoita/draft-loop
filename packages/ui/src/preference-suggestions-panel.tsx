import { useId, useState } from "react";

/**
 * Writing preferences suggested from the person's own review choices (#2265), beside Edit
 * policy. DraftLoop suggests; the person decides. A host that serves the suggestions provides
 * this as a host panel, and it shows nothing while there is nothing to decide.
 */

export interface PreferenceSuggestionView {
  readonly id: string;
  readonly kind: "forbidden-term" | "section-order";
  readonly term?: string | undefined;
  readonly sectionOrder?: readonly string[] | undefined;
  readonly reason: string;
}

export type PreferenceDecision = "accept" | "dismiss";

export interface PreferenceSuggestionsPanelProps {
  /** Undefined until read. */
  readonly suggestions: readonly PreferenceSuggestionView[] | undefined;
  readonly problem?: string | undefined;
  /** Resolves with a problem to show, or undefined once the decision is saved. */
  readonly onDecide: (id: string, decision: PreferenceDecision) => Promise<string | undefined>;
}

/** What accepting the suggestion adds to the writing policy, in plain words. */
export function preferenceSuggestionTitle(suggestion: PreferenceSuggestionView): string {
  return suggestion.kind === "forbidden-term"
    ? `Never use "${suggestion.term ?? ""}"`
    : `Order sections as ${(suggestion.sectionOrder ?? []).join(", ")}`;
}

export function PreferenceSuggestionsPanel({
  suggestions,
  problem,
  onDecide,
}: PreferenceSuggestionsPanelProps) {
  const id = useId();
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [decisionProblem, setDecisionProblem] = useState<string | undefined>(undefined);

  if (problem === undefined && (suggestions === undefined || suggestions.length === 0)) return null;

  async function decide(suggestionId: string, decision: PreferenceDecision) {
    setBusy(suggestionId);
    setDecisionProblem(await onDecide(suggestionId, decision));
    setBusy(undefined);
  }

  return (
    <section className="panel host-panel preference-suggestions" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Suggested preferences</h3>
      <p className="muted">
        DraftLoop noticed these patterns in your review choices. You decide: accepting one adds it
        to your writing policy for new runs.
      </p>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {decisionProblem === undefined ? null : (
        <p className="problem" role="alert">
          {decisionProblem}
        </p>
      )}
      <ul className="preference-suggestion-list">
        {(suggestions ?? []).map((suggestion) => (
          <li key={suggestion.id}>
            <p>
              <strong>{preferenceSuggestionTitle(suggestion)}</strong>
            </p>
            <p className="muted">{suggestion.reason}</p>
            <div className="preference-suggestion-actions">
              <button
                className="button"
                type="button"
                disabled={busy !== undefined}
                onClick={() => void decide(suggestion.id, "accept")}
              >
                Add to policy
              </button>
              <button
                className="button button-outline"
                type="button"
                disabled={busy !== undefined}
                onClick={() => void decide(suggestion.id, "dismiss")}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
