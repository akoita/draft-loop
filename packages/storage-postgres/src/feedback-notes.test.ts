import { describe, expect, it } from "vitest";
import { seedTenant } from "./erasure-test-seed.js";
import { createSqlPool } from "./sql-client.js";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const now = new Date("2026-11-16T10:00:00.000Z");

describe.runIf(connectionString !== undefined)("Postgres feedback notes (#2828)", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (
      directory: PostgresTenantDirectory,
      schema: Awaited<ReturnType<typeof createTestSchema>>,
    ) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "feedback_notes");
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

  it("stores a trimmed note in the member's organisation and lists the newest first", async () => {
    await withDirectory(async ({ feedback }) => {
      await feedback.send({
        organisationId: "org-north",
        memberId: "member-1",
        category: "bug",
        screen: "review",
        text: "  The export button does nothing.  ",
        now,
      });
      await feedback.send({
        organisationId: "org-south",
        memberId: "member-2",
        category: null,
        screen: "agent",
        text: "A later note.",
        now: new Date(now.getTime() + 60_000),
      });

      const notes = await feedback.listNewest(10);

      expect(notes).toEqual([
        {
          noteId: expect.any(String),
          kind: "note",
          organisationId: "org-south",
          memberId: "member-2",
          category: null,
          screen: "agent",
          text: "A later note.",
          transcript: null,
          sentAt: "2026-11-16T10:01:00.000Z",
        },
        {
          noteId: expect.any(String),
          kind: "note",
          organisationId: "org-north",
          memberId: "member-1",
          category: "bug",
          screen: "review",
          text: "The export button does nothing.",
          transcript: null,
          sentAt: now.toISOString(),
        },
      ]);
      await expect(feedback.listNewest(1)).resolves.toHaveLength(1);
    });
  });

  it("refuses an empty or too long note", async () => {
    await withDirectory(async ({ feedback }) => {
      const note = {
        organisationId: "org-north",
        memberId: "member-1",
        category: null,
        screen: "home",
        now,
      };
      await expect(feedback.send({ ...note, text: "   " })).rejects.toThrow(/1 to 2000/u);
      await expect(feedback.send({ ...note, text: "x".repeat(2_001) })).rejects.toThrow(
        /1 to 2000/u,
      );
      await expect(feedback.listNewest(10)).resolves.toEqual([]);
    });
  });

  it("refuses a note into another organisation than the session's", async () => {
    await withDirectory(async (_directory, schema) => {
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await expect(
          pool.forTenant("org-north").query(
            `INSERT INTO feedback_notes (tenant_id, id, member_id, screen, body, sent_at)
             VALUES ('org-south', 'note-x', 'member-1', 'home', 'Forged.', now())`,
          ),
        ).rejects.toThrow(/row-level security/u);
      } finally {
        await pool.close();
      }
    });
  });

  it("erases an organisation's notes with the organisation and keeps the others", async () => {
    await withDirectory(async ({ feedback }, schema) => {
      await seedTenant(schema.admin, "org-north");
      await seedTenant(schema.admin, "org-south");
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await pool.forTenant("org-north").query("SELECT erase_tenant_remainder()");
      } finally {
        await pool.close();
      }

      const notes = await feedback.listNewest(10);
      expect(notes.map(({ organisationId }) => organisationId)).toEqual(["org-south"]);
    });
  });

  it("stores a support ticket with its transcript and lists it with the notes (#2883)", async () => {
    await withDirectory(async ({ feedback }) => {
      const ticket = await feedback.openSupportTicket({
        organisationId: "org-north",
        memberId: "member-1",
        summary: "  Charged twice for a credit pack.  ",
        transcript: [
          { role: "member", text: "I was charged twice." },
          { role: "assistant", text: "I can hand this to a person." },
        ],
        now,
      });

      expect(ticket).toEqual({
        noteId: expect.any(String),
        kind: "support",
        organisationId: "org-north",
        memberId: "member-1",
        category: null,
        screen: "support",
        text: "Charged twice for a credit pack.",
        transcript: [
          { role: "member", text: "I was charged twice." },
          { role: "assistant", text: "I can hand this to a person." },
        ],
        sentAt: now.toISOString(),
      });
      await expect(feedback.listNewest(10)).resolves.toEqual([ticket]);
    });
  });

  it("refuses an empty summary or a transcript over its bounds (#2883)", async () => {
    await withDirectory(async ({ feedback }) => {
      const ticket = { organisationId: "org-north", memberId: "member-1", now };
      await expect(
        feedback.openSupportTicket({ ...ticket, summary: " ", transcript: [] }),
      ).rejects.toThrow(/1 to 800/u);
      await expect(
        feedback.openSupportTicket({
          ...ticket,
          summary: "Help",
          transcript: Array.from({ length: 21 }, () => ({ role: "member" as const, text: "x" })),
        }),
      ).rejects.toThrow(/at most 20 turns/u);
      await expect(
        feedback.openSupportTicket({
          ...ticket,
          summary: "Help",
          transcript: [{ role: "member", text: "x".repeat(2_001) }],
        }),
      ).rejects.toThrow(/at most 20 turns/u);
    });
  });

  it("deletes support tickets past their keep period in every organisation, and no notes (#2883)", async () => {
    await withDirectory(async ({ feedback }) => {
      const old = new Date("2026-01-10T10:00:00.000Z");
      const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const organisationId of ["org-north", "org-south"]) {
        await feedback.openSupportTicket({
          organisationId,
          memberId: "member-1",
          summary: "Old ticket",
          transcript: [],
          now: old,
        });
      }
      await feedback.send({
        organisationId: "org-north",
        memberId: "member-1",
        category: null,
        screen: "home",
        text: "An old note stays.",
        now: old,
      });
      await feedback.openSupportTicket({
        organisationId: "org-north",
        memberId: "member-1",
        summary: "Recent ticket",
        transcript: [],
        now: recent,
      });

      await expect(
        feedback.deleteSupportTicketsBefore(new Date("2026-02-01T00:00:00.000Z")),
      ).resolves.toBe(2);
      // The policy keeps a ticket younger than 90 days whatever cutoff the caller passes.
      await expect(feedback.deleteSupportTicketsBefore(new Date())).resolves.toBe(0);

      const left = await feedback.listNewest(10);
      expect(left.map(({ kind, text }) => `${kind}:${text}`)).toEqual([
        "support:Recent ticket",
        "note:An old note stays.",
      ]);
    });
  });
});
