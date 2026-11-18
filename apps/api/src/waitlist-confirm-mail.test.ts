import { describe, expect, it, vi } from "vitest";

import { createApiMail } from "./api-mail.js";
import {
  createWaitlistConfirmMailer,
  waitlistConfirmLink,
  waitlistConfirmMessage,
} from "./waitlist-confirm-mail.js";

const serviceUrl = "https://app.example.test";
const token = "synthetic-token-0123456789abcdef";

describe("the waitlist confirmation email", () => {
  it("links to the screen with the token after #, so no server log sees it", () => {
    expect(waitlistConfirmLink(serviceUrl, token)).toBe(`${serviceUrl}/#waitlist-confirm=${token}`);
  });

  it("speaks the visitor's language and says how long the link works", () => {
    const english = waitlistConfirmMessage({ token, serviceUrl, locale: "en" });
    const french = waitlistConfirmMessage({ token, serviceUrl, locale: "fr" });
    const both = waitlistConfirmMessage({ token, serviceUrl });

    expect(english.text).toContain(waitlistConfirmLink(serviceUrl, token));
    expect(english.text).toContain("48 hours");
    expect(french.text).toContain("48 heures");
    expect(both.text.indexOf("Bonjour")).toBeLessThan(both.text.indexOf("Hello"));
  });

  it("sends under its own template, never logging the address or the token", async () => {
    const send = vi.fn(async () => undefined);
    const lines: unknown[] = [];
    const mailer = createWaitlistConfirmMailer(
      createApiMail(
        {
          from: "beta@mail.example.test",
          keySecret: "projects/p/secrets/k/versions/1",
          serviceUrl,
        },
        { send, log: (line) => lines.push(line) },
      ),
    );

    await expect(mailer({ email: "ada@example.test", token, locale: "en" })).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.test" }));
    expect(JSON.stringify(lines)).toContain("waitlist_confirm");
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain("ada@");
  });
});
