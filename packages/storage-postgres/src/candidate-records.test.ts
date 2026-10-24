import { describe, expect, it } from "vitest";
import type { PostgresTenancy } from "./postgres-storage.js";
import { createSqlPool } from "./sql-client.js";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";

function refusedWith(code: string) {
  return expect.objectContaining({ name: "CandidateRecordAccessError", code });
}

interface Organisation {
  readonly ownerId: string;
  readonly coachId: string;
}

describe.runIf(connectionString !== undefined)("Postgres candidate record access", () => {
  const url = connectionString ?? "";

  async function withTenancy(
    work: (context: {
      readonly tenancy: PostgresTenancy;
      readonly directory: PostgresTenantDirectory;
      readonly schema: TestSchema;
      readonly organisation: (tenantId: string) => Promise<Organisation>;
    }) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "candidate_records");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    const tenancy = await schema.openTenancy();
    // A fictional organisation with an owner, a coach and one candidate record.
    const organisation = async (tenantId: string): Promise<Organisation> => {
      const created = await directory.createOrganisation({
        organisationId: tenantId,
        name: `Coaching ${tenantId}`,
        firstOwnerEmail: `owner@${tenantId}.example.test`,
      });
      const coach = await directory.inviteMember({
        organisationId: tenantId,
        email: `coach@${tenantId}.example.test`,
        role: "member",
      });
      await tenancy.forTenant(tenantId).saveWorkspace({
        id: "record-1",
        state: "collecting",
        createdAt: at,
        updatedAt: at,
      });
      return { ownerId: created.firstOwner.memberId, coachId: coach.memberId };
    };
    try {
      await work({ tenancy, directory, schema, organisation });
    } finally {
      await tenancy.close();
      await directory.close();
      await schema.drop();
    }
  }

  it("assigns, lists and unassigns members, and assigning again changes nothing", async () => {
    await withTenancy(async ({ tenancy, organisation }) => {
      const { ownerId, coachId } = await organisation("org-north");
      const north = tenancy.forTenant("org-north");
      await north.saveWorkspace({
        id: "record-2",
        state: "collecting",
        createdAt: at,
        updatedAt: at,
      });

      const first = await north.candidateRecords.assignMember({
        workspaceId: "record-1",
        memberId: coachId,
      });
      expect(first).toMatchObject({ workspaceId: "record-1", memberId: coachId });
      expect(Number.isNaN(Date.parse(first.assignedAt))).toBe(false);
      await expect(
        north.candidateRecords.assignMember({ workspaceId: "record-1", memberId: coachId }),
      ).resolves.toEqual(first);
      await north.candidateRecords.assignMember({ workspaceId: "record-1", memberId: ownerId });
      await north.candidateRecords.assignMember({ workspaceId: "record-2", memberId: coachId });

      const recordMembers = await north.candidateRecords.listRecordMembers("record-1");
      expect(recordMembers.map((entry) => entry.memberId).sort()).toEqual(
        [coachId, ownerId].sort(),
      );
      const coachRecords = await north.candidateRecords.listMemberRecords(coachId);
      expect(coachRecords.map((entry) => entry.workspaceId).sort()).toEqual([
        "record-1",
        "record-2",
      ]);

      await expect(
        north.candidateRecords.unassignMember({ workspaceId: "record-1", memberId: coachId }),
      ).resolves.toBe(true);
      await expect(
        north.candidateRecords.unassignMember({ workspaceId: "record-1", memberId: coachId }),
      ).resolves.toBe(false);
      await expect(north.candidateRecords.listRecordMembers("record-1")).resolves.toEqual([
        expect.objectContaining({ memberId: ownerId }),
      ]);
      await expect(north.candidateRecords.listMemberRecords(coachId)).resolves.toEqual([
        expect.objectContaining({ workspaceId: "record-2" }),
      ]);
    });
  });

  it("assigns only one of several creators racing for a new record", async () => {
    await withTenancy(async ({ tenancy, organisation }) => {
      const { ownerId, coachId } = await organisation("org-north");
      const records = tenancy.forTenant("org-north").candidateRecords;

      // Each record is claimed by both members at once; a check followed by an insert would let
      // both in on some of them.
      const ids = Array.from({ length: 12 }, (_, index) => `new-record-${index}`);
      const outcomes = await Promise.all(
        ids.map(async (workspaceId) => ({
          workspaceId,
          claims: await Promise.all(
            [ownerId, coachId].map(async (memberId) => ({
              memberId,
              assignment: await records.assignCreator({ workspaceId, memberId }),
            })),
          ),
        })),
      );
      for (const { workspaceId, claims } of outcomes) {
        const winners = claims.filter(({ assignment }) => assignment !== undefined);
        expect(winners).toHaveLength(1);
        const assigned = await records.listRecordMembers(workspaceId);
        expect(assigned.map(({ memberId }) => memberId)).toEqual([winners[0]?.memberId]);
      }

      // A record that already has a member refuses a later creator, even a member it names.
      await expect(
        records.assignCreator({ workspaceId: "record-1", memberId: coachId }),
      ).resolves.toMatchObject({ workspaceId: "record-1", memberId: coachId });
      await expect(
        records.assignCreator({ workspaceId: "record-1", memberId: ownerId }),
      ).resolves.toBeUndefined();
      await expect(
        records.assignCreator({ workspaceId: "record-1", memberId: coachId }),
      ).resolves.toBeUndefined();
      await expect(
        records.assignCreator({ workspaceId: "record-2", memberId: "member-missing" }),
      ).rejects.toEqual(refusedWith("member_not_found"));
    });
  });

  it("refuses an unknown member and invalid ids", async () => {
    await withTenancy(async ({ tenancy, organisation }) => {
      const { coachId } = await organisation("org-north");
      const north = tenancy.forTenant("org-north").candidateRecords;

      await expect(
        north.assignMember({ workspaceId: "record-1", memberId: "member-missing" }),
      ).rejects.toEqual(refusedWith("member_not_found"));
      // The API checks a record exists before assigning; one nobody is assigned to lists no one.
      await expect(north.listRecordMembers("record-missing")).resolves.toEqual([]);
      await expect(north.listMemberRecords("member-missing")).rejects.toEqual(
        refusedWith("member_not_found"),
      );
      await expect(north.assignMember({ workspaceId: "", memberId: coachId })).rejects.toEqual(
        refusedWith("invalid_input"),
      );
      await expect(
        north.assignMember({ workspaceId: "record-1", memberId: ` ${coachId}` }),
      ).rejects.toEqual(refusedWith("invalid_input"));
    });
  });

  it("keeps assignments within their tenant", async () => {
    await withTenancy(async ({ tenancy, schema, organisation }) => {
      const north = await organisation("org-north");
      const south = await organisation("org-south");
      const northAccess = tenancy.forTenant("org-north").candidateRecords;
      const southAccess = tenancy.forTenant("org-south").candidateRecords;
      await northAccess.assignMember({ workspaceId: "record-1", memberId: north.coachId });

      // The south tenant has its own record-1 but cannot see or use the north tenant's members.
      await expect(southAccess.listRecordMembers("record-1")).resolves.toEqual([]);
      await expect(
        southAccess.assignMember({ workspaceId: "record-1", memberId: north.coachId }),
      ).rejects.toEqual(refusedWith("member_not_found"));
      await expect(southAccess.listMemberRecords(north.coachId)).rejects.toEqual(
        refusedWith("member_not_found"),
      );
      await expect(
        southAccess.unassignMember({ workspaceId: "record-1", memberId: north.coachId }),
      ).resolves.toBe(false);

      await southAccess.assignMember({ workspaceId: "record-1", memberId: south.coachId });
      await expect(northAccess.listRecordMembers("record-1")).resolves.toEqual([
        expect.objectContaining({ memberId: north.coachId }),
      ]);

      // Row-level security refuses a row a tenant's session writes for another tenant.
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await expect(
          pool
            .forTenant("org-south")
            .query(
              "INSERT INTO candidate_record_assignments (tenant_id, workspace_id, member_id) VALUES ('org-north', 'record-1', $1)",
              [north.ownerId],
            ),
        ).rejects.toThrow(/row-level security/u);
      } finally {
        await pool.close();
      }
      const [counts] = await schema.admin.query(
        "SELECT count(*) FILTER (WHERE tenant_id = 'org-north') AS north, count(*) FILTER (WHERE tenant_id = 'org-south') AS south FROM candidate_record_assignments",
      );
      expect(counts).toEqual({ north: "1", south: "1" });
    });
  });

  it("lists every record the tenant's API created, assigned or not", async () => {
    await withTenancy(async ({ tenancy, organisation }) => {
      await organisation("org-north");
      await organisation("org-south");
      const north = tenancy.forTenant("org-north");
      const south = tenancy.forTenant("org-south");
      // A record is its hosted workspace reference's configuration; other settings do not count.
      await north.workspaceSettings.write(
        "/tenants/org-north/workspaces/record-b",
        "workspace.json",
        "{}",
      );
      await north.workspaceSettings.write(
        "/tenants/org-north/workspaces/record-a",
        "workspace.json",
        "{}",
      );
      await north.workspaceSettings.write(
        "/tenants/org-north/workspaces/record-c",
        "writing-policy.md",
        "#",
      );
      await north.workspaceSettings.write(
        "/tenants/org-north/workspaces/a/b",
        "workspace.json",
        "{}",
      );
      await north.workspaceSettings.write(
        "/tenants/org-other/workspaces/record-d",
        "workspace.json",
        "{}",
      );
      await south.workspaceSettings.write(
        "/tenants/org-south/workspaces/record-e",
        "workspace.json",
        "{}",
      );

      await expect(north.candidateRecords.listRecords()).resolves.toEqual(["record-a", "record-b"]);
      await expect(south.candidateRecords.listRecords()).resolves.toEqual(["record-e"]);
    });
  });

  it("removes a member's assignments when the member leaves the organisation", async () => {
    await withTenancy(async ({ tenancy, directory, organisation }) => {
      const { ownerId, coachId } = await organisation("org-north");
      const north = tenancy.forTenant("org-north").candidateRecords;
      await north.assignMember({ workspaceId: "record-1", memberId: coachId });
      await north.assignMember({ workspaceId: "record-1", memberId: ownerId });

      await directory.removeMember({
        organisationId: "org-north",
        memberId: coachId,
        actorRole: "owner",
      });

      await expect(north.listRecordMembers("record-1")).resolves.toEqual([
        expect.objectContaining({ memberId: ownerId }),
      ]);
      await expect(north.listMemberRecords(coachId)).rejects.toEqual(
        refusedWith("member_not_found"),
      );
    });
  });
});
