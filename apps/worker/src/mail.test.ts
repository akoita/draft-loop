import { describe, expect, it, vi } from "vitest";

import {
  brevoEndpoint,
  createBrevoMailSender,
  inactivityWarning,
  loggedMailSender,
  MailSendError,
  readMailConfig,
} from "./mail.js";

const keySecret = "projects/p/secrets/mail-key/versions/latest";

describe("readMailConfig", () => {
  it("turns mail off when nothing is set", () => {
    expect(readMailConfig({})).toBeUndefined();
  });

  it("reads a complete sender", () => {
    expect(
      readMailConfig({
        DRAFT_LOOP_MAIL_FROM: "beta@mail.example.test",
        DRAFT_LOOP_MAIL_KEY_SECRET: keySecret,
        DRAFT_LOOP_PUBLIC_URL: "https://app.example.test/",
      }),
    ).toEqual({
      from: "beta@mail.example.test",
      keySecret,
      serviceUrl: "https://app.example.test",
    });
  });

  it.each([
    [{ DRAFT_LOOP_MAIL_FROM: "beta@mail.example.test" }, /KEY_SECRET/u],
    [{ DRAFT_LOOP_MAIL_FROM: "not-an-address", DRAFT_LOOP_MAIL_KEY_SECRET: keySecret }, /FROM/u],
    [
      {
        DRAFT_LOOP_MAIL_FROM: "beta@mail.example.test",
        DRAFT_LOOP_MAIL_KEY_SECRET: keySecret,
        DRAFT_LOOP_PUBLIC_URL: "http://app.example.test",
      },
      /PUBLIC_URL/u,
    ],
  ])("refuses a partial or invalid sender", (env, message) => {
    expect(() => readMailConfig(env)).toThrow(message);
  });
});

describe("the Brevo sender", () => {
  it("posts plain text with the key in a header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 201 }));
    const send = createBrevoMailSender({
      from: "beta@mail.example.test",
      apiKey: async () => "key-123",
      fetch: fetchImpl,
    });

    await send({ to: "owner@example.test", subject: "Hi", text: "Body" });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(brevoEndpoint);
    expect(init?.headers).toMatchObject({ "api-key": "key-123" });
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { email: "beta@mail.example.test", name: "DraftLoop" },
      to: [{ email: "owner@example.test" }],
      subject: "Hi",
      textContent: "Body",
    });
  });

  it("rejects with the status only when Brevo refuses", async () => {
    const send = createBrevoMailSender({
      from: "beta@mail.example.test",
      apiKey: async () => "key-123",
      fetch: async () => new Response("bad owner@example.test", { status: 400 }),
    });

    const failure = send({ to: "owner@example.test", subject: "Hi", text: "Body" });

    await expect(failure).rejects.toBeInstanceOf(MailSendError);
    await expect(failure).rejects.not.toThrow(/owner@/u);
  });
});

describe("loggedMailSender", () => {
  it("logs the template and outcome, never the address or text", async () => {
    const lines: unknown[] = [];
    const log = {
      info: (fields: Record<string, unknown>, message: string) =>
        lines.push({ ...fields, message }),
      warn: (fields: Record<string, unknown>, message: string) =>
        lines.push({ ...fields, message }),
    };
    const message = { to: "owner@example.test", subject: "Secret subject", text: "Secret text" };

    await expect(
      loggedMailSender(async () => undefined, log)("beta_inactivity_warning", message),
    ).resolves.toBe(true);
    await expect(
      loggedMailSender(async () => {
        throw new MailSendError(503);
      }, log)("beta_inactivity_warning", message),
    ).resolves.toBe(false);

    expect(lines).toEqual([
      { event: "mail_sent", template: "beta_inactivity_warning", message: "mail sent" },
      {
        event: "mail_failed",
        template: "beta_inactivity_warning",
        status: 503,
        message: "mail not sent",
      },
    ]);
  });
});

describe("the inactivity warning", () => {
  it("names the deletion day and the only link, in English and French", () => {
    const eraseOn = new Date("2027-02-06T00:00:00.000Z");
    const english = inactivityWarning({
      locale: "en",
      eraseOn,
      serviceUrl: "https://app.example.test",
    });
    const french = inactivityWarning({
      locale: "fr",
      eraseOn,
      serviceUrl: "https://app.example.test",
    });

    expect(english.text).toContain("deleted on 6 February 2027");
    expect(french.text).toContain("supprimé le 6 février 2027");
    for (const message of [english, french]) {
      expect(message.text.match(/https?:\/\/\S+/gu)).toEqual(["https://app.example.test"]);
    }
  });
});
