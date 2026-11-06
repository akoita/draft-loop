import { emptyFactUsageSettings, factUsageKey, withFactUsage } from "@draft-loop/domain/fact-usage";
import { describe, expect, it } from "vitest";

import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  type ApplicationMaterialPort,
  type ApplicationMaterialRequest,
  applicationMaterialContext,
  applicationMaterialViolations,
  draftApplicationMaterial,
} from "./application-material.js";

// An invented career record.
const role: ApplicationMaterialFact = {
  id: "f1",
  category: "role",
  field: "title",
  value: "Data Analyst",
};
const salary: ApplicationMaterialFact = {
  id: "f2",
  category: "achievement",
  field: "previous salary",
  value: "Earned 90000 a year",
};
const reason: ApplicationMaterialFact = {
  id: "f3",
  category: "project",
  field: "why it ended",
  value: "Project cancelled after a reorganisation",
};
const facts = [role, salary, reason];
const requirements = [{ id: "r1", text: "SQL reporting", priority: "high" as const }];

let usage = withFactUsage(
  emptyFactUsageSettings,
  { kind: "fact", key: factUsageKey(salary as never) },
  "never-say",
);
usage = withFactUsage(usage, { kind: "section", category: "project" }, "interview-only");

function scripted(items: unknown[]) {
  const requests: ApplicationMaterialRequest[] = [];
  const port: ApplicationMaterialPort = {
    draft: async (request) => {
      requests.push(request);
      return { items: items as never, model: { provider: "anthropic", model: "scripted" } };
    },
  };
  return { port, requests };
}

describe("application material and usage levels", () => {
  it("sends interview questions only interview-allowed facts, never a never-say fact", async () => {
    const { port, requests } = scripted([
      {
        question: "Why did the project end?",
        text: "It was cancelled after a reorganisation.",
        factIds: ["f3"],
      },
    ]);
    const draft = await draftApplicationMaterial(port, {
      kind: "interview-questions",
      facts,
      requirements,
      usage,
    });
    const sent = JSON.stringify(requests);
    expect(requests[0]?.context.facts.map((fact) => fact.id)).toEqual(["f1", "f3"]);
    expect(sent).not.toContain("90000");
    expect(sent).not.toContain("salary");
    expect(JSON.stringify(draft)).not.toContain("90000");
  });

  it("keeps interview-only facts out of a cover letter", () => {
    expect(
      applicationMaterialContext({ kind: "cover-letter", facts, requirements, usage }).facts.map(
        (fact) => fact.id,
      ),
    ).toEqual(["f1"]);
  });

  it("refuses a draft that cites a never-say fact the record holds", () => {
    const codes = applicationMaterialViolations(
      { kind: "interview-questions", facts, requirements, usage },
      [{ question: "Pay?", text: "I earned 90000 a year.", factIds: ["f2"] }],
    ).map((violation) => violation.code);
    expect(codes).toContain("fact_not_allowed");
  });

  it("uses every fact when nothing is set, and refuses to draft when every fact is never-say", async () => {
    expect(
      applicationMaterialContext({ kind: "interview-questions", facts, requirements }).facts,
    ).toHaveLength(3);
    let silent = emptyFactUsageSettings;
    for (const category of ["role", "achievement", "project"] as const) {
      silent = withFactUsage(silent, { kind: "section", category }, "never-say");
    }
    const { port, requests } = scripted([]);
    await expect(
      draftApplicationMaterial(port, {
        kind: "interview-questions",
        facts,
        requirements,
        usage: silent,
      }),
    ).rejects.toBeInstanceOf(ApplicationMaterialError);
    expect(requests).toEqual([]);
  });
});
