import { t } from "@lingui/core/macro";
/**
 * The Suggested updates box on the career profile (#3069): one card per pending suggestion, with
 * the fact before and after, the quote, who said it and where it came from. The person accepts,
 * edits and accepts, or rejects each one; nothing changes the profile until they do. The box shows
 * nothing while there is nothing to decide.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { CanonicalCandidateProfileFactResult } from "./bridge.js";
import type { FactSuggestionCapabilities } from "./fact-suggestions-capabilities.js";
import type { FactSuggestionAcceptItem, FactSuggestionView } from "./fact-suggestions-contract.js";
import {
  acceptOutcomeMessage,
  editedChange,
  type FactSuggestionCardView,
  factSuggestionCard,
} from "./profile-fact-suggestions-model.js";

export interface ProfileFactSuggestionsState {
  /** Undefined until read, and always without the capability. */
  readonly suggestions: readonly FactSuggestionView[] | undefined;
  readonly pending: number;
  readonly problem: string | undefined;
  readonly message: string | undefined;
  readonly busy: boolean;
  readonly accept: (items: readonly FactSuggestionAcceptItem[]) => void;
  readonly reject: (suggestionId: string) => void;
}

/**
 * Reads the profile's pending suggestions and decides them. `onProfileSaved` runs when an accept
 * saved a new profile version, so the page can show it.
 */
export function useProfileFactSuggestions(
  workspaceId: string,
  profileId: string | null,
  capabilities: FactSuggestionCapabilities | undefined,
  onProfileSaved: () => void,
): ProfileFactSuggestionsState {
  const scope = profileId === null ? null : `${workspaceId}/${profileId}`;
  const [listed, setListed] = useState<{
    readonly scope: string;
    readonly suggestions: readonly FactSuggestionView[];
    readonly pending: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (capabilities === undefined || profileId === null || epoch < 0) return;
    let current = true;
    const listedScope = `${workspaceId}/${profileId}`;
    capabilities.listFactSuggestions(workspaceId, profileId).then(
      (result) => {
        if (!current) return;
        setListed({
          scope: listedScope,
          suggestions: result.suggestions.filter((entry) => entry.status === "pending"),
          pending: result.pending,
        });
      },
      () => {
        if (current) setProblem(t`Suggested updates could not be loaded.`);
      },
    );
    return () => {
      current = false;
    };
  }, [capabilities, workspaceId, profileId, epoch]);

  // A list read for another profile is never shown.
  const shown = listed !== null && listed.scope === scope ? listed : null;
  const suggestions = shown?.suggestions;
  const pending = shown?.pending ?? 0;

  const accept = useCallback(
    (items: readonly FactSuggestionAcceptItem[]) => {
      if (capabilities === undefined || profileId === null || items.length === 0) return;
      setBusy(true);
      setProblem(undefined);
      setMessage(undefined);
      capabilities
        .acceptFactSuggestions(workspaceId, profileId, items)
        .then(
          (result) => {
            setMessage(acceptOutcomeMessage(result.applied.length, result.stale.length));
            if (result.profile !== undefined) onProfileSaved();
          },
          () => setProblem(t`The suggestion was not accepted. Nothing changed. Try again.`),
        )
        .finally(() => {
          setBusy(false);
          setEpoch((value) => value + 1);
        });
    },
    [capabilities, workspaceId, profileId, onProfileSaved],
  );

  const reject = useCallback(
    (suggestionId: string) => {
      if (capabilities === undefined || profileId === null) return;
      setBusy(true);
      setProblem(undefined);
      setMessage(undefined);
      capabilities
        .rejectFactSuggestion(workspaceId, profileId, suggestionId)
        .then(
          () => setMessage(t`Rejected. DraftLoop will not suggest that change again.`),
          () => setProblem(t`The suggestion was not rejected. Try again.`),
        )
        .finally(() => {
          setBusy(false);
          setEpoch((value) => value + 1);
        });
    },
    [capabilities, workspaceId, profileId],
  );

  return { suggestions, pending, problem, message, busy, accept, reject };
}

function SuggestionCard({
  card,
  suggestion,
  busy,
  disabled,
  onAccept,
  onReject,
}: {
  readonly card: FactSuggestionCardView;
  readonly suggestion: FactSuggestionView;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onAccept: (item: FactSuggestionAcceptItem) => void;
  readonly onReject: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.editableValue ?? "");
  const blocked = busy || disabled;

  return (
    <li className="fact-suggestion" aria-labelledby={`${id}-title`}>
      <p className="fact-suggestion-title" id={`${id}-title`}>
        <strong>{card.title}</strong>
      </p>
      <dl className="fact-suggestion-change">
        <dt>{t`Now`}</dt>
        <dd>{card.before}</dd>
        <dt>{t`Suggested`}</dt>
        <dd>{card.after}</dd>
      </dl>
      <figure className="fact-suggestion-quote">
        <blockquote>{card.quote}</blockquote>
        <figcaption>
          {card.speaker} · {card.origin}
        </figcaption>
      </figure>
      {editing && card.editableValue !== undefined ? (
        <form
          className="fact-suggestion-edit"
          onSubmit={(event) => {
            event.preventDefault();
            const edit = editedChange(suggestion, value);
            onAccept(edit === undefined ? { id: suggestion.id } : { id: suggestion.id, edit });
          }}
        >
          <label htmlFor={`${id}-value`}>{t`Value to save`}</label>
          <textarea
            id={`${id}-value`}
            value={value}
            rows={2}
            maxLength={2000}
            required
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="fact-suggestion-actions">
            <button className="button" type="submit" disabled={blocked || value.trim() === ""}>
              {t`Save and accept`}
            </button>
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setValue(card.editableValue ?? "");
              }}
            >
              {t`Cancel`}
            </button>
          </div>
        </form>
      ) : (
        <div className="fact-suggestion-actions">
          <button
            className="button"
            type="button"
            disabled={blocked}
            onClick={() => onAccept({ id: suggestion.id })}
          >
            {t`Accept`}
          </button>
          {card.editableValue === undefined ? null : (
            <button
              className="button button-outline"
              type="button"
              disabled={blocked}
              onClick={() => setEditing(true)}
            >
              {t`Edit and accept`}
            </button>
          )}
          <button
            className="button button-outline"
            type="button"
            disabled={blocked}
            onClick={onReject}
          >
            {t`Reject`}
          </button>
        </div>
      )}
    </li>
  );
}

export interface ProfileFactSuggestionsProps {
  readonly state: ProfileFactSuggestionsState;
  /** The facts of the version on screen, for each card's "Now" line. */
  readonly facts: readonly CanonicalCandidateProfileFactResult[];
  /** True while the page has unsaved edits or is busy: deciding would save a new version. */
  readonly disabled?: boolean;
  readonly locale?: string;
}

export function ProfileFactSuggestions({
  state,
  facts,
  disabled = false,
  locale,
}: ProfileFactSuggestionsProps) {
  const id = useId();
  const suggestions = state.suggestions ?? [];
  if (suggestions.length === 0 && state.problem === undefined && state.message === undefined) {
    return null;
  }
  return (
    <section className="profile-suggestions" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>
        {t`Suggested updates`}
        {suggestions.length === 0 ? null : (
          <span className="profile-suggestions-count">{` (${suggestions.length})`}</span>
        )}
      </h3>
      {suggestions.length === 0 ? null : (
        <p className="muted">{t`DraftLoop noticed these from what was said. Nothing changes your profile until you accept it, and accepting counts as reviewing that change.`}</p>
      )}
      {state.problem === undefined ? null : (
        <p className="problem" role="alert">
          {state.problem}
        </p>
      )}
      <p className="profile-suggestions-message" role="status" aria-live="polite">
        {state.message ?? ""}
      </p>
      {disabled && suggestions.length > 0 ? (
        <p className="muted">{t`Save or discard your edits first; accepting saves a new version.`}</p>
      ) : null}
      {suggestions.length === 0 ? null : (
        <ul className="fact-suggestion-list">
          {suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              card={factSuggestionCard(suggestion, facts, locale)}
              suggestion={suggestion}
              busy={state.busy}
              disabled={disabled}
              onAccept={(item) => state.accept([item])}
              onReject={() => state.reject(suggestion.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The pending count for Home's career card; zero without the capability, before the read, or
 * when it fails, so the card then shows nothing.
 */
export function usePendingFactSuggestionCount(
  capabilities: FactSuggestionCapabilities | undefined,
  workspaceId: string,
  profileId: string | undefined,
): number {
  const [read, setRead] = useState<{ readonly scope: string; readonly pending: number } | null>(
    null,
  );
  const scope = profileId === undefined ? null : `${workspaceId}/${profileId}`;
  useEffect(() => {
    if (capabilities === undefined || profileId === undefined) return;
    let active = true;
    const readScope = `${workspaceId}/${profileId}`;
    capabilities.listFactSuggestions(workspaceId, profileId).then(
      (result) => {
        if (active) setRead({ scope: readScope, pending: result.pending });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [capabilities, workspaceId, profileId]);
  return read !== null && read.scope === scope ? read.pending : 0;
}

/** One line on Home's career card: how many suggested updates wait, with a link to them. */
export function ProfileSuggestionsNote({
  count,
  onAction,
}: {
  readonly count: number;
  readonly onAction: () => void;
}) {
  return (
    <div className="home-freshness home-freshness-attention">
      <p className="home-freshness-text">
        {count === 1
          ? t`1 suggested profile update waits for you.`
          : t`${count} suggested profile updates wait for you.`}
      </p>
      <button
        className="button button-quiet home-freshness-action"
        type="button"
        onClick={onAction}
      >
        {t`Review`}
      </button>
    </div>
  );
}
