import { describe, expect, it } from "vitest";

import type { ResolveSignIn } from "./oidc-sign-in.js";
import { readPreviousIssuers, withPreviousIssuers } from "./previous-issuers.js";

const current = "https://auth.new.example/realms/r";
const previous = "https://auth.old.example/realms/r";
const member = { tenantId: "t", memberId: "m", role: "owner" as const };

describe("previous sign-in issuers", () => {
  it("reads comma-separated https URLs, and none by default", () => {
    expect(readPreviousIssuers(undefined)).toEqual([]);
    expect(readPreviousIssuers(` ${previous} ,`)).toEqual([previous]);
    expect(() => readPreviousIssuers("http://old.example/realms/r")).toThrow(/https URLs only/);
    expect(() => readPreviousIssuers("old.example")).toThrow(/https URLs only/);
  });

  it("finds a member recorded under an earlier issuer, without the email", async () => {
    const calls: unknown[] = [];
    const resolve: ResolveSignIn = async (identity) => {
      calls.push(identity);
      return identity.issuer === previous ? member : undefined;
    };
    const found = await withPreviousIssuers(resolve, [previous])({
      issuer: current,
      subject: "s",
      email: "a@example.com",
      emailVerified: true,
    });
    expect(found).toEqual(member);
    expect(calls).toEqual([
      { issuer: current, subject: "s", email: "a@example.com", emailVerified: true },
      { issuer: previous, subject: "s", emailVerified: false },
    ]);
  });

  it("asks only the current issuer when it has the member or none are listed", async () => {
    let calls = 0;
    const resolve: ResolveSignIn = async () => {
      calls += 1;
      return member;
    };
    await withPreviousIssuers(resolve, [previous])({
      issuer: current,
      subject: "s",
      emailVerified: false,
    });
    expect(calls).toBe(1);
    expect(withPreviousIssuers(resolve, [])).toBe(resolve);
  });
});
