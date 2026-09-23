import { describe, expect, it } from "vitest";

import { extractProtectedValues } from "./author-grounding.js";
import {
  excludedTitleWords,
  isOpeningActionVerb,
  linkingWords,
  withoutOpeningActionVerb,
} from "./opening-action-verbs.js";
import { singleWordNames } from "./single-word-name-grounding.js";

describe("opening action verbs before multi-word names", () => {
  it("protects the one supported name after an opening verb", () => {
    expect(withoutOpeningActionVerb("Led Kafka migrations.", "Led Kafka", 0)).toBe("Kafka");
    expect(extractProtectedValues("Led Kafka migrations.")).toEqual(["Kafka"]);
  });

  it("protects the remaining multi-word name after an opening verb", () => {
    expect(extractProtectedValues("Led Platform Team rollout.")).toEqual(["Platform Team"]);
    expect(extractProtectedValues("  Designed Harbor Lane Billing services.")).toEqual([
      "Harbor Lane Billing",
    ]);
  });

  it.each([
    ["Built Northwind Freight dashboards.", "Northwind Freight"],
    ["Tested Kafka migrations.", "Kafka"],
    ["Using Kafka streams for billing.", "Kafka"],
    ["Led Platform migrations for billing services.", "Platform"],
    ["Launched Northwind Freight dashboards for dispatch teams.", "Northwind Freight"],
  ])("strips any listed verb when a lowercase object follows in %s", (text, name) => {
    expect(extractProtectedValues(text)).toEqual([name]);
  });

  it.each([...linkingWords])("keeps the match whole before the linking word %s", (word) => {
    expect(extractProtectedValues(`Led Kafka ${word} the platform.`)).toEqual(["Led Kafka"]);
    expect(extractProtectedValues(`Built TypeScript ${word} the employer.`)).toContain(
      "Built TypeScript",
    );
  });

  it.each([
    "Led Kafka.",
    "Led Kafka, then billing.",
    "Led Kafka; billing followed.",
    "Led Kafka: billing.",
    "Led Kafka (billing).",
    "Led Kafka - billing.",
  ])("keeps the match whole before punctuation in %s", (text) => {
    expect(extractProtectedValues(text)).toContain("Led Kafka");
  });

  it("keeps the match whole at the end of the text", () => {
    expect(extractProtectedValues("Led Kafka")).toEqual(["Led Kafka"]);
    expect(extractProtectedValues("Built Systems")).toEqual(["Built Systems"]);
    expect(extractProtectedValues("Built AWS Architect")).toContain("Built AWS Architect");
  });

  it("keeps the match whole before a capitalised word", () => {
    expect(withoutOpeningActionVerb("Led Kafka Streams", "Led Kafka", 0)).toBe("Led Kafka");
    expect(withoutOpeningActionVerb("Led Kafka migrations", "Led Kafka", 0)).toBe("Kafka");
  });

  it("keeps the employer-like subjects of the narrow split whole", () => {
    expect(extractProtectedValues("Built TypeScript is the employer")).toContain(
      "Built TypeScript",
    );
    expect(extractProtectedValues("Built TypeScript was founded")).toContain("Built TypeScript");
    expect(extractProtectedValues("Built TypeScript. Established tooling followed.")).toContain(
      "Built TypeScript",
    );
    expect(extractProtectedValues("Led Kafka is the employer of record.")).toEqual(["Led Kafka"]);
  });

  it("keeps the name after a stripped verb subject to the single-word check", () => {
    // The name is checked as a protected value, so the single-word check skips it.
    expect(extractProtectedValues("Led Kafka migrations.")).toContain("Kafka");
    expect(singleWordNames("Led Kafka migrations.")).toEqual([]);
  });

  it.each(["Senior Engineer", "Lead Engineer", "Principal Platform Engineer"])(
    "keeps the title %s whole",
    (text) => {
      expect(extractProtectedValues(text)).toEqual([text]);
      expect(extractProtectedValues(`${text} on the billing platform.`)).toEqual([text]);
    },
  );

  it.each([...excludedTitleWords])("never strips the title word %s", (word) => {
    expect(isOpeningActionVerb(word)).toBe(false);
    expect(extractProtectedValues(`${word} Platform Engineer on the billing team.`)).toEqual([
      `${word} Platform Engineer`,
    ]);
    expect(withoutOpeningActionVerb(`${word} Kafka migrations`, `${word} Kafka`, 0)).toBe(
      `${word} Kafka`,
    );
  });

  it("keeps a listed verb that does not start the claim", () => {
    expect(extractProtectedValues("Worked at Northwind. Led Kafka migrations.")).toContain(
      "Led Kafka",
    );
    expect(extractProtectedValues("Experience: Led Kafka migrations.")).toContain("Led Kafka");
    expect(withoutOpeningActionVerb("Then Led Kafka", "Led Kafka", 5)).toBe("Led Kafka");
  });

  it("keeps a first word that is not a listed verb", () => {
    expect(isOpeningActionVerb("Joined")).toBe(false);
    expect(extractProtectedValues("Joined Kafka migrations.")).toEqual(["Joined Kafka"]);
  });

  it("recognises the listed verbs case-sensitively", () => {
    expect(isOpeningActionVerb("Led")).toBe(true);
    expect(isOpeningActionVerb("Using")).toBe(true);
    expect(isOpeningActionVerb("Built")).toBe(true);
    expect(isOpeningActionVerb("led")).toBe(false);
  });

  it("keeps the narrow split for other name patterns", () => {
    expect(extractProtectedValues("Built TypeScript tools using AWS in 2024.")).toEqual([
      "TypeScript",
      "AWS",
      "2024",
    ]);
    expect(extractProtectedValues("Led AWS migrations.")).toEqual(["AWS"]);
    expect(extractProtectedValues("Worked at Built TypeScript tools.")).toContain(
      "Built TypeScript",
    );
  });
});
