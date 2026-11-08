import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { BetaSignUpView } from "./beta-sign-up.js";
import { redeemInvite, signUpRefusal } from "./beta-sign-up-model.js";

const refused = (status: number, code: string) => new ApiRequestError(status, code, "Refused.");

describe("beta sign-up refusals", () => {
  it.each([
    [404, "invite_unknown", "No invite has that code", true],
    [409, "invite_used", "already been used", false],
    [403, "invite_revoked", "withdrawn", false],
    [403, "invite_email_mismatch", "another email address", false],
    [409, "beta_full", "The beta is full for now", false],
    [429, "rate_limited", "Wait 15 minutes", false],
  ] as const)("%i %s says what to do next", (status, code, text, retry) => {
    expect(signUpRefusal(refused(status, code))).toEqual({
      message: expect.stringContaining(text),
      retry,
    });
  });

  it("leaves other errors to the generic message", () => {
    expect(signUpRefusal(refused(500, "internal"))).toBeUndefined();
    expect(signUpRefusal(new Error("offline"))).toBeUndefined();
  });

  it("sends the trimmed code to the sign-up route", async () => {
    const call = vi.fn(async () => ({}) as never);

    await redeemInvite({ call }, "  ABCD-EFGH ");

    expect(call).toHaveBeenCalledWith("POST /v1/sign-up", { body: { code: "ABCD-EFGH" } });
  });
});

describe("beta sign-up screen", () => {
  const handlers = { onCodeChange: () => {}, onSubmit: () => {}, onSignOut: () => {} };

  it("asks for the code and keeps the button off until one is typed", () => {
    const html = renderToStaticMarkup(<BetaSignUpView code="" busy={false} {...handlers} />);

    expect(html).toContain("Invite code");
    expect(html).toMatch(/<button type="submit" disabled="">Create my account/u);
    expect(html).toContain("Sign out");
  });

  it("shows a refusal as an alert", () => {
    const html = renderToStaticMarkup(
      <BetaSignUpView code="X" busy={false} notice="The beta is full for now." {...handlers} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("The beta is full for now.");
  });
});
