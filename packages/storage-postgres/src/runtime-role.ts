import { createSqlClient } from "./sql-client.js";

const rolePattern = /^[a-z_][a-z0-9_]{0,62}$/u;
/** A Cloud SQL IAM database user for a service account: `name@project.iam`. */
const iamUserPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam$/u;

/** Reads the IAM database users that act as the runtime role, a comma-separated list. */
export function parseRuntimeRoleMembers(value: string | undefined): readonly string[] {
  const members = (value ?? "")
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member !== "");
  for (const member of members) {
    if (!iamUserPattern.test(member)) {
      throw new Error(`Invalid IAM database user: ${member}`);
    }
  }
  return members;
}

/**
 * Makes sure the runtime role exists and that each IAM database user is a member of it, so the
 * services inherit its table grants and nothing more. On Cloud SQL the role is created here,
 * without login, because users created through the Cloud SQL API join its superuser group; the
 * local stack creates it with a login instead, and an existing role is left as it is.
 */
export async function ensureRuntimeRole(
  connectionString: string,
  role: string,
  members: readonly string[],
): Promise<void> {
  if (!rolePattern.test(role)) throw new Error(`Invalid Postgres role name: ${role}`);
  for (const member of members) parseRuntimeRoleMembers(member);
  const owner = createSqlClient({ connectionString, maxConnections: 1 });
  try {
    await owner.query(`DO $$
      BEGIN
        CREATE ROLE ${role} NOLOGIN;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    for (const member of members) {
      await owner.query(`GRANT ${role} TO "${member}"`);
    }
  } finally {
    await owner.close();
  }
}
