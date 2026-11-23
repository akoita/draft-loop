import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import type { ApplicationMaterialDraft } from "./application-material-model.js";
import { createHttpBridge } from "./http-bridge.js";

// Invented content only.
const kitDraft: ApplicationMaterialDraft = {
  id: "amd_fixturekit01",
  created_at: "2026-11-20T09:00:00.000Z",
  kind: "cover-letter-kit",
  items: [],
  kit: {
    requirements: [
      {
        requirement_id: "r1",
        text: "Builds SQL reporting",
        facts: [{ fact_id: "f1", text: "Cut report time by 40%" }],
      },
    ],
    angles: [
      { note: "Lead with the 40% faster reports", fact_ids: ["f1"], finding_ids: [] },
      { note: "Open on their new office", fact_ids: [], finding_ids: ["e1"] },
    ],
    employer_facts: [{ finding_id: "e1", text: "Opened an office", published_on: "2026-10-02" }],
    outline: [1, 2, 3, 4].map((paragraph) => ({
      paragraph,
      purpose: `Paragraph ${paragraph} purpose`,
      requirement_ids: paragraph === 2 ? ["r1"] : [],
      fact_ids: [],
      finding_ids: [],
    })),
    avoid: ["passionate about"],
  },
  model: { provider: "anthropic", model: "claude-haiku-4-5" },
  prompt_version: "cover-letter-kit-v1",
  cost_usd: 0.01,
};

const ownLetter = (id: string, texts: readonly string[]): ApplicationMaterialDraft => ({
  id,
  created_at: "2026-11-21T10:00:00.000Z",
  kind: "cover-letter",
  items: texts.map((text) => ({ question: "", text, edited: true, citations: [] })),
  based_on: "amd_fixturekit01",
  written_by: "candidate",
  model: { provider: "anthropic", model: "claude-haiku-4-5" },
  prompt_version: "cover-letter-kit-v1",
  cost_usd: 0,
});

const {
  written_by: _writer,
  based_on: _basedOn,
  ...modelFields
} = ownLetter("amd_fixturemodel", ["Model text."]);
const modelLetter: ApplicationMaterialDraft = {
  ...modelFields,
  items: [{ question: "", text: "Model text.", citations: [] }],
};

function harness(answer: (operation: string, input: unknown) => unknown) {
  const calls: { operation: string; input: unknown }[] = [];
  const downloads: string[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input });
      return answer(operation, input) as never;
    },
  };
  const port = createCapabilityPort(
    createHttpBridge({ client, download: (_bytes, name) => downloads.push(name) }),
  );
  return { calls, downloads, port };
}

const scope = { workspaceId: "owner", applicationId: "app_fixture0001" };
const base = "/v1/workspaces/{workspaceId}/applications/{applicationId}";

describe("the writing kit over HTTP", () => {
  it("loads the newest kit and the newest letter the person wrote, not a model's", async () => {
    const { calls, port } = harness((_operation, input) => {
      const kind = (input as { query: { kind: string } }).query.kind;
      return {
        drafts:
          kind === "cover-letter-kit"
            ? [kitDraft]
            : [modelLetter, ownLetter("amd_fixtureown01", ["Dear team,", "My words."])],
      };
    });
    for (const command of [
      "cover-letter-kit.load",
      "cover-letter-kit.prepare",
      "cover-letter-kit.save-letter",
      "cover-letter-kit.download-letter",
    ] as const) {
      expect(port.hasCapability(command)).toBe(true);
    }
    const result = await port.execute({ type: "cover-letter-kit.load", input: scope });
    expect(calls.map((call) => call.input)).toEqual([
      { path: scope, query: { kind: "cover-letter-kit" } },
      { path: scope, query: { kind: "cover-letter" } },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        kit: {
          id: "amd_fixturekit01",
          model: "claude-haiku-4-5",
          requirements: [{ requirementId: "r1", facts: [{ factId: "f1" }] }],
          employerFacts: [{ findingId: "e1", publishedOn: "2026-10-02" }],
          avoid: ["passionate about"],
        },
        letter: { id: "amd_fixtureown01", paragraphs: ["Dear team,", "My words."] },
      },
    });
  });

  it("loads nothing on a server that keeps no drafts", async () => {
    const { port } = harness(() => {
      throw new ApiRequestError(404, "not_found", "No drafts here.");
    });
    expect(await port.execute({ type: "cover-letter-kit.load", input: scope })).toEqual({
      ok: true,
      value: { kit: null, letter: null },
    });
  });

  it("prepares a kit and saves the person's letter as a version based on it", async () => {
    const { calls, port } = harness((operation) =>
      operation.endsWith("/cover-letter-kit")
        ? kitDraft
        : ownLetter("amd_fixtureown02", ["Dear team,", "Mine."]),
    );
    const prepared = await port.execute({ type: "cover-letter-kit.prepare", input: scope });
    expect(prepared).toMatchObject({ ok: true, value: { kit: { id: "amd_fixturekit01" } } });
    const saved = await port.execute({
      type: "cover-letter-kit.save-letter",
      input: { ...scope, basedOn: "amd_fixturekit01", paragraphs: ["Dear team,", "Mine."] },
    });
    expect(saved).toMatchObject({ ok: true, value: { letter: { id: "amd_fixtureown02" } } });
    expect(calls).toEqual([
      { operation: `POST ${base}/cover-letter-kit`, input: { path: scope } },
      {
        operation: `POST ${base}/material/{materialId}/versions`,
        input: {
          path: { ...scope, materialId: "amd_fixturekit01" },
          body: { items: [{ text: "Dear team," }, { text: "Mine." }] },
        },
      },
    ]);
  });

  it("downloads the person's letter at once, with no AI-draft confirm", async () => {
    const asked: string[] = [];
    globalThis.confirm = (question?: string) => {
      asked.push(question ?? "");
      return false;
    };
    const { calls, downloads, port } = harness(() => new Blob(["%PDF"]));
    const result = await port.execute({
      type: "cover-letter-kit.download-letter",
      input: { ...scope, letterId: "amd_fixtureown01", format: "pdf", template: "classic" },
    });
    expect(result).toEqual({ ok: true, value: { letterId: "amd_fixtureown01" } });
    expect(calls).toEqual([
      {
        operation: `GET ${base}/material/{materialId}/document`,
        input: {
          path: { ...scope, materialId: "amd_fixtureown01" },
          query: { format: "pdf", template: "classic" },
        },
      },
    ]);
    expect(downloads).toEqual(["cover-letter.pdf"]);
    expect(asked).toEqual([]);
  });

  it("words a refusal for the person", async () => {
    const { port } = harness(() => {
      throw new ApiRequestError(409, "no_requirements", "The brief lists no requirement.");
    });
    const result = await port.execute({ type: "cover-letter-kit.prepare", input: scope });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error.message).toContain("Extract the requirements first");
  });
});
