import type { BetaWaitlist } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import {
  betaWaitlistConsentVersion,
  waitlistJoinsPerWindow,
  waitlistPath,
} from "./beta-waitlist-routes.js";
import { cloudLoggingOptions } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = { authorization: `Bearer ${ownerToken}` };

let app: FastifyInstance;
let lines: Record<string, unknown>[];

function fakeWaitlist() {
  const listed = new Set<string>();
  const waitlist: BetaWaitlist = {
    join: vi.fn<BetaWaitlist["join"]>(async ({ email }) => {
      if (!email.includes("@")) {
        throw Object.assign(new Error("bad"), { name: "TenantDirectoryError" });
      }
      const key = email.trim().toLowerCase();
      if (listed.has(key)) return false;
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
  };
  return waitlist;
}

async function start(waitlist: BetaWaitlist): Promise<void> {
  lines = [];
  app = await buildApi({
    ownerToken,
    betaWaitlist: waitlist,
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
    expect(response.json()).toEqual({ listed: true });
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
    expect(listed.json()).toEqual({ entries: [expect.objectContaining({ entryId: "entry-1" })] });

    const invited = await app.inject({
      method: "POST",
      url: "/v1/operator/waitlist/entry-1/invite",
      headers: authorization,
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({
      invite: { inviteId: "invite-1", state: "open" },
      code: "ABCDEFGHJKMNPQRS",
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/operator/waitlist/entry-9/invite",
      headers: authorization,
    });
    expect(unknown.statusCode).toBe(404);
  });
});
