import type {
  CanonicalCandidateProfile,
  OpportunityBrief,
  WritingPolicyInput,
} from "@draft-loop/schemas";
import type {
  CanonicalCandidateProfileVersionRecord,
  OpportunityBriefVersionRecord,
  WritingPolicyVersionInput,
  WritingPolicyVersionRecord,
  WritingPolicyVersionSaveOptions,
} from "@draft-loop/storage";
import { payloadChecksum, serialize } from "@draft-loop/storage/audit-trail";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import {
  recordToJson,
  requireNonEmpty,
  requirePositive,
} from "@draft-loop/storage/history-records";
import {
  canonicalCandidateProfileAuditEvent,
  canonicalCandidateProfileCatalogLimitErrorMessage,
  canonicalCandidateProfileLeaf,
  canonicalCandidateProfileVersionFromRow,
  canonicalCandidateProfileVersionSelect,
  checkCanonicalCandidateProfileAppend,
  checkCanonicalCandidateProfileHistory,
  checkExistingWritingPolicyVersion,
  checkOpportunityBriefAppend,
  checkWritingPolicyParentTime,
  maximumCanonicalCandidateProfileCatalogNameCount,
  opportunityBriefAuditEvent,
  opportunityBriefFromRow,
  prepareWritingPolicyVersion,
  requireSha256,
  resolveWritingPolicyPrior,
  validatedCanonicalCandidateProfile,
  validatedOpportunityBrief,
  writingPolicyAuditEvent,
  writingPolicyVersionFromRow,
  writingPolicyVersionRecord,
  writingPolicyVersionSelect,
} from "@draft-loop/storage/versioned-records";
import { appendAuditEventRow } from "./audit-trail.js";
import type { SqlClient, SqlExecutor } from "./sql-client.js";

const briefSelect =
  "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions";

/** The append lock namespace; the second key hashes the workspace and the record kind. */
const versionedRecordLockNamespace = 0x76657273;

/** Serializes appends to one workspace's chain of one record kind, as SQLite's writer lock does. */
async function lockChain(executor: SqlExecutor, workspaceId: string, kind: string): Promise<void> {
  await executor.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    versionedRecordLockNamespace,
    `${kind}:${workspaceId}`,
  ]);
}

async function requireWorkspace(
  executor: SqlExecutor,
  workspaceId: string,
  message: string,
): Promise<void> {
  const [workspace] = await executor.query("SELECT id FROM workspaces WHERE id = $1", [
    workspaceId,
  ]);
  if (workspace === undefined) throw new StorageValidationError(message);
}

async function profileHistory(
  executor: SqlExecutor,
  workspaceId: string,
  profileId: string,
): Promise<readonly CanonicalCandidateProfileVersionRecord[]> {
  const rows = await executor.query(
    `${canonicalCandidateProfileVersionSelect()} WHERE workspace_id = $1 AND profile_id = $2 ORDER BY version`,
    [workspaceId, profileId],
  );
  return checkCanonicalCandidateProfileHistory(
    rows.map(canonicalCandidateProfileVersionFromRow),
    workspaceId,
    profileId,
  );
}

/** The one policy version no other version names as its prior, or none for an empty history. */
async function writingPolicyLeaf(executor: SqlExecutor, workspaceId: string) {
  const leaves = await executor.query(
    `SELECT candidate.workspace_id, candidate.policy_checksum, candidate.version, candidate.schema_version,
            candidate.created_at, candidate.prior_checksum, candidate.payload_json, candidate.payload_checksum
     FROM writing_policy_versions AS candidate
     WHERE candidate.workspace_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM writing_policy_versions AS child
         WHERE child.workspace_id = candidate.workspace_id AND child.prior_checksum = candidate.policy_checksum
       )`,
    [workspaceId],
  );
  if (leaves.length > 1) {
    throw new StorageConflictError("The writing policy history has multiple current leaves.");
  }
  if (leaves.length === 1) return leaves[0];
  const [history] = await executor.query(
    "SELECT 1 FROM writing_policy_versions WHERE workspace_id = $1 LIMIT 1",
    [workspaceId],
  );
  if (history !== undefined) {
    throw new StorageConflictError("The writing policy history has no current leaf.");
  }
  return undefined;
}

/**
 * Opportunity briefs, canonical candidate profiles and writing policies on Postgres. The rules
 * (validation, append chains, audit events, row checks) come from
 * `@draft-loop/storage/versioned-records`, the same code SQLite runs.
 */
export function createVersionedRecords(client: SqlClient) {
  async function saveWritingPolicyVersion(
    workspaceId: string,
    policy: WritingPolicyInput,
    options?: WritingPolicyVersionSaveOptions,
  ): Promise<WritingPolicyVersionRecord>;
  async function saveWritingPolicyVersion(
    input: WritingPolicyVersionInput,
  ): Promise<WritingPolicyVersionRecord>;
  async function saveWritingPolicyVersion(
    workspaceOrInput: string | WritingPolicyVersionInput,
    policyInput?: WritingPolicyInput,
    options: WritingPolicyVersionSaveOptions = {},
  ): Promise<WritingPolicyVersionRecord> {
    const prepared = prepareWritingPolicyVersion(
      typeof workspaceOrInput === "string"
        ? {
            workspaceId: workspaceOrInput,
            policy: policyInput,
            createdAt: options.createdAt,
            priorChecksum: options.priorChecksum,
          }
        : {
            workspaceId: workspaceOrInput.workspaceId,
            policy: workspaceOrInput.policy,
            createdAt: workspaceOrInput.createdAt,
            priorChecksum: workspaceOrInput.priorChecksum,
          },
    );
    const { workspaceId, policy } = prepared;
    return client.transaction(async (executor) => {
      await lockChain(executor, workspaceId, "writing-policy");
      await requireWorkspace(executor, workspaceId, "The writing policy workspace was not found.");
      const leaf = await writingPolicyLeaf(executor, workspaceId);
      const [existing] = await executor.query(
        `${writingPolicyVersionSelect()} WHERE workspace_id = $1 AND policy_checksum = $2`,
        [workspaceId, policy.checksum],
      );
      if (existing !== undefined) {
        return checkExistingWritingPolicyVersion(writingPolicyVersionFromRow(existing), prepared);
      }
      const [versionConflict] = await executor.query(
        `${writingPolicyVersionSelect()} WHERE workspace_id = $1 AND version = $2 LIMIT 1`,
        [workspaceId, policy.version],
      );
      if (versionConflict !== undefined) {
        throw new StorageConflictError("The writing policy display version is already bound.");
      }
      const priorChecksum = resolveWritingPolicyPrior(
        prepared,
        leaf === undefined ? undefined : String(leaf.policy_checksum),
      );
      if (priorChecksum !== null) {
        const [parent] = await executor.query(
          `${writingPolicyVersionSelect()} WHERE workspace_id = $1 AND policy_checksum = $2`,
          [workspaceId, priorChecksum],
        );
        if (parent === undefined) {
          throw new StorageConflictError("The writing policy parent version is missing.");
        }
        checkWritingPolicyParentTime(prepared.createdAt, String(parent.created_at));
      }
      const record = writingPolicyVersionRecord(prepared, priorChecksum);
      await executor.query(
        "INSERT INTO writing_policy_versions (workspace_id, policy_checksum, version, schema_version, created_at, prior_checksum, payload_json, payload_checksum) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          workspaceId,
          record.checksum,
          record.version,
          policy.schemaVersion,
          record.createdAt,
          priorChecksum,
          prepared.payloadJson,
          record.payloadChecksum,
        ],
      );
      await appendAuditEventRow(executor, writingPolicyAuditEvent(record));
      return record;
    });
  }

  return {
    saveOpportunityBrief: async (
      workspaceId: string,
      brief: OpportunityBrief,
    ): Promise<OpportunityBriefVersionRecord> => {
      const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
      const normalizedBrief = validatedOpportunityBrief(brief);
      const payload = recordToJson(normalizedBrief);
      const checksumValue = payloadChecksum(payload);
      return client.transaction(async (executor) => {
        await lockChain(executor, normalizedWorkspaceId, "opportunity-brief");
        await requireWorkspace(
          executor,
          normalizedWorkspaceId,
          "The opportunity workspace was not found.",
        );
        const byVersion = `${briefSelect} WHERE workspace_id = $1 AND brief_id = $2 AND version = $3`;
        const [existing] = await executor.query(byVersion, [
          normalizedWorkspaceId,
          normalizedBrief.id,
          normalizedBrief.version,
        ]);
        if (existing !== undefined) {
          const existingRecord = opportunityBriefFromRow(existing);
          if (existingRecord.checksum !== checksumValue) {
            throw new StorageConflictError("The opportunity brief version is immutable.");
          }
          return existingRecord;
        }
        const [parentRow] =
          normalizedBrief.version > 1
            ? await executor.query(byVersion, [
                normalizedWorkspaceId,
                normalizedBrief.id,
                normalizedBrief.version - 1,
              ])
            : [];
        checkOpportunityBriefAppend(
          normalizedBrief,
          parentRow === undefined ? undefined : opportunityBriefFromRow(parentRow).brief,
        );
        await executor.query(
          "INSERT INTO opportunity_brief_versions (workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [
            normalizedWorkspaceId,
            normalizedBrief.id,
            normalizedBrief.version,
            normalizedBrief.schemaVersion,
            normalizedBrief.priorVersion,
            normalizedBrief.status,
            normalizedBrief.createdAt,
            normalizedBrief.reviewedAt,
            serialize(payload),
            checksumValue,
          ],
        );
        const record = {
          workspaceId: normalizedWorkspaceId,
          brief: normalizedBrief,
          checksum: checksumValue,
        };
        await appendAuditEventRow(executor, opportunityBriefAuditEvent(record));
        return record;
      });
    },

    getOpportunityBrief: async (workspaceId: string, briefId: string, version: number) => {
      const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
      const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
      requirePositive(version, "opportunity brief version");
      const [row] = await client.query(
        `${briefSelect} WHERE workspace_id = $1 AND brief_id = $2 AND version = $3`,
        [normalizedWorkspaceId, normalizedBriefId, version],
      );
      return row === undefined ? undefined : opportunityBriefFromRow(row);
    },

    getLatestOpportunityBrief: async (workspaceId: string, briefId: string) => {
      const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
      const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
      const [row] = await client.query(
        `${briefSelect} WHERE workspace_id = $1 AND brief_id = $2 ORDER BY version DESC LIMIT 1`,
        [normalizedWorkspaceId, normalizedBriefId],
      );
      return row === undefined ? undefined : opportunityBriefFromRow(row);
    },

    listOpportunityBriefVersions: async (workspaceId: string, briefId: string) => {
      const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
      const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
      const rows = await client.query(
        `${briefSelect} WHERE workspace_id = $1 AND brief_id = $2 ORDER BY version`,
        [normalizedWorkspaceId, normalizedBriefId],
      );
      return rows.map(opportunityBriefFromRow);
    },

    saveCanonicalCandidateProfile: async (
      workspaceId: string,
      profile: CanonicalCandidateProfile,
    ): Promise<CanonicalCandidateProfileVersionRecord> => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "canonical candidate profile workspaceId",
      ).trim();
      const normalizedProfile = validatedCanonicalCandidateProfile(profile);
      const payload = recordToJson(normalizedProfile);
      const checksumValue = payloadChecksum(payload);
      return client.transaction(async (executor) => {
        await lockChain(executor, normalizedWorkspaceId, "canonical-candidate-profile");
        await requireWorkspace(
          executor,
          normalizedWorkspaceId,
          "The canonical candidate profile workspace was not found.",
        );
        const history = await profileHistory(executor, normalizedWorkspaceId, normalizedProfile.id);
        const existing = history.find(
          (record) => record.profile.version === normalizedProfile.version,
        );
        if (existing !== undefined) {
          if (existing.checksum !== checksumValue) {
            throw new StorageConflictError("The canonical candidate profile version is immutable.");
          }
          return existing;
        }
        checkCanonicalCandidateProfileAppend(
          normalizedProfile,
          canonicalCandidateProfileLeaf(history),
        );
        await executor.query(
          "INSERT INTO canonical_candidate_profile_versions (workspace_id, profile_id, version, schema_version, parent_version, status, created_at, updated_at, reviewed_at, payload_json, payload_checksum) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
          [
            normalizedWorkspaceId,
            normalizedProfile.id,
            normalizedProfile.version,
            normalizedProfile.schemaVersion,
            normalizedProfile.parentVersion,
            normalizedProfile.status,
            normalizedProfile.createdAt,
            normalizedProfile.updatedAt,
            normalizedProfile.reviewedAt ?? null,
            serialize(payload),
            checksumValue,
          ],
        );
        const record = {
          workspaceId: normalizedWorkspaceId,
          profile: normalizedProfile,
          checksum: checksumValue,
        };
        await appendAuditEventRow(executor, canonicalCandidateProfileAuditEvent(record));
        return record;
      });
    },

    getCanonicalCandidateProfile: async (
      workspaceId: string,
      profileId: string,
      version: number,
    ) => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "canonical candidate profile workspaceId",
      ).trim();
      const normalizedProfileId = requireNonEmpty(
        profileId,
        "canonical candidate profileId",
      ).trim();
      requirePositive(version, "canonical candidate profile version");
      const history = await profileHistory(client, normalizedWorkspaceId, normalizedProfileId);
      return history.find((record) => record.profile.version === version);
    },

    getLatestCanonicalCandidateProfile: async (workspaceId: string, profileId: string) => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "canonical candidate profile workspaceId",
      ).trim();
      const normalizedProfileId = requireNonEmpty(
        profileId,
        "canonical candidate profileId",
      ).trim();
      return canonicalCandidateProfileLeaf(
        await profileHistory(client, normalizedWorkspaceId, normalizedProfileId),
      );
    },

    listCanonicalCandidateProfileVersions: async (
      workspaceId: string,
      profileId?: string,
    ): Promise<readonly CanonicalCandidateProfileVersionRecord[]> => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "canonical candidate profile workspaceId",
      ).trim();
      if (profileId !== undefined) {
        return profileHistory(
          client,
          normalizedWorkspaceId,
          requireNonEmpty(profileId, "canonical candidate profileId").trim(),
        );
      }
      // Bounded, byte-ordered catalog, as SQLite enumerates it; each profile's chain is checked.
      const rows = await client.query(
        `SELECT DISTINCT profile_id COLLATE "C" AS profile_id FROM canonical_candidate_profile_versions WHERE workspace_id = $1 ORDER BY 1 LIMIT $2`,
        [normalizedWorkspaceId, maximumCanonicalCandidateProfileCatalogNameCount + 1],
      );
      if (rows.length > maximumCanonicalCandidateProfileCatalogNameCount) {
        throw new Error(canonicalCandidateProfileCatalogLimitErrorMessage);
      }
      const histories = [];
      for (const row of rows) {
        histories.push(
          ...(await profileHistory(client, normalizedWorkspaceId, String(row.profile_id))),
        );
      }
      return Object.freeze(histories);
    },

    saveWritingPolicyVersion,

    getWritingPolicyVersion: async (workspaceId: string, policyChecksum: string) => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "writing policy workspaceId",
      ).trim();
      const normalizedChecksum = requireSha256(policyChecksum, "writing policy checksum");
      const [row] = await client.query(
        `${writingPolicyVersionSelect()} WHERE workspace_id = $1 AND policy_checksum = $2`,
        [normalizedWorkspaceId, normalizedChecksum],
      );
      return row === undefined ? undefined : writingPolicyVersionFromRow(row);
    },

    getLatestWritingPolicyVersion: async (workspaceId: string) => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "writing policy workspaceId",
      ).trim();
      const leaf = await writingPolicyLeaf(client, normalizedWorkspaceId);
      return leaf === undefined ? undefined : writingPolicyVersionFromRow(leaf);
    },

    listWritingPolicyVersions: async (workspaceId: string) => {
      const normalizedWorkspaceId = requireNonEmpty(
        workspaceId,
        "writing policy workspaceId",
      ).trim();
      await writingPolicyLeaf(client, normalizedWorkspaceId);
      const rows = await client.query(
        `${writingPolicyVersionSelect()} WHERE workspace_id = $1 ORDER BY created_at::timestamptz, created_at, policy_checksum`,
        [normalizedWorkspaceId],
      );
      return rows.map(writingPolicyVersionFromRow);
    },
  };
}
