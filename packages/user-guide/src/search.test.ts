import { describe, expect, it } from "vitest";

import { helpGuide } from "./guide.js";
import { foldForSearch, searchHelpGuide } from "./search.js";

const ids = (locale: "en" | "fr", query: string) =>
  searchHelpGuide(helpGuide(locale), query).map((section) => section.id);

describe("searching the user guide (#2880)", () => {
  it("folds case, accents and punctuation", () => {
    expect(foldForSearch("Éléments de PARCOURS, d’accord!")).toBe("elements de parcours d accord");
  });

  it("finds the section a member means, in English", () => {
    expect(ids("en", "credits")[0]).toBe("credits");
    expect(ids("en", "export")[0]).toBe("review");
    expect(ids("en", "connect an agent")).toContain("agents");
    expect(ids("en", "cover letter")[0]).toBe("prepare");
    expect(ids("en", "price")).toEqual(["credits"]);
  });

  it("finds the same sections in French, with or without accents", () => {
    expect(ids("fr", "crédits")[0]).toBe("credits");
    expect(ids("fr", "credits")[0]).toBe("credits");
    expect(ids("fr", "exporter")[0]).toBe("review");
    expect(ids("fr", "lettre de motivation")[0]).toBe("prepare");
    expect(ids("fr", "RGPD")[0]).toBe("privacy");
  });

  it("needs every word to match and lists nothing for an unknown word", () => {
    expect(ids("en", "export zebra")).toEqual([]);
    expect(ids("en", "quantum")).toEqual([]);
  });

  it("ignores an empty or one-letter query", () => {
    expect(ids("en", "   ")).toEqual([]);
    expect(ids("en", "a")).toEqual([]);
  });
});
