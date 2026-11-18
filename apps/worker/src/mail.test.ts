import { describe, expect, it } from "vitest";

import { inactivityWarning, readMailConfig } from "./mail.js";

describe("the worker's mail config", () => {
  it("stops the worker on a partial sender", () => {
    expect(() => readMailConfig({ DRAFT_LOOP_MAIL_FROM: "beta@mail.example.test" })).toThrow(
      expect.objectContaining({ name: "WorkerConfigError" }),
    );
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
