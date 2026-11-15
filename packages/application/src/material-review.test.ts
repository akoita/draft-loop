import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import { describe, expect, it } from "vitest";

import type {
  ApplicationMaterialPort,
  ApplicationMaterialRequest,
} from "./application-material.js";
import type { MaterialCriticPort } from "./material-critic.js";
import {
  type ReviewSavedApplicationMaterialCommand,
  reviewSavedApplicationMaterial,
} from "./material-review.js";

const base: SavedApplicationMaterial = {
  id: "amd_letterfixture01",
  workspace_id: "ws_fixture",
  application_id: "app_fixture0001",
  kind: "cover-letter",
  items: [
    {
      question: "",
      text: "I am a passionate Data Analyst. I cut report time by 40%.",
      citations: [
        { fact_id: "t", text: "role title: Data Analyst" },
        { fact_id: "o", text: "achievement outcome: Cut report time by 40%" },
      ],
    },
  ],
  guidance: { tone: "direct" },
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "application-material-v11",
  cost_usd: 0.02,
  created_at: "2026-11-08T05:00:00.000Z",
};

function store(initial: SavedApplicationMaterial[]) {
  const rows = [...initial];
  return {
    rows,
    get: async (workspaceId: string, id: string) =>
      rows.find((row) => row.workspace_id === workspaceId && row.id === id),
    list: async (workspaceId: string, applicationId: string) =>
      rows
        .filter((row) => row.workspace_id === workspaceId && row.application_id === applicationId)
        .reverse(),
    insert: async (material: SavedApplicationMaterial) => {
      rows.push(material);
    },
  };
}

const critic = (findings: unknown[], calls: number[] = []): MaterialCriticPort => ({
  review: async () => {
    calls.push(1);
    return {
      findings: findings as never,
      model: { provider: "openai", model: "critic-model" },
    };
  },
});

function author(text: string, factIds: string[], seen: ApplicationMaterialRequest[] = []) {
  return {
    draft: async (request: ApplicationMaterialRequest) => {
      seen.push(request);
      return {
        items: [{ question: "", text, factIds }],
        model: { provider: "anthropic", model: "claude-sonnet-5-5" },
      };
    },
  } satisfies ApplicationMaterialPort;
}

const stock = [{ paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock word" }];

function command(
  overrides: Partial<ReviewSavedApplicationMaterialCommand>,
): ReviewSavedApplicationMaterialCommand {
  return {
    drafts: store([base]),
    workspaceId: "ws_fixture",
    applicationId: "app_fixture0001",
    materialId: base.id,
    input: {
      facts: [
        { id: "t", category: "role", field: "title", value: "Data Analyst" },
        { id: "o", category: "achievement", field: "outcome", value: "Cut report time by 40%" },
      ],
      requirements: [{ id: "r1", text: "Reporting with SQL", priority: "high" }],
    },
    language: "en",
    critic: critic(stock),
    author: author("As a Data Analyst I cut report time by 40%.", ["t", "o"]),
    newId: () => "amd_revisionfixture1",
    now: () => new Date("2026-11-08T05:01:00.000Z"),
    spentUsd: () => 0.01,
    ...overrides,
  };
}

describe("critic pass on a saved cover letter", () => {
  it("saves the revision as the next version with its findings", async () => {
    const drafts = store([base]);
    const seen: ApplicationMaterialRequest[] = [];
    const result = await reviewSavedApplicationMaterial(
      command({
        drafts,
        author: author("As a Data Analyst I cut report time by 40%.", ["t", "o"], seen),
      }),
    );
    expect(result.outcome).toBe("revised");
    expect(drafts.rows).toHaveLength(2);
    expect(drafts.rows[1]).toEqual({
      ...base,
      id: "amd_revisionfixture1",
      created_at: "2026-11-08T05:01:00.000Z",
      items: [
        {
          question: "",
          text: "As a Data Analyst I cut report time by 40%.",
          citations: base.items[0]?.citations,
        },
      ],
      based_on: base.id,
      critic_findings: stock,
      critic_model: { provider: "openai", model: "critic-model" },
      cost_usd: 0.01,
    });
    expect(seen[0]?.context.guidance).toEqual({ tone: "direct" });
  });

  it("keeps the letter's company citations and offers no new finding", async () => {
    const withResearch: SavedApplicationMaterial = {
      ...base,
      items: [
        {
          ...(base.items[0] as SavedApplicationMaterial["items"][number]),
          company_citations: [
            { finding_id: "fnd_2", text: "Example Corp builds tools for clinics." },
          ],
        },
      ],
      research_brief_id: "rbr_fixture0001",
    };
    const drafts = store([withResearch]);
    const seen: ApplicationMaterialRequest[] = [];
    const revising = {
      draft: async (request: ApplicationMaterialRequest) => {
        seen.push(request);
        return {
          items: [
            {
              question: "",
              text: "As a Data Analyst I cut report time by 40%, and clinic tools appeal to me.",
              factIds: ["t", "o"],
              companyFactIds: ["fnd_2"],
            },
          ],
        };
      },
    } satisfies ApplicationMaterialPort;
    const result = await reviewSavedApplicationMaterial(
      command({ drafts, materialId: withResearch.id, author: revising }),
    );
    expect(result.outcome).toBe("revised");
    expect(seen[0]?.context.company).toEqual([
      { id: "fnd_2", text: "Example Corp builds tools for clinics." },
    ]);
    expect(seen[0]?.revision?.previous[0]?.companyFactIds).toEqual(["fnd_2"]);
    expect(drafts.rows[1]?.items[0]?.company_citations).toEqual(
      withResearch.items[0]?.company_citations,
    );
    expect(drafts.rows[1]?.research_brief_id).toBe("rbr_fixture0001");
  });

  it("saves nothing when the critic finds nothing or the revision breaks a rule", async () => {
    const clean = store([base]);
    expect(
      (await reviewSavedApplicationMaterial(command({ drafts: clean, critic: critic([]) })))
        .outcome,
    ).toBe("clean");
    const broken = store([base]);
    const kept = await reviewSavedApplicationMaterial(
      command({ drafts: broken, author: author("I cut report time by 75%.", ["o"]) }),
    );
    expect(kept).toEqual({ outcome: "kept", findings: 1 });
    expect(clean.rows).toHaveLength(1);
    expect(broken.rows).toHaveLength(1);
  });

  it("calls no model for questions, edited or revised versions, or another application", async () => {
    const calls: number[] = [];
    const cases: SavedApplicationMaterial[] = [
      { ...base, kind: "interview-questions" },
      {
        ...base,
        items: [{ ...(base.items[0] as SavedApplicationMaterial["items"][number]), edited: true }],
      },
      { ...base, based_on: "amd_otherfixture01" },
    ];
    for (const material of cases) {
      const result = await reviewSavedApplicationMaterial(
        command({ drafts: store([material]), critic: critic(stock, calls) }),
      );
      expect(result.outcome).toBe("skipped");
    }
    const elsewhere = await reviewSavedApplicationMaterial(
      command({ applicationId: "app_otherfixture1", critic: critic(stock, calls) }),
    );
    expect(elsewhere.outcome).toBe("missing");
    expect(calls).toHaveLength(0);
  });

  it("leaves the candidate's newer version as the newest", async () => {
    const drafts = store([base]);
    const edit = { ...base, id: "amd_editfixture001", based_on: base.id };
    const result = await reviewSavedApplicationMaterial(
      command({
        drafts,
        author: {
          draft: async (request) => {
            await drafts.insert(edit);
            return author("As a Data Analyst I cut report time by 40%.", ["t", "o"]).draft(request);
          },
        },
      }),
    );
    expect(result.outcome).toBe("superseded");
    expect(drafts.rows.map((row) => row.id)).toEqual([base.id, edit.id]);
  });
});
