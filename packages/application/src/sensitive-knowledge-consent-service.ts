import { resolve } from "node:path";
import type { ingestBytes as defaultIngestBytes } from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore as defaultOpenCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

import { CliUserError } from "./cli-user-error.js";
import {
  type CandidateKnowledgeStoreService,
  createCandidateKnowledgeStoreService,
} from "./knowledge-base.js";
import { readWorkspace } from "./local.js";
import { openPinnedEntryStore, readPinnedEntrySections } from "./pinned-source-sections.js";
import {
  readSensitiveKnowledgeConsent,
  type SensitiveKnowledgeConsent,
  setSensitiveKnowledgeConsent,
} from "./sensitive-knowledge-consent.js";

/** Section and character totals only; never headings or text. */
export interface WithheldTierCounts {
  readonly sections: number;
  readonly characters: number;
}

export interface WithheldKnowledgeTotals {
  /** Sections whose tier is never-share; they are withheld under either consent setting. */
  readonly neverShare: WithheldTierCounts;
  /** Sections whose tier is sensitive; withheld only while consent is off. */
  readonly sensitive: WithheldTierCounts;
  /** What is withheld under the current consent. */
  readonly withheldNow: WithheldTierCounts;
  /** What would be withheld under the opposite consent setting. */
  readonly withheldIfToggled: WithheldTierCounts;
}

export interface WithheldKnowledgeBaseCounts extends WithheldKnowledgeTotals {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

/** Content-free preview of what the workspace's selected knowledge withholds from providers. */
export interface WithheldKnowledgeCounts {
  readonly allowSensitive: boolean;
  readonly consentUpdatedAt: string | null;
  /** One entry per selected knowledge base; empty when the workspace has no selection. */
  readonly knowledgeBases: readonly WithheldKnowledgeBaseCounts[];
  readonly total: WithheldKnowledgeTotals;
}

export interface SensitiveKnowledgeConsentService {
  readonly countWithheldKnowledge: (root: string) => Promise<WithheldKnowledgeCounts>;
  readonly setSensitiveKnowledgeConsent: (
    root: string,
    allowSensitive: boolean,
  ) => Promise<SensitiveKnowledgeConsent>;
}

export interface SensitiveKnowledgeConsentServiceDependencies {
  readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes?: typeof defaultIngestBytes;
  readonly knowledgeService?: Pick<
    CandidateKnowledgeStoreService,
    "createKnowledgeSelectionSnapshot"
  >;
}

export const withheldKnowledgeUnavailableMessage =
  "The selected knowledge could not be read, so the withheld sections could not be counted.";

const none: WithheldTierCounts = { sections: 0, characters: 0 };

function add(left: WithheldTierCounts, right: WithheldTierCounts): WithheldTierCounts {
  return {
    sections: left.sections + right.sections,
    characters: left.characters + right.characters,
  };
}

function totals(
  neverShare: WithheldTierCounts,
  sensitive: WithheldTierCounts,
  allowSensitive: boolean,
): WithheldKnowledgeTotals {
  const withSensitive = add(neverShare, sensitive);
  return {
    neverShare,
    sensitive,
    withheldNow: allowSensitive ? neverShare : withSensitive,
    withheldIfToggled: allowSensitive ? withSensitive : neverShare,
  };
}

/**
 * Count the never-share and sensitive sections in the workspace's selected knowledge bases, for
 * the current consent and its opposite. Uses the same pinned-source classification as the run
 * filter, and reports numbers only. An invalid consent file or unreadable knowledge throws.
 */
export function createSensitiveKnowledgeConsentService(
  dependencies: SensitiveKnowledgeConsentServiceDependencies = {},
): SensitiveKnowledgeConsentService {
  const open = dependencies.open ?? defaultOpenCandidateKnowledgeStore;
  const knowledgeService = dependencies.knowledgeService ?? createCandidateKnowledgeStoreService();

  async function countWithheldKnowledge(rootInput: string): Promise<WithheldKnowledgeCounts> {
    const root = resolve(rootInput);
    const config = await readWorkspace(root);
    const consent = await readSensitiveKnowledgeConsent(root);
    const binding = config.candidateKnowledgeSelection;
    const knowledgeBases: WithheldKnowledgeBaseCounts[] = [];
    if (binding !== undefined) {
      try {
        const snapshot = await knowledgeService.createKnowledgeSelectionSnapshot({
          selections: binding.entries.map(({ storeRoot, knowledgeBaseId }) => ({
            storeRoot,
            knowledgeBaseId,
          })),
          ...(binding.combinationApproved === undefined ? {} : { combinationApproved: true }),
        });
        for (const entry of snapshot.entries) {
          const handle = await openPinnedEntryStore(binding.entries, entry, open);
          let neverShare = none;
          let sensitive = none;
          try {
            const sources = await readPinnedEntrySections(handle, entry, dependencies.ingestBytes);
            for (const source of sources ?? []) {
              for (const section of source.sections) {
                const size = { sections: 1, characters: section.end - section.start };
                if (section.tier === "never-share") neverShare = add(neverShare, size);
                else if (section.tier === "sensitive") sensitive = add(sensitive, size);
              }
            }
          } finally {
            await handle.close().catch(() => undefined);
          }
          knowledgeBases.push({
            storeId: entry.storeId,
            knowledgeBaseId: entry.knowledgeBaseId,
            ...totals(neverShare, sensitive, consent.allowSensitive),
          });
        }
      } catch {
        throw new CliUserError(withheldKnowledgeUnavailableMessage);
      }
    }
    const sum = (pick: (item: WithheldKnowledgeTotals) => WithheldTierCounts) =>
      knowledgeBases.reduce((count, item) => add(count, pick(item)), none);
    return {
      allowSensitive: consent.allowSensitive,
      consentUpdatedAt: consent.updatedAt,
      knowledgeBases,
      total: totals(
        sum((item) => item.neverShare),
        sum((item) => item.sensitive),
        consent.allowSensitive,
      ),
    };
  }

  return {
    countWithheldKnowledge,
    setSensitiveKnowledgeConsent: (root, allowSensitive) =>
      setSensitiveKnowledgeConsent(resolve(root), allowSensitive),
  };
}

export const sensitiveKnowledgeConsentService = createSensitiveKnowledgeConsentService();
export const countWithheldKnowledge = sensitiveKnowledgeConsentService.countWithheldKnowledge;
