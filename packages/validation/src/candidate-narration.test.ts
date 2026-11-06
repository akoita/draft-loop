import { describe, expect, it } from "vitest";
import { findCandidateNarration } from "./candidate-narration.js";

describe("candidate narration", () => {
  it("finds third-person narration copied from career notes", () => {
    const text =
      "Freight booking platform for a logistics client. His main responsibility was architecture and contracts.";
    expect(findCandidateNarration(text)).toEqual({
      quote: "His main responsibility was architecture and contr",
      start: 49,
      end: 52,
    });
    expect(
      findCandidateNarration("Remained an employee on leave; he resigned in March 2017.")?.quote,
    ).toBe("he resigned in March 2017.");
    expect(
      findCandidateNarration("Fixed the audit findings as developer and tech lead, himself."),
    ).toMatchObject({ quote: "himself." });
  });

  it("finds reviewer comments about the candidate or the CV", () => {
    expect(findCandidateNarration("Working knowledge, labelled as such: Kubernetes.")?.quote).toBe(
      "labelled as such: Kubernetes.",
    );
    expect(findCandidateNarration("The candidate led a team of three.")?.quote).toBe(
      "The candidate led a team of three.",
    );
  });

  it("leaves candidate-voice prose, acronyms and words that contain a pronoun alone", () => {
    for (const text of [
      "Led the technical rollout of Ledgerline across the Northbank group.",
      "Built the HER data export and the HIS integration for hospital partners.",
      "Shepherded the schema migration; theme tokens and hierarchy rules.",
      "Hired and onboarded three engineers; ran the heroku-to-GCP move.",
    ]) {
      expect(findCandidateNarration(text)).toBeUndefined();
    }
  });
});

describe("findCandidateNarration in French (#2320)", () => {
  it("flags French third-person narration about the candidate", () => {
    expect(
      findCandidateNarration("Il a dirigé la migration vers Kubernetes.", "fr")?.quote,
    ).toMatch(/^Il a/u);
    expect(findCandidateNarration("Le candidat a conduit trois audits.", "fr")).toBeDefined();
    expect(findCandidateNarration("Elle était responsable du budget.", "fr")).toBeDefined();
  });

  it("leaves French candidate-voice prose, possessives and other languages alone", () => {
    expect(
      findCandidateNarration("Dirigé la migration et son plan de reprise d'activité.", "fr"),
    ).toBeUndefined();
    expect(findCandidateNarration("He led the migration.", "fr")).toBeUndefined();
    expect(findCandidateNarration("Er leitete die Migration.", "de")).toBeUndefined();
  });
});
