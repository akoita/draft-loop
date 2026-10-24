import { type MemberRole, TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "./sql-client.js";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const issuer = "https://identity.example.test/realms/draft-loop";

function refusedWith(code: string) {
  return expect.objectContaining({ name: "TenantDirectoryError", code });
}

describe.runIf(connectionString !== undefined)("Postgres tenant directory", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (directory: PostgresTenantDirectory, schema: TestSchema) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "tenant_directory");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await work(directory, schema);
    } finally {
      await directory.close();
      await schema.drop();
    }
  }

  it("creates an organisation with an invited owner and lists its members", async () => {
    await withDirectory(async (directory) => {
      const created = await directory.createOrganisation({
        organisationId: "org-north",
        name: "  North Coaching ",
        firstOwnerEmail: " Owner@North.Example.Test ",
      });
      expect(created.organisation).toMatchObject({
        organisationId: "org-north",
        name: "North Coaching",
      });
      expect(created.firstOwner).toMatchObject({
        organisationId: "org-north",
        email: "owner@north.example.test",
        role: "owner",
        status: "invited",
      });
      expect(created.firstOwner.activatedAt).toBeUndefined();

      const invited = await directory.inviteMember({
        organisationId: "org-north",
        email: "Coach@North.Example.Test",
        role: "member",
      });
      expect(invited).toMatchObject({ email: "coach@north.example.test", status: "invited" });
      const members = await directory.listMembers("org-north");
      expect(members.map((member) => member.email)).toEqual([
        "owner@north.example.test",
        "coach@north.example.test",
      ]);

      await expect(
        directory.createOrganisation({
          organisationId: "org-north",
          name: "Again",
          firstOwnerEmail: "other@north.example.test",
        }),
      ).rejects.toEqual(refusedWith("organisation_exists"));
      await expect(
        directory.inviteMember({
          organisationId: "org-north",
          email: " coach@north.example.test",
          role: "admin",
        }),
      ).rejects.toEqual(refusedWith("member_exists"));
      await expect(directory.listMembers("org-missing")).rejects.toEqual(
        refusedWith("organisation_not_found"),
      );
      await expect(
        directory.inviteMember({
          organisationId: "org-north",
          email: "not-an-email",
          role: "member",
        }),
      ).rejects.toBeInstanceOf(TenantDirectoryError);
      await expect(directory.listMembers("../org")).rejects.toEqual(refusedWith("invalid_input"));
    });
  });

  it("claims an invite on the first verified sign-in, then resolves by issuer and subject", async () => {
    await withDirectory(async (directory) => {
      await directory.createOrganisation({
        organisationId: "org-north",
        name: "North",
        firstOwnerEmail: "owner@north.example.test",
      });
      const coach = await directory.inviteMember({
        organisationId: "org-north",
        email: "coach@north.example.test",
        role: "admin",
      });

      // An unverified email, or a verified one that was not invited, claims nothing.
      await expect(
        directory.resolveSignIn({
          issuer,
          subject: "subject-coach",
          email: "coach@north.example.test",
          emailVerified: false,
        }),
      ).resolves.toBeUndefined();
      await expect(
        directory.resolveSignIn({
          issuer,
          subject: "subject-coach",
          email: "someone@north.example.test",
          emailVerified: true,
        }),
      ).resolves.toBeUndefined();
      await expect(
        directory.resolveSignIn({ issuer, subject: "subject-coach", emailVerified: true }),
      ).resolves.toBeUndefined();

      await expect(
        directory.resolveSignIn({
          issuer,
          subject: "subject-coach",
          email: " Coach@North.Example.Test",
          emailVerified: true,
        }),
      ).resolves.toEqual({ tenantId: "org-north", memberId: coach.memberId, role: "admin" });
      const [, active] = await directory.listMembers("org-north");
      expect(active).toMatchObject({ memberId: coach.memberId, status: "active" });
      expect(active?.activatedAt).toEqual(expect.any(String));

      // Later sign-ins resolve by identity, whatever email the token carries.
      await expect(
        directory.resolveSignIn({
          issuer,
          subject: "subject-coach",
          email: "renamed@elsewhere.example.test",
          emailVerified: false,
        }),
      ).resolves.toEqual({ tenantId: "org-north", memberId: coach.memberId, role: "admin" });
      // The same subject from another issuer is another person.
      await expect(
        directory.resolveSignIn({
          issuer: "https://other.example.test",
          subject: "subject-coach",
          emailVerified: false,
        }),
      ).resolves.toBeUndefined();
    });
  });

  it("keeps a person to one organisation and two concurrent first sign-ins to one claim", async () => {
    await withDirectory(async (directory) => {
      for (const organisationId of ["org-north", "org-south"]) {
        await directory.createOrganisation({
          organisationId,
          name: organisationId,
          firstOwnerEmail: `owner@${organisationId}.example.test`,
        });
        await directory.inviteMember({
          organisationId,
          email: "coach@shared.example.test",
          role: "member",
        });
      }
      const identity = {
        issuer,
        subject: "subject-shared",
        email: "coach@shared.example.test",
        emailVerified: true,
      };
      const [first, second] = await Promise.all([
        directory.resolveSignIn(identity),
        directory.resolveSignIn(identity),
      ]);
      expect(first).toBeDefined();
      expect(second).toEqual(first);
      await expect(directory.resolveSignIn(identity)).resolves.toEqual(first);

      const statuses = await Promise.all(
        ["org-north", "org-south"].map(async (organisationId) =>
          (await directory.listMembers(organisationId))
            .filter((member) => member.email === "coach@shared.example.test")
            .map((member) => member.status),
        ),
      );
      expect(statuses.flat().sort()).toEqual(["active", "invited"]);
    });
  });

  it("changes roles and removes members, and keeps at least one owner", async () => {
    await withDirectory(async (directory) => {
      const { firstOwner } = await directory.createOrganisation({
        organisationId: "org-north",
        name: "North",
        firstOwnerEmail: "owner@north.example.test",
      });
      await expect(
        directory.changeRole({
          organisationId: "org-north",
          memberId: firstOwner.memberId,
          role: "admin",
          actorRole: "owner",
        }),
      ).rejects.toEqual(refusedWith("last_owner"));
      await expect(
        directory.removeMember({
          organisationId: "org-north",
          memberId: firstOwner.memberId,
          actorRole: "owner",
        }),
      ).rejects.toEqual(refusedWith("last_owner"));

      const coach = await directory.inviteMember({
        organisationId: "org-north",
        email: "coach@north.example.test",
        role: "member",
      });
      await expect(
        directory.resolveSignIn({
          issuer,
          subject: "subject-coach",
          email: "coach@north.example.test",
          emailVerified: true,
        }),
      ).resolves.toMatchObject({ role: "member" });
      await expect(
        directory.changeRole({
          organisationId: "org-north",
          memberId: coach.memberId,
          role: "owner",
          actorRole: "owner",
        }),
      ).resolves.toMatchObject({ role: "owner", status: "active" });
      await expect(
        directory.resolveSignIn({ issuer, subject: "subject-coach", emailVerified: false }),
      ).resolves.toMatchObject({ role: "owner" });

      // With a second owner, the first may step down and then leave.
      await expect(
        directory.changeRole({
          organisationId: "org-north",
          memberId: firstOwner.memberId,
          role: "member",
          actorRole: "owner",
        }),
      ).resolves.toMatchObject({ role: "member" });
      await directory.removeMember({
        organisationId: "org-north",
        memberId: firstOwner.memberId,
        actorRole: "owner",
      });
      await expect(
        directory.removeMember({
          organisationId: "org-north",
          memberId: coach.memberId,
          actorRole: "owner",
        }),
      ).rejects.toEqual(refusedWith("last_owner"));
      await expect(
        directory.removeMember({
          organisationId: "org-north",
          memberId: firstOwner.memberId,
          actorRole: "owner",
        }),
      ).rejects.toEqual(refusedWith("member_not_found"));
      await expect(
        directory.changeRole({
          organisationId: "org-south",
          memberId: coach.memberId,
          role: "admin",
          actorRole: "owner",
        }),
      ).rejects.toEqual(refusedWith("organisation_not_found"));

      // A removed member can no longer sign in.
      const admin = await directory.inviteMember({
        organisationId: "org-north",
        email: "admin@north.example.test",
        role: "admin",
      });
      const adminIdentity = {
        issuer,
        subject: "subject-admin",
        email: "admin@north.example.test",
        emailVerified: true,
      };
      await expect(directory.resolveSignIn(adminIdentity)).resolves.toMatchObject({
        role: "admin",
      });
      await directory.removeMember({
        organisationId: "org-north",
        memberId: admin.memberId,
        actorRole: "owner",
      });
      await expect(directory.resolveSignIn(adminIdentity)).resolves.toBeUndefined();
      expect((await directory.listMembers("org-north")).map((member) => member.email)).toEqual([
        "coach@north.example.test",
      ]);
    });
  });

  it("checks the acting role against the target's role inside the change", async () => {
    await withDirectory(async (directory) => {
      const { firstOwner } = await directory.createOrganisation({
        organisationId: "org-north",
        name: "North",
        firstOwnerEmail: "owner@north.example.test",
      });
      const second = await directory.inviteMember({
        organisationId: "org-north",
        email: "second@north.example.test",
        role: "owner",
      });
      const coach = await directory.inviteMember({
        organisationId: "org-north",
        email: "coach@north.example.test",
        role: "member",
      });
      const change = (actorRole: MemberRole, memberId: string, role: MemberRole) =>
        directory.changeRole({ organisationId: "org-north", memberId, role, actorRole });
      const remove = (actorRole: MemberRole, memberId: string) =>
        directory.removeMember({ organisationId: "org-north", memberId, actorRole });

      // An admin neither touches an owner nor grants the owner role, even without a change.
      await expect(change("admin", firstOwner.memberId, "admin")).rejects.toEqual(
        refusedWith("forbidden"),
      );
      await expect(change("admin", firstOwner.memberId, "owner")).rejects.toEqual(
        refusedWith("forbidden"),
      );
      await expect(change("admin", coach.memberId, "owner")).rejects.toEqual(
        refusedWith("forbidden"),
      );
      await expect(remove("admin", second.memberId)).rejects.toEqual(refusedWith("forbidden"));
      // A member manages nobody.
      await expect(change("member", coach.memberId, "admin")).rejects.toEqual(
        refusedWith("forbidden"),
      );
      await expect(remove("member", coach.memberId)).rejects.toEqual(refusedWith("forbidden"));
      expect((await directory.listMembers("org-north")).map((member) => member.role)).toEqual([
        "owner",
        "owner",
        "member",
      ]);

      await expect(change("admin", coach.memberId, "admin")).resolves.toMatchObject({
        role: "admin",
      });
      await expect(remove("admin", coach.memberId)).resolves.toMatchObject({
        memberId: coach.memberId,
        role: "admin",
      });
    });
  });

  it("refuses an admin whose target became an owner after the route read it", async () => {
    await withDirectory(async (directory, { schema }) => {
      await directory.createOrganisation({
        organisationId: "org-north",
        name: "North",
        firstOwnerEmail: "owner@north.example.test",
      });
      const coach = await directory.inviteMember({
        organisationId: "org-north",
        email: "coach@north.example.test",
        role: "member",
      });
      const promoter = createSqlClient({
        connectionString: runtimeRoleUrl(url),
        schema,
        tenantId: "org-north",
        maxConnections: 1,
      });
      try {
        // The owner's promotion holds the organisation's lock while the admin's requests wait.
        let settled = 0;
        let waiting: Promise<unknown>[] = [];
        await promoter.transaction(async (executor) => {
          await executor.query("SELECT 1 FROM organisations WHERE id = 'org-north' FOR UPDATE");
          waiting = [
            directory.changeRole({
              organisationId: "org-north",
              memberId: coach.memberId,
              role: "member",
              actorRole: "admin",
            }),
            directory.removeMember({
              organisationId: "org-north",
              memberId: coach.memberId,
              actorRole: "admin",
            }),
          ].map((request) => request.finally(() => (settled += 1)));
          for (const request of waiting) request.catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(settled).toBe(0);
          await executor.query("UPDATE organisation_members SET role = 'owner' WHERE id = $1", [
            coach.memberId,
          ]);
        });
        const outcomes = await Promise.allSettled(waiting);
        expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
        for (const outcome of outcomes) {
          expect((outcome as PromiseRejectedResult).reason).toEqual(refusedWith("forbidden"));
        }
        expect((await directory.listMembers("org-north")).map((member) => member.role)).toEqual([
          "owner",
          "owner",
        ]);
      } finally {
        await promoter.close();
      }
    });
  });

  it("keeps the runtime role from reading another tenant's members or the directory function's rows", async () => {
    await withDirectory(async (directory, { schema }) => {
      for (const organisationId of ["org-north", "org-south"]) {
        await directory.createOrganisation({
          organisationId,
          name: organisationId,
          firstOwnerEmail: `owner@${organisationId}.example.test`,
        });
      }
      const runtime = createSqlClient({
        connectionString: runtimeRoleUrl(url),
        schema,
        tenantId: "org-south",
        maxConnections: 1,
      });
      const untenanted = createSqlClient({
        connectionString: runtimeRoleUrl(url),
        schema,
        maxConnections: 1,
      });
      try {
        await expect(
          runtime.query("SELECT tenant_id, email FROM organisation_members ORDER BY tenant_id"),
        ).resolves.toEqual([{ tenant_id: "org-south", email: "owner@org-south.example.test" }]);
        await expect(runtime.query("SELECT id FROM organisations")).resolves.toEqual([
          { id: "org-south" },
        ]);
        await expect(
          runtime.query(
            "UPDATE organisation_members SET role = 'member' WHERE tenant_id = 'org-north' RETURNING id",
          ),
        ).resolves.toEqual([]);
        await expect(
          runtime.query(
            "INSERT INTO organisation_members (tenant_id, id, email, role, status) VALUES ('org-north', 'intruder', 'intruder@north.example.test', 'owner', 'invited')",
          ),
        ).rejects.toThrow(/row-level security/u);
        await expect(
          untenanted.query("SELECT count(*) AS count FROM organisation_members"),
        ).resolves.toEqual([{ count: "0" }]);
      } finally {
        await runtime.close();
        await untenanted.close();
      }
    });
  });

  it("refuses to open as a role that row-level security does not bind", async () => {
    const { schema, drop } = await createTestSchema(url, "tenant_directory");
    try {
      await expect(
        createPostgresTenantDirectory({ connectionString: url, schema }),
      ).rejects.toThrow(/row-level security/u);
    } finally {
      await drop();
    }
  });
});
