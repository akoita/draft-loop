import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatEuros,
  formatList,
  formatLocale,
  formatNumber,
  formatTime,
  pluralCategory,
} from "./locale-format.js";

const moment = "2026-11-24T14:05:09Z";
const utc = { timeZone: "UTC" };

describe("formatting for the screen locale", () => {
  it("formats English screens as British English by default", () => {
    expect(formatLocale()).toBe("en-GB");
    expect(formatDate(moment, utc)).toBe("24 Nov 2026");
    expect(formatDateTime(moment, utc)).toBe("24 Nov 2026, 14:05");
    expect(formatTime(moment, utc)).toBe("14:05:09");
    expect(formatNumber(12000)).toBe("12,000");
    expect(formatEuros(19)).toBe("€19.00");
    expect(formatList(["Anthropic", "OpenAI", "Mistral"])).toBe("Anthropic, OpenAI and Mistral");
    expect(formatList(["CV", "letter"], { type: "disjunction" })).toBe("CV or letter");
    expect(pluralCategory(1)).toBe("one");
    expect(pluralCategory(2)).toBe("other");
  });

  it("formats French as French", () => {
    const fr = { locale: "fr" };
    expect(formatLocale("fr")).toBe("fr-FR");
    expect(formatDate(moment, { ...fr, ...utc })).toBe("24 nov. 2026");
    expect(formatNumber(12000, fr)).toBe("12 000");
    expect(formatEuros(19, fr)).toBe("19,00 €");
    expect(formatList(["Anthropic", "OpenAI", "Mistral"], fr)).toBe("Anthropic, OpenAI et Mistral");
    expect(pluralCategory(0, fr)).toBe("one");
  });

  it("keeps an explicit Intl locale and refuses an invalid date", () => {
    expect(formatLocale("en-US")).toBe("en-US");
    expect(formatDate(moment, { locale: "en-US", ...utc })).toBe("Nov 24, 2026");
    expect(formatDateTime("not a date")).toBeUndefined();
  });
});
