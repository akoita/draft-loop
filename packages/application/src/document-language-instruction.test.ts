import { describe, expect, it } from "vitest";
import {
  documentLanguageInstruction,
  withDocumentLanguage,
} from "./document-language-instruction.js";

describe("document language instruction", () => {
  it("leaves English prompts unchanged", () => {
    expect(documentLanguageInstruction("en")).toBeUndefined();
    expect(documentLanguageInstruction("en-GB")).toBeUndefined();
    expect(documentLanguageInstruction(undefined)).toBeUndefined();
    expect(withDocumentLanguage("Write the CV.", "en")).toBe("Write the CV.");
  });

  it("names the language and asks for a faithful translation", () => {
    const sentence = documentLanguageInstruction("fr") ?? "";
    expect(sentence).toContain("in French (fr)");
    expect(sentence).toContain("translate its facts into French faithfully");
    expect(withDocumentLanguage("Write the CV.", "fr")).toBe(`Write the CV.\n\n${sentence}`);
  });

  it("reads a regional code by its language", () => {
    expect(documentLanguageInstruction("fr-CA")).toContain("in French (fr-ca)");
  });
});
