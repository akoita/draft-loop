import { afterEach, describe, expect, it } from "vitest";
import { countedNouns } from "./counted-nouns.js";
import { applicationActivityText } from "./home-model.js";
import { activateScreenLocale } from "./i18n.js";
import { markKnownGapsLabel } from "./known-gaps.js";

describe("counted nouns on the screens", () => {
  afterEach(() => activateScreenLocale("en"));

  it("pick the English singular for one and the plural otherwise", () => {
    expect(countedNouns.source(1)).toBe("1 source");
    expect(countedNouns.source(0)).toBe("0 sources");
    expect(countedNouns.responsibility(2)).toBe("2 responsibilities");
    expect(markKnownGapsLabel(3)).toBe("Mark 3 confirmed gaps as known");
  });

  it("use the French forms, where zero and one take the singular", () => {
    activateScreenLocale("fr");
    expect(countedNouns.blockingFinding(0)).toBe("0 constat bloquant");
    expect(countedNouns.blockingFinding(1)).toBe("1 constat bloquant");
    expect(countedNouns.blockingFinding(2)).toBe("2 constats bloquants");
    expect(markKnownGapsLabel(1)).toBe("Marquer 1 lacune confirmée comme connue");
    const now = new Date("2026-11-06T12:00:00Z");
    expect(applicationActivityText("2026-11-04T12:00:00Z", now)).toBe(
      "Dernière activité il y a 2 jours",
    );
  });
});
