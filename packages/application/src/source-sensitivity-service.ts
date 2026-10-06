import { randomUUID } from "node:crypto";
import {
  classifySourceSections,
  defaultSourceSensitivityRuleSuggestions,
  normalizeHeadingText,
  type SourceSensitivityRule,
  type SourceSensitivityRuleMatch,
  type SourceSensitivityTier,
  sourceSensitivityTiers,
} from "@draft-loop/domain/source-sensitivity";
import { ingestBytes as defaultIngestBytes } from "@draft-loop/ingestion";
import { sourceSensitivityRuleListSchema } from "@draft-loop/schemas/source-sensitivity";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore as defaultOpenCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { CliUserError } from "./cli-user-error.js";

/**
 * Reads and edits a knowledge base's sensitivity rules and previews how a
 * source version's sections are classified. Rules are stored as immutable
 * versions; every edit appends a new version. Nothing here sends source text
 * anywhere, and previews omit section text unless `includeText` is set.
 *
 * Enforcement in provider requests is not part of this service. To honour the
 * rules, a request builder calls `listSensitivityRules` for the current rules
 * (or the storage port's `getCandidateKnowledgeSourceSensitivityRules`) and
 * classifies each source's normalized text with `classifySourceSections`.
 */

export type {
  SourceSensitivityRule,
  SourceSensitivityRuleMatch,
  SourceSensitivityTier,
} from "@draft-loop/domain/source-sensitivity";
export { sourceSensitivityTiers } from "@draft-loop/domain/source-sensitivity";

export interface SourceSensitivityRulesView {
  readonly knowledgeBaseId: string;
  /** Current rule-list version; 0 when the knowledge base has never had rules saved. */
  readonly version: number;
  readonly checksum: string | null;
  readonly createdAt: string | null;
  readonly rules: readonly SourceSensitivityRule[];
}

export interface SourceSensitivityRuleInput {
  readonly tier: SourceSensitivityTier;
  readonly match: SourceSensitivityRuleMatch;
}

export interface SourceSensitivityAdoptionResult extends SourceSensitivityRulesView {
  /** Suggestion ids that were added as rules. */
  readonly adopted: readonly string[];
  /** Suggestion ids skipped because an equivalent rule (or the same id) already exists. */
  readonly skipped: readonly string[];
}

export interface SourceSensitivitySectionPreview {
  readonly index: number;
  readonly headingPath: readonly string[];
  /** Heading level 1-6, or 0 for text before the first heading and for non-Markdown sources. */
  readonly level: number;
  readonly tier: SourceSensitivityTier;
  readonly matchedRuleIds: readonly string[];
  readonly characterCount: number;
  /** Present only when the caller asked for text. */
  readonly text?: string;
}

export interface SourceSensitivityPreview {
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly mediaType: string;
  /** The rule-list version the classification used; 0 when there are no rules. */
  readonly rulesVersion: number;
  /**
   * False for sources that are not Markdown. They are not split by headings, so
   * they appear as one root section that no rule can match.
   */
  readonly sectionedByHeadings: boolean;
  readonly sections: readonly SourceSensitivitySectionPreview[];
}

interface StoreCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export interface AddSourceSensitivityRuleCommand extends StoreCommand {
  readonly rule: SourceSensitivityRuleInput;
  /** Optional safe identifier; generated when absent. */
  readonly id?: string;
}

export interface RemoveSourceSensitivityRuleCommand extends StoreCommand {
  readonly ruleId: string;
}

export interface AdoptSourceSensitivitySuggestionsCommand extends StoreCommand {
  readonly suggestionIds: readonly string[];
}

export interface PreviewSourceSensitivityCommand extends StoreCommand {
  readonly sourceId: string;
  /** Defaults to the source's latest version. */
  readonly versionId?: string;
  /** Opt in to returning each section's text. */
  readonly includeText?: boolean;
}

export interface SourceSensitivityService {
  readonly listSensitivityRules: (command: StoreCommand) => Promise<SourceSensitivityRulesView>;
  readonly addSensitivityRule: (
    command: AddSourceSensitivityRuleCommand,
  ) => Promise<SourceSensitivityRulesView>;
  readonly removeSensitivityRule: (
    command: RemoveSourceSensitivityRuleCommand,
  ) => Promise<SourceSensitivityRulesView>;
  /** Adds chosen default suggestions; the caller must have shown them and obtained confirmation. */
  readonly adoptSensitivitySuggestions: (
    command: AdoptSourceSensitivitySuggestionsCommand,
  ) => Promise<SourceSensitivityAdoptionResult>;
  readonly listSensitivitySuggestions: () => readonly SourceSensitivityRule[];
  readonly previewSourceSensitivity: (
    command: PreviewSourceSensitivityCommand,
  ) => Promise<SourceSensitivityPreview>;
}

export interface SourceSensitivityServiceDependencies {
  readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes?: typeof defaultIngestBytes;
  readonly now?: () => string;
  readonly generateId?: () => string;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliUserError(`${label} is required.`);
  }
  return value.trim();
}

function matchKey(match: SourceSensitivityRuleMatch): string {
  return match.kind === "heading-contains"
    ? JSON.stringify(["heading-contains", normalizeHeadingText(match.text)])
    : JSON.stringify(["heading-path", match.path.map(normalizeHeadingText)]);
}

function ruleKey(rule: {
  readonly tier: SourceSensitivityTier;
  readonly match: SourceSensitivityRuleMatch;
}): string {
  return JSON.stringify([rule.tier, matchKey(rule.match)]);
}

function describeMatch(match: SourceSensitivityRuleMatch): string {
  return match.kind === "heading-contains"
    ? `heading contains "${match.text}"`
    : `heading path ${match.path.join(" > ")}`;
}

function validatedRules(rules: readonly SourceSensitivityRule[]): SourceSensitivityRule[] {
  const parsed = sourceSensitivityRuleListSchema.safeParse({ rules });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.filter((part) => typeof part !== "number").join(".") ?? "";
    throw new CliUserError(
      `The sensitivity rules are not valid${where === "" ? "" : ` (${where})`}: ${issue?.message ?? "invalid"}.`,
    );
  }
  return [...parsed.data.rules];
}

async function useHandle<T>(
  acquire: () => Promise<CandidateKnowledgeStoreHandle>,
  operation: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
): Promise<T> {
  const handle = await acquire();
  try {
    return await operation(handle);
  } finally {
    try {
      await handle.close();
    } catch {
      // The operation outcome is more useful than a close failure.
    }
  }
}

async function requireKnowledgeBase(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
): Promise<void> {
  if ((await handle.getCandidateKnowledgeBase(knowledgeBaseId)) === undefined) {
    throw new CliUserError(`Knowledge base ${knowledgeBaseId} was not found in this store.`);
  }
}

export function createSourceSensitivityService(
  dependencies: SourceSensitivityServiceDependencies = {},
): SourceSensitivityService {
  const open = dependencies.open ?? defaultOpenCandidateKnowledgeStore;
  const ingestBytes = dependencies.ingestBytes ?? defaultIngestBytes;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateId = dependencies.generateId ?? (() => `rule-${randomUUID().slice(0, 8)}`);

  const readView = async (
    handle: CandidateKnowledgeStoreHandle,
    knowledgeBaseId: string,
  ): Promise<SourceSensitivityRulesView> => {
    await requireKnowledgeBase(handle, knowledgeBaseId);
    const current = await handle.getCandidateKnowledgeSourceSensitivityRules(knowledgeBaseId);
    return current === undefined
      ? { knowledgeBaseId, version: 0, checksum: null, createdAt: null, rules: [] }
      : {
          knowledgeBaseId,
          version: current.version,
          checksum: current.checksum,
          createdAt: current.createdAt,
          rules: current.rules,
        };
  };

  /** Saves a new rule-list version inside the store's writer lease so concurrent edits cannot lose rules. */
  const edit = <T extends SourceSensitivityRulesView>(
    command: StoreCommand,
    change: (current: SourceSensitivityRulesView) => {
      readonly rules: readonly SourceSensitivityRule[];
      readonly extra: Omit<T, keyof SourceSensitivityRulesView>;
      readonly unchanged?: boolean;
    },
  ): Promise<T> => {
    const storeRoot = requireText(command.storeRoot, "The knowledge store root");
    const knowledgeBaseId = requireText(command.knowledgeBaseId, "The knowledge base id");
    return useHandle(
      () => open(storeRoot),
      async (handle) => {
        const run = async (): Promise<T> => {
          const current = await readView(handle, knowledgeBaseId);
          const outcome = change(current);
          if (outcome.unchanged === true) return { ...current, ...outcome.extra } as T;
          const rules = validatedRules(outcome.rules);
          const requested = Date.parse(now());
          const latest =
            current.createdAt === null ? Number.NEGATIVE_INFINITY : Date.parse(current.createdAt);
          const createdAt = new Date(Math.max(requested, latest)).toISOString();
          const saved = await handle.appendCandidateKnowledgeSourceSensitivityRules(
            knowledgeBaseId,
            { rules: { rules }, createdAt },
          );
          return {
            knowledgeBaseId,
            version: saved.version,
            checksum: saved.checksum,
            createdAt: saved.createdAt,
            rules: saved.rules,
            ...outcome.extra,
          } as T;
        };
        return typeof handle.withWriterLease === "function"
          ? handle.withWriterLease("ckb-sensitivity-rules-edit", run)
          : run();
      },
    );
  };

  const uniqueId = (rules: readonly SourceSensitivityRule[]): string => {
    const taken = new Set(rules.map((rule) => rule.id));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateId();
      if (!taken.has(candidate)) return candidate;
    }
    throw new CliUserError("Could not generate a unique rule id; pass one explicitly.");
  };

  return {
    listSensitivityRules: async (command) => {
      const storeRoot = requireText(command.storeRoot, "The knowledge store root");
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "The knowledge base id");
      return useHandle(
        () => open(storeRoot),
        (handle) => readView(handle, knowledgeBaseId),
      );
    },

    addSensitivityRule: async (command) => {
      if (!sourceSensitivityTiers.includes(command.rule.tier)) {
        throw new CliUserError(`Tier must be one of: ${sourceSensitivityTiers.join(", ")}.`);
      }
      return edit<SourceSensitivityRulesView>(command, (current) => {
        const id = command.id === undefined ? uniqueId(current.rules) : command.id.trim();
        if (current.rules.some((rule) => rule.id === id)) {
          throw new CliUserError(`A sensitivity rule with id ${id} already exists.`);
        }
        const rule: SourceSensitivityRule = {
          id,
          tier: command.rule.tier,
          match: command.rule.match,
        };
        const [valid] = validatedRules([rule]);
        const existing = current.rules.find((item) => ruleKey(item) === ruleKey(valid ?? rule));
        if (existing !== undefined) {
          throw new CliUserError(
            `An equivalent ${existing.tier} rule (${describeMatch(existing.match)}) already exists as ${existing.id}.`,
          );
        }
        return { rules: [...current.rules, valid ?? rule], extra: {} };
      });
    },

    removeSensitivityRule: async (command) => {
      const ruleId = requireText(command.ruleId, "The rule id");
      return edit<SourceSensitivityRulesView>(command, (current) => {
        if (!current.rules.some((rule) => rule.id === ruleId)) {
          throw new CliUserError(
            `No sensitivity rule with id ${ruleId} exists in this knowledge base.`,
          );
        }
        return { rules: current.rules.filter((rule) => rule.id !== ruleId), extra: {} };
      });
    },

    adoptSensitivitySuggestions: async (command) => {
      const requestedIds = [...new Set(command.suggestionIds.map((id) => id.trim()))].filter(
        (id) => id !== "",
      );
      if (requestedIds.length === 0) {
        throw new CliUserError("Choose at least one suggestion id to adopt.");
      }
      const chosen = requestedIds.map((id) => {
        const suggestion = defaultSourceSensitivityRuleSuggestions.find((item) => item.id === id);
        if (suggestion === undefined) {
          throw new CliUserError(
            `Unknown suggestion id ${id}. Run "knowledge sensitivity suggestions" to list them.`,
          );
        }
        return suggestion;
      });
      return edit<SourceSensitivityAdoptionResult>(command, (current) => {
        const existingKeys = new Set(current.rules.map(ruleKey));
        const existingIds = new Set(current.rules.map((rule) => rule.id));
        const adopted: SourceSensitivityRule[] = [];
        const skipped: string[] = [];
        for (const suggestion of chosen) {
          if (existingIds.has(suggestion.id) || existingKeys.has(ruleKey(suggestion))) {
            skipped.push(suggestion.id);
            continue;
          }
          adopted.push({ id: suggestion.id, tier: suggestion.tier, match: suggestion.match });
        }
        return {
          rules: [...current.rules, ...adopted],
          extra: { adopted: adopted.map((rule) => rule.id), skipped },
          unchanged: adopted.length === 0,
        };
      });
    },

    listSensitivitySuggestions: () => defaultSourceSensitivityRuleSuggestions,

    previewSourceSensitivity: async (command) => {
      const storeRoot = requireText(command.storeRoot, "The knowledge store root");
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "The knowledge base id");
      const sourceId = requireText(command.sourceId, "The source id");
      return useHandle(
        () => open(storeRoot),
        async (handle) => {
          const view = await readView(handle, knowledgeBaseId);
          if ((await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId)) === undefined) {
            throw new CliUserError(`Source ${sourceId} was not found in this knowledge base.`);
          }
          const versions = await handle.listCandidateKnowledgeSourceVersions(
            knowledgeBaseId,
            sourceId,
          );
          const requestedVersionId = command.versionId?.trim();
          const version =
            requestedVersionId === undefined || requestedVersionId === ""
              ? versions.reduce<(typeof versions)[number] | undefined>(
                  (latest, item) =>
                    latest === undefined || item.version > latest.version ? item : latest,
                  undefined,
                )
              : versions.find((item) => item.id === requestedVersionId);
          if (version === undefined) {
            throw new CliUserError(
              requestedVersionId === undefined || requestedVersionId === ""
                ? `Source ${sourceId} has no versions.`
                : `Version ${requestedVersionId} of source ${sourceId} was not found.`,
            );
          }
          const content = await handle.readManagedCandidateKnowledgeSourceVersion(
            knowledgeBaseId,
            sourceId,
            version.id,
          );
          if (content === undefined) {
            throw new CliUserError(
              `The stored content of source ${sourceId} version ${version.id} is not available.`,
            );
          }
          const ingested = await ingestBytes(
            { path: "sensitivity-preview", mediaType: content.metadata.mediaType },
            content.bytes,
            { maxSourceBytes: content.metadata.sizeBytes || 1 },
          );
          const normalized = ingested.source;
          if (normalized === null || ingested.issues.length > 0 || normalized.issues.length > 0) {
            throw new CliUserError(
              `Source ${sourceId} version ${version.id} could not be read as text.`,
            );
          }
          const text = normalized.text;
          const includeText = command.includeText === true;
          const sectionedByHeadings = normalized.mediaType === "text/markdown";
          const sections = sectionedByHeadings
            ? classifySourceSections(text, view.rules)
            : text.length === 0
              ? []
              : [
                  {
                    headingPath: [] as string[],
                    level: 0,
                    start: 0,
                    end: text.length,
                    tier: "normal" as const,
                    matchedRuleIds: [] as string[],
                  },
                ];
          return {
            knowledgeBaseId,
            sourceId,
            versionId: version.id,
            mediaType: normalized.mediaType,
            rulesVersion: view.version,
            sectionedByHeadings,
            sections: sections.map((section, index) => ({
              index,
              headingPath: section.headingPath,
              level: section.level,
              tier: section.tier,
              matchedRuleIds: section.matchedRuleIds,
              characterCount: section.end - section.start,
              ...(includeText ? { text: text.slice(section.start, section.end) } : {}),
            })),
          };
        },
      );
    },
  };
}

export const sourceSensitivityService = createSourceSensitivityService();
