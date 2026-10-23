import type { CandidateKnowledgeBaseStoragePort } from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import type { SourceSensitivityRuleStoragePort } from "@draft-loop/storage/source-sensitivity-rules";

import { HostedKnowledgeIntakeError } from "./hosted-knowledge-intake.js";
import {
  createSourceSensitivityService,
  type SourceSensitivityRuleInput,
  type SourceSensitivityRulesView,
} from "./source-sensitivity-service.js";

/** The records the hosted service keeps a knowledge base's sensitivity rules in. */
export interface HostedSensitivityRuleRecords
  extends Pick<CandidateKnowledgeBaseStoragePort, "getCandidateKnowledgeBase">,
    Pick<
      SourceSensitivityRuleStoragePort,
      | "appendCandidateKnowledgeSourceSensitivityRules"
      | "getCandidateKnowledgeSourceSensitivityRules"
    > {}

export interface HostedSensitivityRules {
  readonly list: (knowledgeBaseId: string) => Promise<SourceSensitivityRulesView>;
  readonly add: (
    knowledgeBaseId: string,
    rule: SourceSensitivityRuleInput,
    id?: string,
  ) => Promise<SourceSensitivityRulesView>;
  readonly remove: (knowledgeBaseId: string, ruleId: string) => Promise<SourceSensitivityRulesView>;
}

export interface HostedSensitivityRulesOptions {
  readonly records: HostedSensitivityRuleRecords;
  /** The tenant's one store, which the rules service names as its root. */
  readonly storeId: string;
  readonly now?: () => string;
}

/**
 * A hosted knowledge base's sensitivity rules, edited with the same checks as the CLI's: the
 * shared rules service over the tenant's Postgres records instead of a local store. Runs already
 * read the rules through the run's knowledge store, so marked sections stay out of the evidence.
 */
export function createHostedSensitivityRules(
  options: HostedSensitivityRulesOptions,
): HostedSensitivityRules {
  const { records, storeId } = options;
  // The rules service reads and writes only these, so a narrow handle serves it; Postgres orders
  // concurrent appends itself, in the knowledge base's row lock.
  const handle = {
    getCandidateKnowledgeBase: records.getCandidateKnowledgeBase,
    getCandidateKnowledgeSourceSensitivityRules:
      records.getCandidateKnowledgeSourceSensitivityRules,
    appendCandidateKnowledgeSourceSensitivityRules:
      records.appendCandidateKnowledgeSourceSensitivityRules,
    withWriterLease: <Result>(_operation: string, callback: () => Promise<Result>) => callback(),
    close: async () => undefined,
  } as unknown as CandidateKnowledgeStoreHandle;
  const service = createSourceSensitivityService({
    open: async () => handle,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const requireKnowledgeBase = async (knowledgeBaseId: string): Promise<void> => {
    if ((await records.getCandidateKnowledgeBase(knowledgeBaseId)) === undefined) {
      throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
    }
  };
  return {
    list: async (knowledgeBaseId) => {
      await requireKnowledgeBase(knowledgeBaseId);
      return service.listSensitivityRules({ storeRoot: storeId, knowledgeBaseId });
    },
    add: async (knowledgeBaseId, rule, id) => {
      await requireKnowledgeBase(knowledgeBaseId);
      return service.addSensitivityRule({
        storeRoot: storeId,
        knowledgeBaseId,
        rule,
        ...(id === undefined ? {} : { id }),
      });
    },
    remove: async (knowledgeBaseId, ruleId) => {
      await requireKnowledgeBase(knowledgeBaseId);
      return service.removeSensitivityRule({ storeRoot: storeId, knowledgeBaseId, ruleId });
    },
  };
}
