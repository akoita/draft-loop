import { describe, expect, it, vi } from "vitest";

import { createApiMail, readApiMail } from "./api-mail.js";
import { createInviteMailer, inviteLink, inviteMessage } from "./invite-mail.js";

const serviceUrl = "https://app.example.test";
const code = "ABCD2345EFGH6789";

describe("the invite email", () => {
  it("links to sign-up with the code after #, so no server log sees it", () => {
    expect(inviteLink(serviceUrl, code)).toBe(`${serviceUrl}/#invite=${code}`);
  });

  it("speaks the person's language, or French then English when it is unknown", () => {
    const english = inviteMessage({ code, serviceUrl, locale: "en" });
    const french = inviteMessage({ code, serviceUrl, locale: "fr" });
    const both = inviteMessage({ code, serviceUrl });

    expect(english.subject).toBe("Your DraftLoop beta invite");
    expect(english.text).toContain(inviteLink(serviceUrl, code));
    expect(english.text).toContain(`enter this code: ${code}`);
    expect(french.subject).toBe("Votre invitation à la beta de DraftLoop");
    expect(french.text).toContain(`saisissez ce code : ${code}`);
    expect(both.text.indexOf("Bonjour")).toBeLessThan(both.text.indexOf("Hello"));
  });
});

describe("the invite mailer", () => {
  it("is off without a sender", () => {
    expect(readApiMail({})).toBeUndefined();
  });

  it("sends to the invite's address and logs only the template and outcome", async () => {
    const send = vi.fn(async () => undefined);
    const lines: unknown[] = [];
    const mailer = createInviteMailer(
      createApiMail(
        {
          from: "beta@mail.example.test",
          keySecret: "projects/p/secrets/k/versions/1",
          serviceUrl,
        },
        { send, log: (line) => lines.push(line) },
      ),
    );

    await expect(mailer({ email: "ada@example.test", code, locale: "en" })).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.test", subject: "Your DraftLoop beta invite" }),
    );
    expect(JSON.stringify(lines)).not.toContain("ada@");
    expect(JSON.stringify(lines)).not.toContain(code);
  });

  it("resolves false when the provider refuses, so the operator sends the code", async () => {
    const mailer = createInviteMailer(
      createApiMail(
        {
          from: "beta@mail.example.test",
          keySecret: "projects/p/secrets/k/versions/1",
          serviceUrl,
        },
        {
          send: async () => {
            throw new Error("refused");
          },
          log: () => undefined,
        },
      ),
    );

    await expect(mailer({ email: "ada@example.test", code })).resolves.toBe(false);
  });
});
