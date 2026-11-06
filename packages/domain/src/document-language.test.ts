import { describe, expect, it } from "vitest";

import {
  detectTextLanguage,
  documentLanguageLabel,
  isDocumentLanguage,
} from "./document-language.js";

const englishJob =
  "We are looking for a backend engineer to join our platform team. You will design and run the services that our customers use every day, and you will work with product and data.";
const frenchJob =
  "Nous recherchons un ingénieur backend pour rejoindre notre équipe plateforme. Vous serez responsable de la conception et de l'exploitation des services utilisés par nos clients, avec les équipes produit et données.";
const germanJob =
  "Wir suchen eine Entwicklerin für unser Team. Sie sind verantwortlich für die Planung und den Betrieb der Dienste, die unsere Kunden jeden Tag nutzen, und arbeiten mit dem Produktteam.";

describe("detectTextLanguage", () => {
  it("names the language of a job posting", () => {
    expect(detectTextLanguage(englishJob)?.code).toBe("en");
    expect(detectTextLanguage(frenchJob)?.code).toBe("fr");
    expect(detectTextLanguage(germanJob)?.code).toBe("de");
  });

  it("does not guess on a short text", () => {
    expect(detectTextLanguage("Senior engineer, Paris")).toBeUndefined();
    expect(detectTextLanguage("")).toBeUndefined();
  });

  it("does not guess on an even mix of two languages", () => {
    const mixed = `${englishJob.slice(0, 90)} ${frenchJob.slice(0, 110)}`;
    const detected = detectTextLanguage(mixed);
    expect(detected === undefined || detected.share < 0.8).toBe(true);
  });
});

describe("document languages", () => {
  it("knows the offered codes and their labels", () => {
    expect(isDocumentLanguage("fr")).toBe(true);
    expect(isDocumentLanguage("xx")).toBe(false);
    expect(documentLanguageLabel("fr")).toBe("French");
    expect(documentLanguageLabel("xx")).toBe("xx");
  });
});
