import { createHash } from "node:crypto";
import type { WritingPolicy } from "@draft-loop/domain";
import type { WorkspaceSettingsPort } from "@draft-loop/storage";

import { CliUserError } from "./cli-user-error.js";
import { defaultWritingPolicyContent } from "./default-writing-policy.js";
import type { ApplicationService } from "./index.js";
import { type StorageFactory, storageFactory } from "./local-storage-factory.js";
import { type ReviewSignals, readReviewSignals } from "./review-signals.js";
import { workspaceSettings } from "./workspace-settings.js";

/**
 * Preference suggestions (#2252): a deterministic pattern finder over review signals. Each
 * suggestion carries a reason the person can check. Accepting one writes a new writing-policy
 * version, which runs already pin and enforce; dismissing one records its identity so it is never
 * offered again. A suggestion is a preference, never a fact. No model is called.
 */

/** A pattern must recur this many times... */
export const minimumSuggestionOccurrences = 3;
/** ...across at least this many applications, so one job's quirks do not become a rule. */
export const minimumSuggestionApplications = 2;

export type PreferenceSuggestion =
  | {
      readonly id: string;
      readonly kind: "forbidden-term";
      readonly term: string;
      readonly occurrences: number;
      readonly applications: number;
      /** The runs whose review choices produced it (#2384): ids only, sorted. */
      readonly runIds: readonly string[];
      readonly reason: string;
    }
  | {
      readonly id: string;
      readonly kind: "section-order";
      readonly sectionOrder: readonly string[];
      readonly occurrences: number;
      readonly applications: number;
      /** The runs whose review choices produced it (#2384): ids only, sorted. */
      readonly runIds: readonly string[];
      readonly reason: string;
    };

export const preferenceSuggestionIdPattern = /^preference-[a-f0-9]{16}$/u;

function suggestionId(kind: string, value: string): string {
  const digest = createHash("sha256").update(`${kind}\u0000${value}`, "utf8").digest("hex");
  return `preference-${digest.slice(0, 16)}`;
}

const sortedIds = (ids: Iterable<string>) => [...new Set(ids)].sort();

function times(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function forbiddenTerms(policy: WritingPolicy | undefined): Set<string> {
  return new Set(
    (policy?.rules ?? []).flatMap((rule) =>
      rule.kind === "forbidden-term" ? [rule.term.toLocaleLowerCase()] : [],
    ),
  );
}

/** The suggestions the signals support that the policy does not already hold and were not dismissed. */
export function suggestPreferences(
  signals: ReviewSignals,
  policy: WritingPolicy | undefined,
  dismissed: ReadonlySet<string>,
): PreferenceSuggestion[] {
  const suggestions: PreferenceSuggestion[] = [];
  const forbidden = forbiddenTerms(policy);
  for (const signal of signals.deletedTerms) {
    const applications = signal.applicationIds.length;
    if (signal.count < minimumSuggestionOccurrences) continue;
    if (applications < minimumSuggestionApplications) continue;
    if (forbidden.has(signal.term)) continue;
    const id = suggestionId("forbidden-term", signal.term);
    if (dismissed.has(id)) continue;
    suggestions.push({
      id,
      kind: "forbidden-term",
      term: signal.term,
      occurrences: signal.count,
      applications,
      runIds: sortedIds(signal.runIds),
      reason: `You removed "${signal.term}" from ${times(signal.count, "draft")} across ${times(applications, "application")}.`,
    });
  }

  const orders = new Map<
    string,
    { order: readonly string[]; runs: number; apps: Set<string>; runIds: Set<string> }
  >();
  for (const signal of signals.sectionOrders) {
    if (signal.approved.length === 0) continue;
    const key = signal.approved.join("\n");
    const entry = orders.get(key) ?? {
      order: signal.approved,
      runs: 0,
      apps: new Set<string>(),
      runIds: new Set<string>(),
    };
    entry.runs += 1;
    entry.apps.add(signal.applicationId);
    entry.runIds.add(signal.runId);
    orders.set(key, entry);
  }
  const current = (policy?.preferences?.sectionOrder ?? []).join("\n");
  for (const [key, entry] of [...orders].sort((left, right) => right[1].runs - left[1].runs)) {
    if (entry.runs < minimumSuggestionOccurrences) continue;
    if (entry.apps.size < minimumSuggestionApplications) continue;
    if (key === current) continue;
    const id = suggestionId("section-order", key);
    if (dismissed.has(id)) continue;
    suggestions.push({
      id,
      kind: "section-order",
      sectionOrder: entry.order,
      occurrences: entry.runs,
      applications: entry.apps.size,
      runIds: sortedIds(entry.runIds),
      reason: `You approved ${times(entry.runs, "draft")} across ${times(entry.apps.size, "application")} with sections in this order: ${entry.order.join(", ")}.`,
    });
  }
  return suggestions;
}

const sectionOrderLine = /^\s*(?:[-*+]\s+)?Section\s+order\s*:.*$/imu;

/** The policy text with the suggestion added; the text is otherwise unchanged. */
export function applyPreferenceSuggestion(
  content: string,
  suggestion: PreferenceSuggestion,
): string {
  const base = content.endsWith("\n") ? content : `${content}\n`;
  if (suggestion.kind === "forbidden-term") return `${base}- Forbidden term: ${suggestion.term}\n`;
  const line = `Section order: ${suggestion.sectionOrder.join(", ")}`;
  return sectionOrderLine.test(base) ? base.replace(sectionOrderLine, line) : `${base}\n${line}\n`;
}

const dismissalsSetting = "preference-suggestions.json";

/** One accepted suggestion: the policy version it wrote and the runs it came from (#2384). */
export interface AcceptedPreferenceSource {
  readonly suggestionId: string;
  /** The writing-policy version the acceptance saved, by checksum. */
  readonly policyChecksum: string;
  readonly runIds: readonly string[];
  readonly acceptedAt: string;
}

interface SuggestionsDocument {
  readonly schemaVersion: 1;
  readonly dismissed: readonly string[];
  /** Absent in documents written before #2384. */
  readonly accepted?: readonly AcceptedPreferenceSource[];
}

const checksumPattern = /^[a-f0-9]{64}$/u;
const maximumAcceptedSources = 512;
const maximumSourceRuns = 256;

function validSource(value: unknown): value is AcceptedPreferenceSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Partial<AcceptedPreferenceSource>;
  return (
    typeof source.suggestionId === "string" &&
    preferenceSuggestionIdPattern.test(source.suggestionId) &&
    typeof source.policyChecksum === "string" &&
    checksumPattern.test(source.policyChecksum) &&
    typeof source.acceptedAt === "string" &&
    Array.isArray(source.runIds) &&
    source.runIds.length <= maximumSourceRuns &&
    source.runIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
  );
}

async function readDocument(
  settings: WorkspaceSettingsPort,
  root: string,
): Promise<{ dismissed: Set<string>; accepted: AcceptedPreferenceSource[] }> {
  const text = await settings.read(root, dismissalsSetting);
  if (text === undefined) return { dismissed: new Set(), accepted: [] };
  const parsed = JSON.parse(text) as Partial<SuggestionsDocument>;
  if (
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.dismissed) ||
    (parsed.accepted !== undefined && !Array.isArray(parsed.accepted))
  )
    throw new CliUserError("The preference suggestions setting is invalid.");
  return {
    dismissed: new Set(parsed.dismissed.filter((id) => preferenceSuggestionIdPattern.test(id))),
    accepted: (parsed.accepted ?? []).filter(validSource),
  };
}

async function writeDocument(
  settings: WorkspaceSettingsPort,
  root: string,
  dismissed: ReadonlySet<string>,
  accepted: readonly AcceptedPreferenceSource[],
): Promise<void> {
  const document: SuggestionsDocument = {
    schemaVersion: 1,
    dismissed: [...dismissed].sort(),
    ...(accepted.length === 0 ? {} : { accepted: accepted.slice(-maximumAcceptedSources) }),
  };
  await settings.write(root, dismissalsSetting, `${JSON.stringify(document, null, 2)}\n`);
}

async function readDismissed(settings: WorkspaceSettingsPort, root: string): Promise<Set<string>> {
  return (await readDocument(settings, root)).dismissed;
}

export interface PreferenceSuggestionsOptions {
  /** The workspace histories; the local SQLite files when unset. */
  readonly storage?: StorageFactory;
  /** The workspace settings; the local `.draft-loop` files when unset. */
  readonly settings?: WorkspaceSettingsPort;
  readonly service: Pick<
    ApplicationService,
    "readWorkspace" | "getWritingPolicy" | "configureWritingPolicy"
  >;
  /** The clock that dates an acceptance; the system clock when unset. */
  readonly now?: () => Date;
}

export interface PreferenceSuggestions {
  readonly list: (root: string) => Promise<readonly PreferenceSuggestion[]>;
  /** Writes a new writing-policy version holding the suggestion; resolves with what was added. */
  readonly accept: (root: string, id: string) => Promise<PreferenceSuggestion>;
  readonly dismiss: (root: string, id: string) => Promise<void>;
  /**
   * The accepted suggestions and the runs each came from, oldest first (#2384). A version the
   * person wrote by hand has no entry.
   */
  readonly sources: (root: string) => Promise<readonly AcceptedPreferenceSource[]>;
}

export function createPreferenceSuggestions(
  options: PreferenceSuggestionsOptions,
): PreferenceSuggestions {
  const { service } = options;
  const storage = () => options.storage ?? storageFactory();
  const settings = () => options.settings ?? workspaceSettings();

  const readPolicy = async (root: string) =>
    (await service.getWritingPolicy?.({ root, includeContent: true }))?.policy;

  const list = async (root: string) => {
    const workspace = await service.readWorkspace(root);
    const history = await storage().open(root);
    let signals: ReviewSignals;
    try {
      signals = await readReviewSignals(
        {
          listRuns: (id) => history.listRuns(id),
          listFindings: (runId) => history.listFindings(runId),
          listDecisions: (runId) => history.listDecisions(runId),
          getArtifactVersion: (id) => history.getArtifactVersion(id),
          applicationIdForRun: (id, runId) => history.applications.applicationIdForRun(id, runId),
        },
        workspace.id,
      );
    } finally {
      await history.close();
    }
    return suggestPreferences(
      signals,
      await readPolicy(root),
      await readDismissed(settings(), root),
    );
  };

  const find = async (root: string, id: string) => {
    const suggestion = (await list(root)).find((candidate) => candidate.id === id);
    if (suggestion === undefined)
      throw new CliUserError(`No preference suggestion ${id} is waiting for a decision.`);
    return suggestion;
  };

  return {
    list,
    accept: async (root, id) => {
      const suggestion = await find(root, id);
      const content = (await readPolicy(root))?.content ?? defaultWritingPolicyContent;
      const descriptor = await service.configureWritingPolicy({
        root,
        content: applyPreferenceSuggestion(content, suggestion),
      });
      const policyChecksum =
        descriptor.activeWritingPolicy?.checksum ?? descriptor.writingPolicyChecksum;
      if (policyChecksum !== undefined && checksumPattern.test(policyChecksum)) {
        const { dismissed, accepted } = await readDocument(settings(), root);
        await writeDocument(settings(), root, dismissed, [
          ...accepted,
          {
            suggestionId: suggestion.id,
            policyChecksum,
            runIds: suggestion.runIds.slice(0, maximumSourceRuns),
            acceptedAt: (options.now ?? (() => new Date()))().toISOString(),
          },
        ]);
      }
      return suggestion;
    },
    dismiss: async (root, id) => {
      await find(root, id);
      const { dismissed, accepted } = await readDocument(settings(), root);
      dismissed.add(id);
      await writeDocument(settings(), root, dismissed, accepted);
    },
    sources: async (root) => (await readDocument(settings(), root)).accepted,
  };
}
