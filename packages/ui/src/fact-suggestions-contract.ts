/**
 * Bridge contract for suggested career profile updates (#3069): list a profile's pending
 * suggestions, accept a batch (each as filed or as the person edited it) and reject one. Hosts
 * without them leave these capabilities out, and the profile then shows no Suggested updates box.
 */

import type { CanonicalCandidateProfileFactCategory } from "@draft-loop/domain";
import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import {
  type FactSuggestionChange,
  type FactSuggestionKind,
  type FactSuggestionOriginKind,
  type FactSuggestionSpeaker,
  type FactSuggestionStatus,
  factSuggestionKinds,
  factSuggestionLimits,
  factSuggestionOriginKinds,
  factSuggestionSpeakers,
  factSuggestionStatuses,
  maximumFactSuggestionBatch,
} from "@draft-loop/domain/fact-suggestion";
import { factUsageKeyPattern, isFactUsageLevel } from "@draft-loop/domain/fact-usage";

export interface FactSuggestionView {
  readonly id: string;
  readonly profileId: string;
  readonly change: FactSuggestionChange;
  readonly target?: { readonly factId: string; readonly factKey: string } | undefined;
  readonly quote: string;
  readonly speaker: FactSuggestionSpeaker;
  readonly origin: {
    readonly kind: FactSuggestionOriginKind;
    readonly applicationId?: string | undefined;
    readonly round?: number | undefined;
  };
  readonly status: FactSuggestionStatus;
  readonly createdAt: string;
}

export interface FactSuggestionListInput {
  readonly workspaceId: string;
  readonly profileId: string;
}

export interface FactSuggestionListResult {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly suggestions: readonly FactSuggestionView[];
  /** Pending suggestions of the profile. */
  readonly pending: number;
}

export interface FactSuggestionAcceptItem {
  readonly id: string;
  /** The change as the person edited it; it keeps the suggestion's kind. */
  readonly edit?: FactSuggestionChange | undefined;
}

export interface FactSuggestionAcceptInput {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly items: readonly FactSuggestionAcceptItem[];
}

export interface FactSuggestionAcceptResult {
  readonly applied: readonly string[];
  /** Suggestions whose fact changed first; they were not applied. */
  readonly stale: readonly string[];
  /** The saved profile version, when an accepted change touched its facts. */
  readonly profile?:
    | { readonly version: number; readonly status: "draft" | "reviewed" }
    | undefined;
}

export interface FactSuggestionRejectInput {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly suggestionId: string;
}

export interface FactSuggestionRejectResult {
  readonly suggestionId: string;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
const suggestionIdPattern = /^fsg_[A-Za-z0-9_-]{8,64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const maximumListed = 200;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function onlyKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function suggestionId(value: unknown): string | undefined {
  return typeof value === "string" && suggestionIdPattern.test(value) ? value : undefined;
}

function oneOf<Value extends string>(values: readonly Value[], value: unknown): Value | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as Value)
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : undefined;
}

/** A change as filed or edited; undefined when its shape or values do not fit its kind. */
export function normalizeFactSuggestionChange(value: unknown): FactSuggestionChange | undefined {
  const raw = record(value);
  const kind = oneOf<FactSuggestionKind>(factSuggestionKinds, raw?.kind);
  if (raw === undefined || kind === undefined) return undefined;
  switch (kind) {
    case "add": {
      if (!onlyKeys(raw, ["kind", "category", "subjectId", "field", "value"])) return undefined;
      const category = oneOf<CanonicalCandidateProfileFactCategory>(
        canonicalCandidateProfileFactCategories,
        raw.category,
      );
      const field = text(raw.field, factSuggestionLimits.fieldMax);
      const fact = text(raw.value, factSuggestionLimits.valueMax);
      const subjectId =
        raw.subjectId === undefined ? undefined : text(raw.subjectId, factSuggestionLimits.idMax);
      if (category === undefined || field === undefined || fact === undefined) return undefined;
      if (raw.subjectId !== undefined && subjectId === undefined) return undefined;
      return {
        kind,
        category,
        field,
        value: fact,
        ...(subjectId === undefined ? {} : { subjectId }),
      };
    }
    case "correct": {
      const fact = text(raw.value, factSuggestionLimits.valueMax);
      return onlyKeys(raw, ["kind", "value"]) && fact !== undefined
        ? { kind, value: fact }
        : undefined;
    }
    case "set-usage":
      return onlyKeys(raw, ["kind", "usage"]) && isFactUsageLevel(raw.usage)
        ? { kind, usage: raw.usage }
        : undefined;
    case "retire":
    case "confirm":
      return onlyKeys(raw, ["kind"]) ? { kind } : undefined;
  }
}

function normalizeTarget(value: unknown): FactSuggestionView["target"] | null {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["factId", "factKey"])) return null;
  const factId = text(raw.factId, factSuggestionLimits.idMax);
  if (factId === undefined || typeof raw.factKey !== "string") return null;
  return factUsageKeyPattern.test(raw.factKey) ? { factId, factKey: raw.factKey } : null;
}

function normalizeOrigin(value: unknown): FactSuggestionView["origin"] | undefined {
  const raw = record(value);
  const kind = oneOf<FactSuggestionOriginKind>(factSuggestionOriginKinds, raw?.kind);
  if (raw === undefined || kind === undefined) return undefined;
  const applicationId =
    raw.applicationId === undefined
      ? undefined
      : text(raw.applicationId, factSuggestionLimits.idMax);
  const round =
    typeof raw.round === "number" && Number.isSafeInteger(raw.round) && raw.round >= 1
      ? raw.round
      : undefined;
  // Only what the card shows crosses; run, block, agent and interview ids stay on the server.
  return {
    kind,
    ...(applicationId === undefined ? {} : { applicationId }),
    ...(round === undefined ? {} : { round }),
  };
}

export function normalizeFactSuggestionView(value: unknown): FactSuggestionView | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const id = suggestionId(raw.id);
  const profileId = identifier(raw.profileId);
  const change = normalizeFactSuggestionChange(raw.change);
  const target = normalizeTarget(raw.target);
  const quote = text(raw.quote, factSuggestionLimits.quoteMax);
  const speaker = oneOf<FactSuggestionSpeaker>(factSuggestionSpeakers, raw.speaker);
  const origin = normalizeOrigin(raw.origin);
  const status = oneOf<FactSuggestionStatus>(factSuggestionStatuses, raw.status);
  const createdAt =
    typeof raw.createdAt === "string" && timestampPattern.test(raw.createdAt)
      ? raw.createdAt
      : undefined;
  if (
    id === undefined ||
    profileId === undefined ||
    change === undefined ||
    target === null ||
    quote === undefined ||
    speaker === undefined ||
    origin === undefined ||
    status === undefined ||
    createdAt === undefined
  ) {
    return undefined;
  }
  return {
    id,
    profileId,
    change,
    ...(target === undefined ? {} : { target }),
    quote,
    speaker,
    origin,
    status,
    createdAt,
  };
}

export function validateFactSuggestionListInput(
  value: unknown,
): FactSuggestionListInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "profileId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const profileId = identifier(raw.profileId);
  return workspaceId === undefined || profileId === undefined
    ? undefined
    : { workspaceId, profileId };
}

export function normalizeFactSuggestionListResult(
  value: unknown,
): FactSuggestionListResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "profileId", "suggestions", "pending"])) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const profileId = identifier(raw.profileId);
  if (
    workspaceId === undefined ||
    profileId === undefined ||
    !Array.isArray(raw.suggestions) ||
    raw.suggestions.length > maximumListed ||
    typeof raw.pending !== "number" ||
    !Number.isSafeInteger(raw.pending) ||
    raw.pending < 0
  ) {
    return undefined;
  }
  const suggestions: FactSuggestionView[] = [];
  for (const entry of raw.suggestions) {
    const suggestion = normalizeFactSuggestionView(entry);
    if (suggestion === undefined) return undefined;
    suggestions.push(suggestion);
  }
  return { workspaceId, profileId, suggestions, pending: raw.pending };
}

export function validateFactSuggestionAcceptInput(
  value: unknown,
): FactSuggestionAcceptInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "profileId", "items"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const profileId = identifier(raw.profileId);
  if (
    workspaceId === undefined ||
    profileId === undefined ||
    !Array.isArray(raw.items) ||
    raw.items.length < 1 ||
    raw.items.length > maximumFactSuggestionBatch
  ) {
    return undefined;
  }
  const items: FactSuggestionAcceptItem[] = [];
  for (const entry of raw.items) {
    const item = record(entry);
    if (item === undefined || !onlyKeys(item, ["id", "edit"])) return undefined;
    const id = suggestionId(item.id);
    const edit = item.edit === undefined ? undefined : normalizeFactSuggestionChange(item.edit);
    if (id === undefined || (item.edit !== undefined && edit === undefined)) return undefined;
    items.push(edit === undefined ? { id } : { id, edit });
  }
  return { workspaceId, profileId, items };
}

function idList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumFactSuggestionBatch) return undefined;
  const ids = value.map(suggestionId);
  return ids.every((id) => id !== undefined) ? (ids as string[]) : undefined;
}

export function normalizeFactSuggestionAcceptResult(
  value: unknown,
): FactSuggestionAcceptResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["applied", "stale", "profile"])) return undefined;
  const applied = idList(raw.applied);
  const stale = idList(raw.stale);
  if (applied === undefined || stale === undefined) return undefined;
  if (raw.profile === undefined) return { applied, stale };
  const profile = record(raw.profile);
  if (
    profile === undefined ||
    !onlyKeys(profile, ["version", "status"]) ||
    typeof profile.version !== "number" ||
    !Number.isSafeInteger(profile.version) ||
    profile.version < 1 ||
    (profile.status !== "draft" && profile.status !== "reviewed")
  ) {
    return undefined;
  }
  return { applied, stale, profile: { version: profile.version, status: profile.status } };
}

export function validateFactSuggestionRejectInput(
  value: unknown,
): FactSuggestionRejectInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "profileId", "suggestionId"])) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const profileId = identifier(raw.profileId);
  const id = suggestionId(raw.suggestionId);
  return workspaceId === undefined || profileId === undefined || id === undefined
    ? undefined
    : { workspaceId, profileId, suggestionId: id };
}

export function normalizeFactSuggestionRejectResult(
  value: unknown,
): FactSuggestionRejectResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["suggestionId"])) return undefined;
  const id = suggestionId(raw.suggestionId);
  return id === undefined ? undefined : { suggestionId: id };
}
