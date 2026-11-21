import { describe, expect, it } from "vitest";

import {
  feedbackReference,
  feedbackReplyLocale,
  feedbackReplyMessage,
} from "./feedback-reply-mail.js";

describe("the feedback reply email (#2878)", () => {
  it("names the note by the reference the member saw", () => {
    expect(feedbackReference("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe("FB-1A2B3C4D");
  });

  it("writes in the member's browser language, or both when unknown", () => {
    expect(feedbackReplyLocale("fr-FR")).toBe("fr");
    expect(feedbackReplyLocale("en-GB")).toBe("en");
    expect(feedbackReplyLocale("de-DE")).toBeUndefined();
    expect(feedbackReplyLocale(undefined)).toBeUndefined();

    const input = {
      reference: "FB-1A2B3C4D",
      text: "Fixed.",
      serviceUrl: "https://app.example.test",
    };
    const english = feedbackReplyMessage({ ...input, locale: "en" });
    expect(english.subject).toBe("About your DraftLoop note FB-1A2B3C4D");
    expect(english.text).toContain("Fixed.");
    expect(english.text).toContain("https://app.example.test");
    expect(feedbackReplyMessage({ ...input, locale: "fr" }).subject).toContain("avis");
    const both = feedbackReplyMessage(input).text;
    expect(both).toContain("Bonjour,");
    expect(both).toContain("Hello,");
  });
});
