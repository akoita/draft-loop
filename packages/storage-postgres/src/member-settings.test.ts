import { describe, expect, it } from "vitest";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres member settings", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (directory: PostgresTenantDirectory) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "member_settings");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await work(directory);
    } finally {
      await directory.close();
      await schema.drop();
    }
  }

  it("keeps each member's screen language, replaces it, and drops it with the member", async () => {
    await withDirectory(async (directory) => {
      const north = await directory.createOrganisation({
        organisationId: "org-north",
        name: "North Coaching",
        firstOwnerEmail: "owner@north.example.test",
      });
      const coach = await directory.inviteMember({
        organisationId: "org-north",
        email: "coach@north.example.test",
        role: "member",
      });
      const south = await directory.createOrganisation({
        organisationId: "org-south",
        name: "South Coaching",
        firstOwnerEmail: "owner@south.example.test",
      });
      const settings = directory.memberSettings;
      const coachKey = { organisationId: "org-north", memberId: coach.memberId };

      await expect(settings.readScreenLanguage(coachKey)).resolves.toBeUndefined();
      await settings.saveScreenLanguage({ ...coachKey, language: "fr" });
      await expect(settings.readScreenLanguage(coachKey)).resolves.toBe("fr");
      await settings.saveScreenLanguage({ ...coachKey, language: "en" });
      await expect(settings.readScreenLanguage(coachKey)).resolves.toBe("en");
      await expect(
        settings.readScreenLanguage({
          organisationId: "org-north",
          memberId: north.firstOwner.memberId,
        }),
      ).resolves.toBeUndefined();

      // Another organisation's member is not found from this one.
      await expect(
        settings.saveScreenLanguage({
          organisationId: "org-north",
          memberId: south.firstOwner.memberId,
          language: "fr",
        }),
      ).rejects.toMatchObject({ name: "TenantDirectoryError", code: "member_not_found" });
      await expect(
        settings.readScreenLanguage({
          organisationId: "org-north",
          memberId: south.firstOwner.memberId,
        }),
      ).resolves.toBeUndefined();

      await directory.removeMember({
        organisationId: "org-north",
        memberId: coach.memberId,
        actorRole: "owner",
      });
      await expect(settings.readScreenLanguage(coachKey)).resolves.toBeUndefined();
    });
  });
});
