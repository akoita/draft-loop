import { sourceEvidenceKindOverridesImmutableDeleteTrigger } from "./source-evidence-kinds.js";
import { sourceSensitivityRulesImmutableDeleteTrigger } from "./source-sensitivity-rules.js";

interface TriggerDatabase {
  readonly exec: (sql: string) => unknown;
}

/**
 * Append-only tables whose delete guard is lifted while a whole knowledge base
 * is erased. Each entry names the guard trigger so it can be dropped and
 * recreated around the deletion.
 */
const candidateKnowledgeDeletionImmutableDeleteTriggers: readonly {
  readonly name: string;
  readonly table: string;
  readonly message: string;
}[] = [
  {
    name: "candidate_knowledge_sources_immutable_delete",
    table: "candidate_knowledge_sources",
    message: "candidate knowledge sources are immutable",
  },
  {
    name: "candidate_knowledge_source_versions_immutable_delete",
    table: "candidate_knowledge_source_versions",
    message: "candidate knowledge source versions are immutable",
  },
  {
    name: "candidate_knowledge_managed_source_versions_immutable_delete",
    table: "candidate_knowledge_managed_source_versions",
    message: "managed candidate knowledge source versions are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_operations_immutable_delete",
    table: "candidate_knowledge_managed_write_operations",
    message: "managed candidate knowledge write operations are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_events_immutable_delete",
    table: "candidate_knowledge_managed_write_events",
    message: "managed candidate knowledge write events are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_staging_identities_immutable_delete",
    table: "candidate_knowledge_managed_write_staging_identities",
    message: "managed candidate knowledge staging identities are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_recovery_claims_immutable_delete",
    table: "candidate_knowledge_managed_write_recovery_claims",
    message: "managed candidate knowledge recovery claims are immutable",
  },
  {
    name: "candidate_knowledge_source_origin_bindings_immutable_delete",
    table: "candidate_knowledge_source_origin_bindings",
    message: "candidate knowledge source origin bindings are immutable",
  },
  {
    name: "candidate_knowledge_source_refresh_observations_immutable_delete",
    table: "candidate_knowledge_source_refresh_observations",
    message: "candidate knowledge source refresh observations are immutable",
  },
  {
    name: "candidate_knowledge_source_retirements_immutable_delete",
    table: "candidate_knowledge_source_retirements",
    message: "candidate knowledge source retirements are immutable",
  },
  {
    name: "candidate_knowledge_source_url_provenance_immutable_delete",
    table: "candidate_knowledge_source_url_provenance",
    message: "candidate knowledge source URL provenance is immutable",
  },
  {
    name: "candidate_knowledge_source_restored_url_provenance_immutable_delete",
    table: "candidate_knowledge_source_restored_url_provenance",
    message: "candidate knowledge restored URL provenance is immutable",
  },
  {
    name: "candidate_knowledge_directory_bindings_immutable_delete",
    table: "candidate_knowledge_directory_bindings",
    message: "candidate knowledge directory bindings are immutable",
  },
  {
    name: "candidate_knowledge_directory_members_immutable_delete",
    table: "candidate_knowledge_directory_members",
    message: "candidate knowledge directory members are immutable",
  },
  {
    name: "candidate_knowledge_directory_root_revisions_immutable_delete",
    table: "candidate_knowledge_directory_root_revisions",
    message: "candidate knowledge directory root revisions are immutable",
  },
  {
    name: "candidate_knowledge_directory_member_revisions_immutable_delete",
    table: "candidate_knowledge_directory_member_revisions",
    message: "candidate knowledge directory member revisions are immutable",
  },
  {
    name: "candidate_knowledge_retention_policy_events_immutable_delete",
    table: "candidate_knowledge_retention_policy_events",
    message: "candidate knowledge retention policy events are immutable",
  },
  {
    name: "candidate_knowledge_retention_override_events_immutable_delete",
    table: "candidate_knowledge_retention_override_events",
    message: "candidate knowledge retention override events are immutable",
  },
  sourceSensitivityRulesImmutableDeleteTrigger,
  sourceEvidenceKindOverridesImmutableDeleteTrigger,
];

export function dropCandidateKnowledgeDeletionImmutableDeleteTriggers(
  database: TriggerDatabase,
): void {
  for (const trigger of candidateKnowledgeDeletionImmutableDeleteTriggers) {
    database.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }
}

export function recreateCandidateKnowledgeDeletionImmutableDeleteTriggers(
  database: TriggerDatabase,
): void {
  for (const trigger of candidateKnowledgeDeletionImmutableDeleteTriggers) {
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS ${trigger.name}
       BEFORE DELETE ON ${trigger.table}
       BEGIN SELECT RAISE(ABORT, '${trigger.message}'); END;`,
    );
  }
}
