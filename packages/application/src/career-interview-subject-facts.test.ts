import { describe, expect, it } from "vitest";

import {
  careerInterviewSpeechHints,
  careerInterviewSubjectFacts,
} from "./career-interview-subject-facts.js";
import type { CareerInterviewFact } from "./career-interview-topics.js";

// An invented record.
const facts: CareerInterviewFact[] = [
  { id: "a", category: "employer", field: "name", value: "Banque Démo du Nord" },
  { id: "b", category: "project", field: "name", value: "Demo payments platform" },
  { id: "c", category: "skill", field: "name", value: "Leadership" },
  { id: "d", category: "achievement", field: "text", value: "Led the payments team at Démo" },
  { id: "x", category: "contact", field: "email", value: "demo@example.org" },
];

describe("career interview subject facts", () => {
  it("ranks facts by shared words, ignoring case, accents and glue words", () => {
    const ids = careerInterviewSubjectFacts("the payments team at Demo", facts, () => true, 12);
    expect(ids).toEqual(["d", "b", "a", "x"]);
  });

  it("leaves out withheld facts, and stops at the bound", () => {
    const allowed = (fact: CareerInterviewFact) => fact.id !== "x";
    expect(careerInterviewSubjectFacts("demo", facts, allowed, 2)).toEqual(["a", "b"]);
    expect(careerInterviewSubjectFacts("leadership", facts, () => true, 12)).toEqual(["c"]);
  });

  it("gives a broad subject that names no fact an overview of the profile instead", () => {
    const allowed = (fact: CareerInterviewFact) => fact.id !== "x";
    const subject = "what part of my career profile needs deepening?";
    expect(careerInterviewSubjectFacts(subject, facts, allowed, 12)).toEqual(["a", "b", "d", "c"]);
    expect(careerInterviewSubjectFacts("the and", facts, allowed, 2)).toEqual(["a", "b"]);
  });

  it("hints names from the record to speech, minus withheld, long and repeated ones", () => {
    const hints = careerInterviewSpeechHints(
      [
        ...facts,
        { id: "e", category: "employer", field: "name", value: "banque démo du nord" },
        {
          id: "f",
          category: "project",
          field: "text",
          value: "A long description of a project that ran for years",
        },
      ],
      (fact) => fact.id !== "c",
    );
    expect(hints).toEqual(["Banque Démo du Nord", "Demo payments platform"]);
  });
});
