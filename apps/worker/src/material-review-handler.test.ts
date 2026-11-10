import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import { describe, expect, it } from "vitest";

import {
  createMaterialReviewHandler,
  type MaterialReviewHandlerOptions,
} from "./material-review-handler.js";

type SavedApplicationMaterial = Parameters<SavedApplicationMaterialStore["insert"]>[0];

const job = {
  tenantId: "tenant-a",
  workspaceId: "ws_fixture",
  applicationId: "app_fixture0001",
  materialId: "amd_letterfixture01",
};

const letter: SavedApplicationMaterial = {
  id: job.materialId,
  workspace_id: job.workspaceId,
  application_id: job.applicationId,
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
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "application-material-v11",
  cost_usd: 0.02,
  created_at: "2026-11-08T05:00:00.000Z",
};

function drafts(rows: SavedApplicationMaterial[]) {
  return {
    rows,
    insert: async (material: SavedApplicationMaterial) => {
      rows.push(material);
    },
    get: async (_workspaceId: string, id: string) => rows.find((row) => row.id === id),
    list: async () => [...rows].reverse(),
    delete: async () => false,
  };
}

const service = (criticCompany = "openai") =>
  ({
    readWorkspace: async () => ({
      fixtureMode: false,
      language: "en",
      critic: { company: criticCompany, model: "critic-model" },
    }),
    getApplication: async () => ({ briefs: [], language: "en" }),
    listCanonicalCandidateProfileVersions: async () => [
      {
        profile: {
          updatedAt: "2026-11-08T04:00:00.000Z",
          facts: [
            { id: "t", category: "role", field: "title", value: "Data Analyst" },
            { id: "o", category: "achievement", field: "outcome", value: "Cut report time by 40%" },
          ],
        },
      },
    ],
    getOpportunity: async () => undefined,
  }) as never;

function options(
  overrides: Partial<MaterialReviewHandlerOptions> = {},
  store = drafts([letter]),
  calls: string[] = [],
): MaterialReviewHandlerOptions {
  return {
    serviceFor: () => service(),
    draftsFor: () => store as never,
    workspaceRoot: () => "hosted:tenant-a/ws_fixture",
    allowProviderData: true,
    newId: () => "amd_revisionfixture1",
    now: () => new Date("2026-11-08T05:01:00.000Z"),
    portsFor: (_job, models) => {
      calls.push(`${models.author.company}/${models.critic.company}`);
      return {
        critic: {
          review: async () => ({
            findings: [
              { paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock word" },
            ],
            model: { provider: "openai", model: "critic-model" },
          }),
        },
        author: {
          draft: async () => ({
            items: [
              {
                question: "",
                text: "As a Data Analyst I cut report time by 40%.",
                factIds: ["t", "o"],
              },
            ],
          }),
        },
        spentUsd: () => 0.01,
      };
    },
    ...overrides,
  };
}

describe("material review job", () => {
  it("saves the revision and logs ids and counts only", async () => {
    const store = drafts([letter]);
    const calls: string[] = [];
    const lines: unknown[] = [];
    const handle = createMaterialReviewHandler(
      options({ onOutcome: (...line) => lines.push(line) }, store, calls),
    );
    expect(await handle(job)).toBe("revised");
    expect(calls).toEqual(["anthropic/openai"]);
    expect(store.rows[1]).toMatchObject({
      id: "amd_revisionfixture1",
      based_on: letter.id,
      critic_model: { provider: "openai", model: "critic-model" },
      cost_usd: 0.01,
    });
    expect(lines).toEqual([
      [job, "revised", { findings: 1, costUsd: 0.01, revisionId: "amd_revisionfixture1" }],
    ]);
    expect(JSON.stringify(lines)).not.toContain("Data Analyst");
  });

  it("makes no call when the record is erased, lacks consent or has no other company", async () => {
    const calls: string[] = [];
    const cases: [Partial<MaterialReviewHandlerOptions>, string][] = [
      [{ recordErased: async () => true }, "record-erased"],
      [{ consentFor: async () => false }, "consent-required"],
      [{ serviceFor: () => service("anthropic") }, "unavailable"],
      [{ allowProviderData: false }, "unavailable"],
    ];
    for (const [overrides, outcome] of cases) {
      const store = drafts([letter]);
      expect(await createMaterialReviewHandler(options(overrides, store, calls))(job)).toBe(
        outcome,
      );
      expect(store.rows).toHaveLength(1);
    }
    expect(
      await createMaterialReviewHandler(
        options({}, drafts([{ ...letter, based_on: "amd_otherfixture01" }]), calls),
      )(job),
    ).toBe("skipped");
    expect(await createMaterialReviewHandler(options({}, drafts([]), calls))(job)).toBe("missing");
    expect(calls).toEqual([]);
  });
});
