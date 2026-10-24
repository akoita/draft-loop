import { describe, expect, it } from "vitest";
import type { PostgresTenancy } from "./postgres-storage.js";
import { createSqlPool } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";

function refusedWith(code: string) {
  return expect.objectContaining({ name: "KnowledgeBaseOwnersError", code });
}

describe.runIf(connectionString !== undefined)("Postgres knowledge base owners", () => {
  const url = connectionString ?? "";

  async function withTenancy(
    work: (context: {
      readonly tenancy: PostgresTenancy;
      readonly schema: TestSchema;
      readonly createBase: (tenantId: string, id: string) => Promise<void>;
    }) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "knowledge_owners");
    const tenancy = await schema.openTenancy();
    const createBase = async (tenantId: string, id: string) => {
      await tenancy.forTenant(tenantId).createCandidateKnowledgeBase({
        id,
        displayName: `Fictional notes ${id}`,
        isDefault: false,
        createdAt: at,
      });
    };
    try {
      await work({ tenancy, schema, createBase });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  }

  it("sets a base's owner once and lists the bases each record owns", async () => {
    await withTenancy(async ({ tenancy, createBase }) => {
      const owners = tenancy.forTenant("org-north").knowledgeBaseOwners;
      for (const id of ["kb-b", "kb-a", "kb-c", "kb-shared"]) await createBase("org-north", id);

      const first = await owners.setOwner({ knowledgeBaseId: "kb-b", workspaceId: "record-1" });
      expect(first).toEqual({
        knowledgeBaseId: "kb-b",
        workspaceId: "record-1",
        recordedAt: expect.any(String),
      });
      // The same owner again changes nothing; another owner is refused.
      await expect(
        owners.setOwner({ knowledgeBaseId: "kb-b", workspaceId: "record-1" }),
      ).resolves.toEqual(first);
      await expect(
        owners.setOwner({ knowledgeBaseId: "kb-b", workspaceId: "record-2" }),
      ).rejects.toEqual(refusedWith("owner_exists"));
      await owners.setOwner({ knowledgeBaseId: "kb-a", workspaceId: "record-1" });
      await owners.setOwner({ knowledgeBaseId: "kb-c", workspaceId: "record-2" });

      await expect(owners.ownerOf("kb-b")).resolves.toBe("record-1");
      await expect(owners.ownerOf("kb-shared")).resolves.toBeUndefined();
      await expect(owners.ownerOf("kb-never")).resolves.toBeUndefined();
      await expect(owners.basesOwnedBy(["record-1"])).resolves.toEqual(["kb-a", "kb-b"]);
      await expect(owners.basesOwnedBy(["record-2", "record-1"])).resolves.toEqual([
        "kb-a",
        "kb-b",
        "kb-c",
      ]);
      await expect(owners.basesOwnedBy([])).resolves.toEqual([]);
    });
  });

  it("refuses an unknown base and invalid ids", async () => {
    await withTenancy(async ({ tenancy }) => {
      const owners = tenancy.forTenant("org-north").knowledgeBaseOwners;
      await expect(
        owners.setOwner({ knowledgeBaseId: "kb-never", workspaceId: "record-1" }),
      ).rejects.toEqual(refusedWith("knowledge_base_not_found"));
      await expect(
        owners.setOwner({ knowledgeBaseId: "", workspaceId: "record-1" }),
      ).rejects.toEqual(refusedWith("invalid_input"));
      await expect(owners.basesOwnedBy([" record-1"])).rejects.toEqual(
        refusedWith("invalid_input"),
      );
    });
  });

  it("keeps owners within their tenant and drops them with their base", async () => {
    await withTenancy(async ({ tenancy, schema, createBase }) => {
      await createBase("org-north", "kb-1");
      await createBase("org-south", "kb-1");
      const north = tenancy.forTenant("org-north").knowledgeBaseOwners;
      const south = tenancy.forTenant("org-south").knowledgeBaseOwners;
      await north.setOwner({ knowledgeBaseId: "kb-1", workspaceId: "record-1" });

      // The south tenant's own kb-1 has no owner, and the north tenant's owner is out of reach.
      await expect(south.ownerOf("kb-1")).resolves.toBeUndefined();
      await expect(south.basesOwnedBy(["record-1"])).resolves.toEqual([]);
      await south.setOwner({ knowledgeBaseId: "kb-1", workspaceId: "record-9" });
      await expect(north.ownerOf("kb-1")).resolves.toBe("record-1");

      // Row-level security refuses a row a tenant's session writes for another tenant.
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await expect(
          pool
            .forTenant("org-south")
            .query(
              "INSERT INTO knowledge_base_owners (tenant_id, knowledge_base_id, workspace_id) VALUES ('org-north', 'kb-2', 'record-1')",
            ),
        ).rejects.toThrow(/row-level security/u);
      } finally {
        await pool.close();
      }

      await schema.admin.query(
        "DELETE FROM candidate_knowledge_bases WHERE tenant_id = 'org-north' AND id = 'kb-1'",
      );
      await expect(north.ownerOf("kb-1")).resolves.toBeUndefined();
      await expect(south.ownerOf("kb-1")).resolves.toBe("record-9");
    });
  });

  it("removes only a base that has no owner", async () => {
    await withTenancy(async ({ tenancy, createBase }) => {
      const tenant = tenancy.forTenant("org-north");
      for (const id of ["kb-orphan", "kb-owned"]) await createBase("org-north", id);
      await createBase("org-south", "kb-orphan");
      await tenant.knowledgeBaseOwners.setOwner({
        knowledgeBaseId: "kb-owned",
        workspaceId: "record-1",
      });

      await expect(tenant.knowledgeBaseOwners.removeUnowned("kb-owned")).resolves.toBe(false);
      await expect(tenant.knowledgeBaseOwners.removeUnowned("kb-never")).resolves.toBe(false);
      await expect(tenant.knowledgeBaseOwners.removeUnowned("kb-orphan")).resolves.toBe(true);
      await expect(tenant.knowledgeBaseOwners.removeUnowned("kb-orphan")).resolves.toBe(false);

      const remaining = async (tenantId: string) =>
        (await tenancy.forTenant(tenantId).listCandidateKnowledgeBases()).map(({ id }) => id);
      expect(await remaining("org-north")).toEqual(["kb-owned"]);
      // Another tenant's base of the same id is out of reach.
      expect(await remaining("org-south")).toEqual(["kb-orphan"]);
    });
  });
});
