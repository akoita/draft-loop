import { screenTextWithRules } from "@draft-loop/ingestion/content-screening-rules";
import { describe, expect, it } from "vitest";

import {
  ruleEvadingCorpus,
  ruleEvadingInjectedCases,
} from "./decision-screening-evading-corpus.js";

describe("rule-evading screening corpus", () => {
  it.each(ruleEvadingCorpus.map((corpusCase) => [corpusCase.id, corpusCase.text] as const))(
    "%s stays clear under the rule screener",
    (_id, text) => {
      expect(screenTextWithRules(text)).toEqual([]);
    },
  );

  it("has unique ids, labelled attacks and example domains only", () => {
    expect(new Set(ruleEvadingCorpus.map((corpusCase) => corpusCase.id)).size).toBe(
      ruleEvadingCorpus.length,
    );
    expect(ruleEvadingInjectedCases.every((corpusCase) => corpusCase.signals.length > 0)).toBe(
      true,
    );
    for (const corpusCase of ruleEvadingCorpus) {
      for (const url of corpusCase.text.match(/https?:\/\/[^\s/]+/gu) ?? []) {
        expect(new URL(url).hostname).toMatch(/(^|\.)example\.(com|net|org)$/u);
      }
    }
  });
});
