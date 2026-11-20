import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { BetaSignUpView } from "./beta-sign-up.js";
import { acceptedTermsVersion, redeemInvite, signUpRefusal } from "./beta-sign-up-model.js";

const refused = (status: number, code: string) => new ApiRequestError(status, code, "Refused.");

describe("beta sign-up refusals", () => {
  it.each([
    [404, "invite_unknown", "No invite has that code", true],
    [409, "invite_used", "already been used", false],
    [403, "invite_revoked", "withdrawn", false],
    [403, "invite_email_mismatch", "another email address", false],
    [409, "beta_full", "The beta is full for now", false],
    [429, "rate_limited", "Wait 15 minutes", false],
    [400, "terms_not_accepted", "terms of use have changed", false],
  ] as const)("%i %s says what to do next", (status, code, text, retry) => {
    expect(signUpRefusal(refused(status, code))).toEqual({
      message: expect.stringContaining(text),
      retry,
    });
  });

  it("names the address the person is signed in with on a mismatch", () => {
    const error = new ApiRequestError(
      403,
      "invite_email_mismatch",
      "Refused.",
      undefined,
      undefined,
      {
        email: "ada@example.test",
      },
    );
    expect(signUpRefusal(error)?.message).toContain(
      "than ada@example.test, the one you are signed in with",
    );
  });

  it("leaves other errors to the generic message", () => {
    expect(signUpRefusal(refused(500, "internal"))).toBeUndefined();
    expect(signUpRefusal(new Error("offline"))).toBeUndefined();
  });

  it("sends the trimmed code and the accepted terms version to the sign-up route", async () => {
    const call = vi.fn(async () => ({}) as never);

    await redeemInvite({ call }, "  ABCD-EFGH ");
    await redeemInvite({ call });

    expect(call).toHaveBeenNthCalledWith(1, "POST /v1/sign-up", {
      body: { code: "ABCD-EFGH", accepted_terms: acceptedTermsVersion },
    });
    expect(call).toHaveBeenNthCalledWith(2, "POST /v1/sign-up", {
      body: { accepted_terms: acceptedTermsVersion },
    });
  });

  it("says no invite names the signed-in address when sign-up went without a code", () => {
    expect(signUpRefusal(refused(404, "invite_unknown"), true)?.message).toContain(
      "no invite for the email address you signed in with",
    );
  });
});

describe("beta sign-up screen", () => {
  const handlers = {
    onCodeChange: () => {},
    onAcceptedChange: () => {},
    onSubmit: () => {},
    onSignOut: () => {},
  };

  it("asks only for the terms by default, with the code one press away", () => {
    const html = renderToStaticMarkup(
      <BetaSignUpView code="" accepted busy={false} onAskCode={() => {}} {...handlers} />,
    );

    expect(html).not.toContain("Invite code");
    expect(html).toMatch(/<button type="submit">Create my account/u);
    expect(html).toContain("I have an invite code");
    expect(html).toContain("Sign out");
  });

  it("asks for the code when told to and keeps the button off until one is typed", () => {
    const html = renderToStaticMarkup(
      <BetaSignUpView code="" askCode accepted busy={false} {...handlers} />,
    );

    expect(html).toContain("Invite code");
    expect(html).toMatch(/<button type="submit" disabled="">Create my account/u);
    expect(html).not.toContain("I have an invite code");
  });

  it("shows a refusal as an alert", () => {
    const html = renderToStaticMarkup(
      <BetaSignUpView
        code="X"
        accepted={false}
        busy={false}
        notice="The beta is full for now."
        {...handlers}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("The beta is full for now.");
  });

  it("keeps the button off until the terms are accepted, and says where material goes", () => {
    const unticked = renderToStaticMarkup(
      <BetaSignUpView code="ABCD" askCode accepted={false} busy={false} {...handlers} />,
    );
    expect(unticked).toMatch(/<button type="submit" disabled="">Create my account/u);
    expect(unticked).toContain("outside the European Union");
    expect(unticked).toContain('href="/legal/terms"');
    expect(unticked).toContain('href="/legal/privacy"');

    const ticked = renderToStaticMarkup(
      <BetaSignUpView code="ABCD" accepted busy={false} {...handlers} />,
    );
    expect(ticked).toMatch(/<button type="submit">Create my account/u);
  });
});
