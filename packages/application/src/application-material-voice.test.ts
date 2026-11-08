import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  type ApplicationMaterialFact,
  type ApplicationMaterialRequest,
  applicationMaterialContext,
  boundedApplicationMaterialVoice,
  draftApplicationMaterial,
} from "./application-material.js";
import { createWritingSamplesService } from "./writing-samples.js";

// An invented career record and invented samples.
const facts: ApplicationMaterialFact[] = [
  { id: "f1", category: "role", field: "title", value: "Data Analyst" },
];
const sample =
  "Short note. I fixed it on Tuesday, then I told the team. It took 14 tries, which nobody believed at first.";

function memorySettings(): WorkspaceSettingsPort {
  const documents = new Map<string, string>();
  return {
    read: async (workspace, name) => documents.get(`${workspace}/${name}`),
    write: async (workspace, name, content) => {
      documents.set(`${workspace}/${name}`, content);
    },
    remove: async (workspace, name) => documents.delete(`${workspace}/${name}`),
  };
}

describe("the candidate's voice (#2513)", () => {
  it("keeps up to three samples of a useful length in the workspace settings", async () => {
    const samples = createWritingSamplesService(memorySettings());
    expect(await samples.read("/w")).toEqual([]);
    expect(await samples.replace("/w", [`  ${sample}  `])).toEqual([sample]);
    expect(await samples.read("/w")).toEqual([sample]);
    await expect(samples.replace("/w", ["Too short."])).rejects.toThrow("at most 3 samples");
    await expect(samples.replace("/w", [sample, sample, sample, sample])).rejects.toThrow();
    expect(await samples.replace("/w", [])).toEqual([]);
    expect(await samples.read("/w")).toEqual([]);
  });

  it("bounds what reaches the model and drops empty fields", () => {
    expect(
      boundedApplicationMaterialVoice({
        samples: [" ", "x".repeat(5_000), sample, sample, sample],
        avoidTerms: ["synergy", " synergy ", ""],
      }),
    ).toEqual({ samples: ["x".repeat(2_000), sample, sample], avoidTerms: ["synergy"] });
    expect(boundedApplicationMaterialVoice({ samples: [], avoidTerms: [] })).toBeUndefined();
    expect(
      applicationMaterialContext({
        kind: "cover-letter",
        facts,
        requirements: [],
        voice: { samples: [sample], tone: "direct" },
      }).voice,
    ).toEqual({ samples: [sample], tone: "direct" });
  });

  it("never supplies a fact: a number only a sample states is refused", async () => {
    const requests: ApplicationMaterialRequest[] = [];
    await expect(
      draftApplicationMaterial(
        {
          draft: async (request) => {
            requests.push(request);
            return {
              items: [
                { question: "", text: "As a Data Analyst I took 14 tries.", factIds: ["f1"] },
              ],
            };
          },
        },
        { kind: "cover-letter", facts, requirements: [], voice: { samples: [sample] } },
      ),
    ).rejects.toMatchObject({ code: "invalid_draft" });
    expect(requests[0]?.context.voice?.samples).toEqual([sample]);
    expect(requests[0]?.context.facts.map((fact) => fact.id)).toEqual(["f1"]);
  });
});
