import {
  isMemberScreenLanguage,
  type MemberScreenLanguage,
  type MemberSettingsKey,
  type MemberSettingsStore,
} from "@draft-loop/storage/member-settings";
import { requireOrganisationId, TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { SqlClient, SqlExecutor } from "./sql-client.js";

/** Runs `work` as the member's organisation, the tenant row-level security checks. */
function asOrganisation<Result>(
  client: SqlClient,
  key: MemberSettingsKey,
  work: (executor: SqlExecutor) => Promise<Result>,
): Promise<Result> {
  const tenantId = requireOrganisationId(key.organisationId);
  return client.transaction(async (executor) => {
    await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
    return work(executor);
  });
}

/** Member settings on Postgres (#2373), over the tenant directory's pool. */
export function createPostgresMemberSettings(client: SqlClient): MemberSettingsStore {
  return {
    readScreenLanguage: (key) =>
      asOrganisation(client, key, async (executor) => {
        const [row] = await executor.query(
          "SELECT screen_language FROM member_settings WHERE member_id = $1",
          [key.memberId],
        );
        const language = row?.screen_language;
        return isMemberScreenLanguage(language) ? language : undefined;
      }),
    saveScreenLanguage: ({ language, ...key }) =>
      asOrganisation(client, key, async (executor) => {
        if (!isMemberScreenLanguage(language)) {
          throw new TenantDirectoryError("invalid_input", "That screen language is not offered.");
        }
        const member = await executor.query("SELECT 1 FROM organisation_members WHERE id = $1", [
          key.memberId,
        ]);
        if (member.length === 0) {
          throw new TenantDirectoryError("member_not_found", "No such member.");
        }
        await executor.query(
          `INSERT INTO member_settings (member_id, screen_language) VALUES ($1, $2)
           ON CONFLICT (tenant_id, member_id)
           DO UPDATE SET screen_language = EXCLUDED.screen_language, updated_at = now()`,
          [key.memberId, language satisfies MemberScreenLanguage],
        );
      }),
  };
}
