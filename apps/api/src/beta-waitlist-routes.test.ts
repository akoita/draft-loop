import type { BetaWaitlist } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import {
  betaWaitlistConsentVersion,
  waitlistConfirmPath,
  waitlistJoinsPerWindow,
  waitlistPath,
} from "./beta-waitlist-routes.js";
import type { InviteMailer } from "./invite-mail.js";
import { cloudLoggingOptions } from "./logging.js";
import type { WaitlistConfirmMailer } from "./waitlist-confirm-mail.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = { authorization: `Bearer ${ownerToken}` };

let app: FastifyInstance;
let lines: Record<string, unknown>[];

/** `placed`: emails that hold an open or redeemed invite, which the store refuses to list. */
function fakeWaitlist(placed: readonly string[] = []) {
  const listed = new Set<string>();
  /** Unconfirmed sign-ups: email by token hash, and the emails each address was sent. */
  const pending = new Map<string, string>();
  const sends = new Map<string, number>();
  const waitlist: BetaWaitlist = {
    join: vi.fn<BetaWaitlist["join"]>(async ({ email }) => {
      if (!email.includes("@")) {
        throw Object.assign(new Error("bad"), { name: "TenantDirectoryError" });
      }
      const key = email.trim().toLowerCase();
      if (listed.has(key) || placed.includes(key)) return false;
      listed.add(key);
      return true;
    }),
    list: vi.fn<BetaWaitlist["list"]>(async () => [
      {
        entryId: "entry-1",
        email: "ada@example.test",
        consentVersion: betaWaitlistConsentVersion,
        joinedAt: "2026-11-08T10:00:00.000Z",
      },
    ]),
    count: vi.fn<BetaWaitlist["count"]>(async () => 1),
    invite: vi.fn<BetaWaitlist["invite"]>(async ({ entryId }) =>
      entryId === "entry-1"
        ? {
            invite: {
              inviteId: "invite-1",
              email: "ada@example.test",
              createdAt: "2026-11-08T10:00:00.000Z",
              state: "open",
            },
            code: "ABCDEFGHJKMNPQRS",
          }
        : undefined,
    ),
    deleteJoinedBefore: vi.fn(async () => 0),
    joinUnconfirmed: vi.fn<BetaWaitlist["joinUnconfirmed"]>(
      async ({ email, tokenHash, maxSends }) => {
        if (!email.includes("@")) {
          throw Object.assign(new Error("bad"), { name: "TenantDirectoryError" });
        }
        const key = email.trim().toLowerCase();
        const sent = sends.get(key) ?? 0;
        if (listed.has(key) || placed.includes(key) || sent >= maxSends) return "skip";
        sends.set(key, sent + 1);
        pending.set(tokenHash, key);
        return "send";
      },
    ),
    confirm: vi.fn<BetaWaitlist["confirm"]>(async ({ tokenHash }) => {
      const key = pending.get(tokenHash);
      if (key === undefined) return "unknown";
      if (listed.has(key)) return "again";
      listed.add(key);
      return "confirmed";
    }),
    deleteUnconfirmedBefore: vi.fn(async () => 0),
  };
  return waitlist;
}

async function start(
  waitlist: BetaWaitlist,
  inviteMailer?: InviteMailer,
  waitlistConfirmMailer?: WaitlistConfirmMailer,
): Promise<void> {
  lines = [];
  app = await buildApi({
    ownerToken,
    betaWaitlist: waitlist,
    ...(inviteMailer === undefined ? {} : { inviteMailer }),
    ...(waitlistConfirmMailer === undefined ? {} : { waitlistConfirmMailer }),
    logger: cloudLoggingOptions({
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    }),
  });
}

const join = (payload: Record<string, unknown>, from = "203.0.113.9") =>
  app.inject({ method: "POST", url: waitlistPath, payload, remoteAddress: from });

afterEach(async () => {
  await app.close();
});

describe("the beta waitlist (#2566)", () => {
  it("lists a visitor without a credential, with the consent version", async () => {
    const waitlist = fakeWaitlist();
    await start(waitlist);

    const response = await join({ email: "Ada@Example.Test", consent: true });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ listed: true, confirm: false });
    expect(waitlist.join).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "Ada@Example.Test",
        consentVersion: betaWaitlistConsentVersion,
      }),
    );
    expect(JSON.stringify(lines)).not.toContain("example.test");
  });

  it("answers a duplicate email the same way, and refuses no consent or a bad address", async () => {
    await start(fakeWaitlist());

    const first = await join({ email: "ada@example.test", consent: true });
    const again = await join({ email: "ada@example.test", consent: true });

    expect(again.statusCode).toBe(first.statusCode);
    expect(again.json()).toEqual(first.json());
    expect((await join({ email: "ada@example.test", consent: false })).statusCode).toBe(400);
    expect((await join({ email: "ada@example.test" })).statusCode).toBe(400);
    expect((await join({ email: "not an address", consent: true })).statusCode).toBe(400);
  });

  it("limits joins from one address", async () => {
    await start(fakeWaitlist());
    for (let index = 0; index < waitlistJoinsPerWindow; index += 1) {
      await join({ email: `person${index}@example.test`, consent: true });
    }

    expect((await join({ email: "late@example.test", consent: true })).statusCode).toBe(429);
    expect(
      (await join({ email: "other@example.test", consent: true }, "198.51.100.4")).statusCode,
    ).toBe(202);
  });

  it("lets the operator list entries and turn one into an invite", async () => {
    const waitlist = fakeWaitlist();
    await start(waitlist);

    expect((await app.inject({ method: "GET", url: "/v1/operator/waitlist" })).statusCode).toBe(
      401,
    );
    const listed = await app.inject({
      method: "GET",
      url: "/v1/operator/waitlist",
      headers: authorization,
    });
    expect(listed.json()).toEqual({
      entries: [expect.objectContaining({ entryId: "entry-1" })],
      total: 1,
    });
    expect(waitlist.list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    await app.inject({
      method: "GET",
      url: "/v1/operator/waitlist?limit=20&offset=40&q=ada",
      headers: authorization,
    });
    expect(waitlist.list).toHaveBeenLastCalledWith({ limit: 20, offset: 40, query: "ada" });
    expect(waitlist.count).toHaveBeenLastCalledWith("ada");
    // Each list read is audited without its search text (#2954).
    expect(lines.flatMap((line) => (line.audit === undefined ? [] : [line.audit]))).toEqual([
      { action: "waitlist_listed", actor: "owner-token", listed: 1, searched: false },
      { action: "waitlist_listed", actor: "owner-token", listed: 1, searched: true },
    ]);
    expect(JSON.stringify(lines)).not.toContain('"ada"');

    const invited = await app.inject({
      method: "POST",
      url: "/v1/operator/waitlist/entry-1/invite",
      headers: authorization,
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({
      invite: { inviteId: "invite-1", state: "open" },
      code: "ABCDEFGHJKMNPQRS",
      emailed: false,
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/operator/waitlist/entry-9/invite",
      headers: authorization,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("emails the invite's person a link with the code where mail is on", async () => {
    const mailer = vi.fn<InviteMailer>(async () => true);
    await start(fakeWaitlist(), mailer);

    const invited = await app.inject({
      method: "POST",
      url: "/v1/operator/waitlist/entry-1/invite",
      headers: authorization,
    });

    expect(invited.json()).toMatchObject({ code: "ABCDEFGHJKMNPQRS", emailed: true });
    expect(mailer).toHaveBeenCalledWith({
      email: expect.any(String),
      code: "ABCDEFGHJKMNPQRS",
    });
  });

  it("emails a confirmation link where mail is on, and lists the entry once it is opened", async () => {
    const waitlist = fakeWaitlist();
    const mailer = vi.fn<WaitlistConfirmMailer>(async () => true);
    await start(waitlist, undefined, mailer);

    const joined = await join({ email: "ada@example.test", consent: true, locale: "fr" });

    expect(joined.statusCode).toBe(202);
    expect(joined.json()).toEqual({ listed: true, confirm: true });
    expect(waitlist.join).not.toHaveBeenCalled();
    const [sent] = mailer.mock.calls[0] ?? [];
    expect(sent).toMatchObject({ email: "ada@example.test", locale: "fr" });
    const token = sent?.token ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    // The database receives only the token's hash.
    const [stored] = vi.mocked(waitlist.joinUnconfirmed).mock.calls[0] ?? [];
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored?.tokenHash).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain("example.test");

    const confirm = (value: string) =>
      app.inject({ method: "POST", url: waitlistConfirmPath, payload: { token: value } });
    expect((await confirm("x".repeat(32))).statusCode).toBe(404);
    const confirmed = await confirm(token);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ confirmed: true });
    // A second click still works, but only the first is logged as new for operator alerts.
    expect((await confirm(token)).statusCode).toBe(200);
    const confirms = lines.filter((line) => line.event === "waitlist_confirm");
    expect(confirms.map(({ confirmed, first }) => ({ confirmed, first }))).toEqual([
      { confirmed: false, first: false },
      { confirmed: true, first: true },
      { confirmed: true, first: false },
    ]);
  });

  it("sends no second link to a confirmed address, and answers the same", async () => {
    const mailer = vi.fn<WaitlistConfirmMailer>(async () => true);
    await start(fakeWaitlist(), undefined, mailer);

    const first = await join({ email: "ada@example.test", consent: true });
    const token = mailer.mock.calls[0]?.[0].token ?? "";
    await app.inject({ method: "POST", url: waitlistConfirmPath, payload: { token } });
    const again = await join({ email: "ada@example.test", consent: true });

    expect(again.json()).toEqual(first.json());
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  it("answers an account's or an invitee's email like a new one, and emails them nothing", async () => {
    const mailer = vi.fn<WaitlistConfirmMailer>(async () => true);
    await start(fakeWaitlist(["ada@example.test", "bob@example.test"]), undefined, mailer);

    const fresh = await join({ email: "cy@example.test", consent: true });
    const member = await join({ email: " Ada@Example.Test ", consent: true });
    const invitee = await join({ email: "bob@example.test", consent: true });

    expect(member.statusCode).toBe(202);
    expect(member.json()).toEqual(fresh.json());
    expect(invitee.json()).toEqual(fresh.json());
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0]?.[0]).toMatchObject({ email: "cy@example.test" });
  });

  it("answers an account's email the same where the server sends no mail", async () => {
    await start(fakeWaitlist(["ada@example.test"]));

    const fresh = await join({ email: "cy@example.test", consent: true });
    const member = await join({ email: "ada@example.test", consent: true });

    expect(member.statusCode).toBe(202);
    expect(member.json()).toEqual(fresh.json());
  });

  it("sends an unconfirmed address a fresh link on a later join, up to the cap", async () => {
    const mailer = vi.fn<WaitlistConfirmMailer>(async () => true);
    await start(fakeWaitlist(), undefined, mailer);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await join({ email: "ada@example.test", consent: true })).statusCode).toBe(202);
    }

    // The fake store caps at three sends, as the real one does (spacing is tested there).
    expect(mailer).toHaveBeenCalledTimes(3);
    const tokens = new Set(mailer.mock.calls.map(([sent]) => sent.token));
    expect(tokens.size).toBe(3);
  });
});
