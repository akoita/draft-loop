import { describe, expect, it } from "vitest";

import {
  singleWordNames,
  supportsSingleWordName,
  unsupportedSingleWordNames,
} from "./single-word-name-grounding.js";

describe("unsupported single-word names", () => {
  it("reports a capitalised name that no cited chunk contains", () => {
    expect(
      unsupportedSingleWordNames("Built streaming pipelines with Kafka.", [
        "- Built streaming pipelines with Pulsar.",
      ]),
    ).toEqual(["Kafka"]);
  });

  it("accepts a name found as a whole word in any cited chunk", () => {
    expect(
      unsupportedSingleWordNames("Built streaming pipelines with Kafka.", [
        "Languages: Python",
        "Messaging: Kafka-based event bus",
      ]),
    ).toEqual([]);
    expect(
      unsupportedSingleWordNames("Opened the office in Berlin.", ["Berliner office launch"]),
    ).toEqual(["Berlin"]);
  });

  it("matches evidence case-insensitively after compatibility normalization", () => {
    expect(
      unsupportedSingleWordNames("Built pipelines with Kafka and Ｒedis.", [
        "built pipelines with KAFKA and redis",
      ]),
    ).toEqual([]);
  });

  it("exempts the first word of the claim and of each later sentence", () => {
    expect(
      unsupportedSingleWordNames("Built billing services. Leads a team! Owns releases? Yes.", [
        "billing services team releases",
      ]),
    ).toEqual([]);
    expect(
      unsupportedSingleWordNames("- Kafka pipelines.", ["pipelines"]),
      "leading list marker",
    ).toEqual([]);
  });

  it("does not exempt list items after commas, semicolons, or colons", () => {
    expect(unsupportedSingleWordNames("Python, Kafka; Redis: Terraform", ["Python"])).toEqual([
      "Kafka",
      "Redis",
      "Terraform",
    ]);
  });

  it("does not exempt a capitalised word after a period without whitespace", () => {
    expect(unsupportedSingleWordNames("Deployed with Node.Pulsar support", ["node"])).toEqual([
      "Pulsar",
    ]);
  });

  it("exempts calendar words, Present, and I", () => {
    expect(
      unsupportedSingleWordNames(
        "Maintained billing since March, Sep through Friday and Mon until Present, as I led it.",
        ["billing"],
      ),
    ).toEqual([]);
  });

  it("exempts words inside protected values, which are checked separately", () => {
    expect(
      unsupportedSingleWordNames("Maintained billing at Globex for Harbor Lane Software.", [
        "billing",
      ]),
    ).toEqual([]);
  });

  it("keeps apostrophes and hyphens inside a name", () => {
    expect(
      unsupportedSingleWordNames("Edited books with O'Reilly and Hewlett-Packard.", [
        "Edited books with O'Reilly and Hewlett-Packard.",
      ]),
    ).toEqual([]);
    expect(
      unsupportedSingleWordNames("Edited books with O'Reilly and Hewlett-Packard.", [
        "Edited books with Reilly and Hewlett.",
      ]),
    ).toEqual(["O'Reilly", "Hewlett-Packard"]);
  });

  it("treats non-Latin capitals as names", () => {
    expect(unsupportedSingleWordNames("Работал в компании Яндекс.", ["компании Google"])).toEqual([
      "Яндекс",
    ]);
    expect(unsupportedSingleWordNames("Работал в компании Яндекс.", ["компании яндекс"])).toEqual(
      [],
    );
  });

  it("reports each unsupported name once", () => {
    expect(
      unsupportedSingleWordNames("Moved data with Kafka and more Kafka streams.", ["streams"]),
    ).toEqual(["Kafka"]);
  });

  it("treats straight and typographic apostrophes as the same character", () => {
    expect(
      unsupportedSingleWordNames("Edited books with O’Reilly.", ["Edited books with O'Reilly."]),
    ).toEqual([]);
    expect(
      unsupportedSingleWordNames("Edited books with O'Reilly.", ["Edited books with O’Reilly."]),
    ).toEqual([]);
  });

  it("supports a possessive name by the name with or without its possessive ending", () => {
    for (const evidence of ["billing platform at Globex", "Globex's platform", "Globex’s platform"])
      expect(
        unsupportedSingleWordNames("Scaled the platform used by Globex's customers.", [evidence]),
        evidence,
      ).toEqual([]);
    expect(
      unsupportedSingleWordNames("Scaled the platform used by Globex’s customers.", [
        "platform at Globex",
      ]),
    ).toEqual([]);
    expect(
      unsupportedSingleWordNames("Scaled the platform used by Globex's customers.", [
        "platform at Initech",
      ]),
    ).toEqual(["Globex's"]);
  });

  it("keeps hyphenated names whole", () => {
    expect(
      unsupportedSingleWordNames("Ran pipelines on Kafka-Streams clusters.", ["Kafka clusters"]),
    ).toEqual(["Kafka-Streams"]);
  });
});

describe("single-word name evidence matching", () => {
  it("matches a whole word, not a prefix of a longer word", () => {
    expect(supportsSingleWordName("Messaging: Kafka, Redis", "Kafka")).toBe(true);
    expect(supportsSingleWordName("Messaging: Kafkaesque", "Kafka")).toBe(false);
  });

  it("lists only the capitalised words that need evidence", () => {
    expect(singleWordNames("Built pipelines with Kafka since March at Globex, Redis.")).toEqual([
      "Kafka",
      "Redis",
    ]);
  });
});
