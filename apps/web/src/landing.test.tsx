import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Landing, legalLinks, WaitlistFormView } from "./landing.js";
import { OidcSignIn } from "./oidc-sign-in.js";
import { joinWaitlist, waitlistNotice, waitlistUrl } from "./waitlist-model.js";

const answering = (status: number) =>
  vi.fn<typeof fetch>(
    async () => new Response(status === 202 ? '{"listed":true}' : "{}", { status }),
  );

describe("joining the waitlist (#2567)", () => {
  it("posts the trimmed email with consent and reads a new or listed email alike", async () => {
    const fetchImpl = answering(202);

    await expect(joinWaitlist("  ada@example.test ", fetchImpl)).resolves.toBe("listed");
    // The API answers a duplicate exactly as a new email, so the screen cannot tell them apart.
    await expect(joinWaitlist("ada@example.test", fetchImpl)).resolves.toBe("listed");

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(waitlistUrl);
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.test", consent: true });
  });

  it.each([
    [400, "invalid"],
    [429, "rate_limited"],
    [500, "failed"],
  ] as const)("reads %i as %s", async (status, outcome) => {
    await expect(joinWaitlist("ada@example.test", answering(status))).resolves.toBe(outcome);
  });

  it("reads a network failure as failed", async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    await expect(joinWaitlist("ada@example.test", offline)).resolves.toBe("failed");
  });
});

describe("the landing page", () => {
  it("says what DraftLoop is, that it is a test, and links the legal pages", () => {
    const html = renderToStaticMarkup(<Landing signIn={<button type="button">Sign in</button>} />);

    expect(html).toContain("drafts a CV and a cover letter");
    expect(html).toContain("free public test");
    expect(html).toContain("outside the EU");
    expect(html).toContain(`href="${legalLinks.privacy}"`);
    expect(html).toContain(`href="${legalLinks.terms}"`);
    expect(html).toContain("Join the waitlist");
    expect(html).not.toMatch(/<script/u);
  });

  it("keeps the button off until there is an email and consent", () => {
    const handlers = { onEmailChange: () => {}, onConsentChange: () => {}, onSubmit: () => {} };
    const empty = renderToStaticMarkup(
      <WaitlistFormView email="ada@example.test" consent={false} busy={false} {...handlers} />,
    );
    const ready = renderToStaticMarkup(
      <WaitlistFormView email="ada@example.test" consent busy={false} {...handlers} />,
    );

    expect(empty).toMatch(/<button type="submit" disabled="">/u);
    expect(ready).toMatch(/<button type="submit">/u);
  });

  it("replaces the form with the thanks once listed", () => {
    const html = renderToStaticMarkup(
      <WaitlistFormView
        email="ada@example.test"
        consent
        busy={false}
        outcome="listed"
        onEmailChange={() => {}}
        onConsentChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(html).toContain(waitlistNotice("listed"));
    expect(html).not.toContain("<form");
  });

  it("shows the plain sign-in when the beta is closed", () => {
    const closed = renderToStaticMarkup(<OidcSignIn onSignIn={() => {}} />);
    const open = renderToStaticMarkup(<OidcSignIn waitlist onSignIn={() => {}} />);

    expect(closed).not.toContain("Join the waitlist");
    expect(open).toContain("Join the waitlist");
    expect(open).toContain("Sign in");
  });
});
