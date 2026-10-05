import type {
  CandidateKnowledgeRetentionClass,
  CandidateKnowledgeRetentionOverrideKind,
  CandidateKnowledgeRetentionRule,
} from "@draft-loop/domain";

export const maximumCandidateKnowledgeRetentionExpireAfterDays = 36_500;

export interface CandidateKnowledgeRetentionClassPolicyInput {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly rule: CandidateKnowledgeRetentionRule;
  readonly expireAfterDays?: number | null;
}

export interface CandidateKnowledgeRetentionClassPolicy
  extends CandidateKnowledgeRetentionClassPolicyInput {
  readonly expireAfterDays: number | null;
}

export interface CandidateKnowledgeRetentionPolicyUpdateInput {
  readonly expectedRevision: number;
  readonly updatedAt: string;
  readonly classes: readonly CandidateKnowledgeRetentionClassPolicyInput[];
}

export interface CandidateKnowledgeRetentionOverrideRecord {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly kind: CandidateKnowledgeRetentionOverrideKind;
  readonly state: "applied" | "released";
  readonly sequence: number;
  readonly overrideRevision: number;
  readonly policyRevision: number;
  readonly changedAt: string;
}

export interface CandidateKnowledgeRetentionOverrideInput {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly kind: CandidateKnowledgeRetentionOverrideKind;
  readonly expectedPolicyRevision: number;
  readonly expectedState: "none" | "applied" | "released";
  readonly changedAt: string;
}

export interface CandidateKnowledgeRetentionPolicyRecord {
  readonly knowledgeBaseId: string;
  readonly revision: number;
  readonly overrideRevision: number;
  readonly updatedAt: string;
  readonly classes: readonly CandidateKnowledgeRetentionClassPolicy[];
  readonly activeOverrides: readonly CandidateKnowledgeRetentionOverrideRecord[];
}

export type CandidateKnowledgeRetentionOwnershipStatus = "owned" | "preserved" | "not-materialized";

export interface CandidateKnowledgeRetentionPlanClass {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly rule: CandidateKnowledgeRetentionRule;
  readonly expireAfterDays: number | null;
  readonly ownershipStatus: CandidateKnowledgeRetentionOwnershipStatus;
  readonly eligibleCount: number;
  readonly preservedCount: number;
  readonly unmanagedCount: number;
  readonly unknownCount: number;
  readonly countCapped: boolean;
  readonly preservationReasons: readonly (
    | "retention-rule"
    | "override"
    | "unmanaged"
    | "unknown"
    | "not-materialized"
  )[];
}

export interface CandidateKnowledgeRetentionPlan {
  readonly schemaVersion: 1;
  readonly knowledgeBaseId: string;
  readonly asOf: string;
  readonly policyRevision: number;
  readonly overrideRevision: number;
  readonly classes: readonly CandidateKnowledgeRetentionPlanClass[];
}
