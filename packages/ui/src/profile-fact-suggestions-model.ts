import { t } from "@lingui/core/macro";
/**
 * What a Suggested updates card shows (#3069): the change's before and after, who said the quote
 * and where it came from. Pure functions, so the card's wording is tested without rendering.
 */

import {
  type FactSuggestionKind,
  findFactSuggestionTarget,
} from "@draft-loop/domain/fact-suggestion";
import type { CanonicalCandidateProfileFactResult } from "./bridge.js";
import type { FactSuggestionView } from "./fact-suggestions-contract.js";
import { formatDate } from "./locale-format.js";
import { factUsageLevelLabels } from "./profile-fact-usage.js";
import { humanizeProfileCategory, humanizeProfileFieldLabel } from "./profile-presentation.js";

export interface FactSuggestionCardView {
  readonly id: string;
  readonly title: string;
  /** The fact as it stands, or a note when there is none yet. */
  readonly before: string;
  readonly after: string;
  readonly quote: string;
  readonly speaker: string;
  readonly origin: string;
  /** Only `add` and `correct` carry a value the person can edit before accepting. */
  readonly editableValue?: string | undefined;
}

export const factSuggestionKindTitles = (): Readonly<Record<FactSuggestionKind, string>> => ({
  add: t`Add a fact`,
  correct: t`Correct a fact`,
  retire: t`Remove a fact that no longer holds`,
  "set-usage": t`Change where a fact may be used`,
  confirm: t`Confirm a fact`,
});

function speakerLabel(speaker: FactSuggestionView["speaker"]): string {
  switch (speaker) {
    case "candidate":
      return t`You said`;
    case "coach":
      return t`Your coach said`;
    case "agent":
      return t`An agent said`;
    case "system":
      return t`Redakloop noticed`;
  }
}

function originLabel(origin: FactSuggestionView["origin"]): string {
  switch (origin.kind) {
    case "review-edit":
      return origin.round === undefined
        ? t`Your edit while reviewing an application`
        : t`Your edit in review round ${origin.round} of an application`;
    case "critic-question":
      return t`A question from the critic on an application`;
    case "unconfirmed-fact":
      return t`A fact you have not confirmed yet`;
    case "agent":
      return t`An agent you connected`;
    case "career-interview":
      return t`Your career interview`;
  }
}

function dayLabel(timestamp: string, locale: string | undefined): string {
  return formatDate(timestamp, locale === undefined ? {} : { locale }) ?? "";
}

function factLabel(fact: Pick<CanonicalCandidateProfileFactResult, "field" | "value">): string {
  return `${humanizeProfileFieldLabel(fact.field)}: ${fact.value}`;
}

/** The current fact a targeted suggestion changes, matched by content as the server does. */
export function currentFactOf(
  suggestion: FactSuggestionView,
  facts: readonly CanonicalCandidateProfileFactResult[],
): CanonicalCandidateProfileFactResult | undefined {
  if (suggestion.target === undefined) return undefined;
  const found = findFactSuggestionTarget(
    suggestion.target,
    facts as Parameters<typeof findFactSuggestionTarget>[1],
  );
  return found === undefined ? undefined : facts.find((fact) => fact.id === found.id);
}

export function factSuggestionCard(
  suggestion: FactSuggestionView,
  facts: readonly CanonicalCandidateProfileFactResult[],
  locale?: string,
): FactSuggestionCardView {
  const current = currentFactOf(suggestion, facts);
  const missing = t`Not in your profile now`;
  const before = current === undefined ? missing : factLabel(current);
  const { change } = suggestion;
  let after: string;
  let editableValue: string | undefined;
  switch (change.kind) {
    case "add":
      after = `${humanizeProfileCategory(change.category)} · ${factLabel(change)}`;
      editableValue = change.value;
      break;
    case "correct":
      after =
        current === undefined
          ? change.value
          : factLabel({ field: current.field, value: change.value });
      editableValue = change.value;
      break;
    case "retire":
      after = t`Removed from your profile`;
      break;
    case "set-usage":
      after = t`Usage: ${factUsageLevelLabels()[change.usage]}`;
      break;
    case "confirm":
      after = t`Confirmed as true, citing the quote`;
      break;
  }
  const day = dayLabel(suggestion.createdAt, locale);
  const where = originLabel(suggestion.origin);
  return {
    id: suggestion.id,
    title: factSuggestionKindTitles()[change.kind],
    before: change.kind === "add" ? missing : before,
    after,
    quote: suggestion.quote,
    speaker: speakerLabel(suggestion.speaker),
    origin: day === "" ? where : t`${where}, ${day}`,
    ...(editableValue === undefined ? {} : { editableValue }),
  };
}

/** The edit to send for a card whose value the person changed; undefined keeps the change. */
export function editedChange(
  suggestion: FactSuggestionView,
  value: string,
): FactSuggestionView["change"] | undefined {
  const trimmed = value.trim();
  const { change } = suggestion;
  if (change.kind !== "add" && change.kind !== "correct") return undefined;
  if (trimmed === "" || trimmed === change.value) return undefined;
  return { ...change, value: trimmed };
}

/** The line shown after an accept, by how many applied and how many had gone stale. */
export function acceptOutcomeMessage(applied: number, stale: number): string {
  if (stale === 0) {
    return applied === 1
      ? t`Accepted. Your profile now holds the change.`
      : t`Accepted ${applied} suggestions. Your profile now holds the changes.`;
  }
  if (applied === 0) {
    return stale === 1
      ? t`That fact changed first, so the suggestion no longer applies.`
      : t`Those facts changed first, so the suggestions no longer apply.`;
  }
  return t`Accepted ${applied}. ${stale} no longer applied because the fact changed first.`;
}
