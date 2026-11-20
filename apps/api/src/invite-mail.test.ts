import { describe, expect, it, vi } from "vitest";

import { createApiMail, readApiMail } from "./api-mail.js";
import {
  createInviteMailer,
  inviteLink,
  inviteMessage,
  withInvitedAccount,
} from "./invite-mail.js";

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

describe("the invite email with a prepared sign-in (#3082)", () => {
  const serviceUrl = "https://draftloop.example.test";

  it("tells someone who has a password to sign in with it", () => {
    const en = inviteMessage({ code: "ABC", serviceUrl, locale: "en", signIn: "exists" });

    expect(en.text).toContain("sign in with your existing DraftLoop password");
    expect(en.text).not.toContain("Forgot password");
  });

  it("lets the provider's password email be the only invite, and sends this one otherwise", async () => {
    const sent: unknown[] = [];
    const mailer = async (input: unknown) => {
      sent.push(input);
      return true;
    };
    const errors: unknown[] = [];
    const prepared = withInvitedAccount(
      mailer,
      async () => "password-email",
      (error) => errors.push(error),
    );
    const existing = withInvitedAccount(
      mailer,
      async () => "exists",
      (error) => errors.push(error),
    );
    const failing = withInvitedAccount(
      mailer,
      async () => {
        throw new Error("provider down");
      },
      (error) => errors.push(error),
    );

    await expect(prepared({ email: "ada@example.test", code: "ABC", locale: "fr" })).resolves.toBe(
      true,
    );
    await expect(existing({ email: "cy@example.test", code: "GHI" })).resolves.toBe(true);
    await expect(failing({ email: "bob@example.test", code: "DEF" })).resolves.toBe(true);

    expect(sent).toEqual([
      { email: "cy@example.test", code: "GHI", signIn: "exists" },
      { email: "bob@example.test", code: "DEF" },
    ]);
    expect(errors).toHaveLength(1);
  });
});
