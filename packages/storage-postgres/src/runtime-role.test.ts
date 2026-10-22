import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ensureRuntimeRole, parseRuntimeRoleMembers } from "./runtime-role.js";
import { createSqlClient } from "./sql-client.js";

const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe("parseRuntimeRoleMembers", () => {
  it("reads a comma-separated list of service-account database users", () => {
    expect(parseRuntimeRoleMembers(undefined)).toEqual([]);
    expect(parseRuntimeRoleMembers(" , ")).toEqual([]);
    expect(parseRuntimeRoleMembers("api-runtime@example-proj.iam")).toEqual([
      "api-runtime@example-proj.iam",
    ]);
  });

  it("refuses names that are not IAM database users", () => {
    for (const member of ["postgres", 'x"; drop role y; --@example-proj.iam', "a@b.iam"]) {
      expect(() => parseRuntimeRoleMembers(member)).toThrow("Invalid IAM database user");
    }
  });
});

describe.runIf(connectionString !== undefined)("ensureRuntimeRole on Postgres", () => {
  it("creates the role without login, then makes each member inherit it", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const role = `runtime_${suffix}`;
    const member = `svc-${suffix}@example-proj.iam`;
    const admin = createSqlClient({ connectionString: connectionString ?? "", maxConnections: 1 });
    try {
      // Cloud SQL creates IAM database users itself; plain Postgres stands in with a login role.
      await admin.query(`CREATE ROLE "${member}" LOGIN`);
      await ensureRuntimeRole(connectionString ?? "", role, [member]);
      // Running it again changes nothing.
      await ensureRuntimeRole(connectionString ?? "", role, [member]);
      const [created] = await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
        role,
      ]);
      expect(created).toEqual({ rolcanlogin: false });
      const [membership] = await admin.query("SELECT pg_has_role($1, $2, 'MEMBER') AS member", [
        member,
        role,
      ]);
      expect(membership).toEqual({ member: true });
    } finally {
      await admin.query(`DROP ROLE IF EXISTS "${member}"`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.close();
    }
  });
});
