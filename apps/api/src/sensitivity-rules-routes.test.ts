import {
  type ApplicationService,
  CliUserError,
  HostedKnowledgeIntakeError,
  type HostedSensitivityRules,
  type SourceSensitivityRulesView,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const rulesUrl = "/v1/knowledge-bases/career/sensitivity-rules";

const view: SourceSensitivityRulesView = {
  knowledgeBaseId: "career",
  version: 1,
  checksum: "c".repeat(64),
  createdAt: "2026-10-23T08:00:00.000Z",
  rules: [
    {
      id: "private-notes",
      tier: "never-share",
      match: { kind: "heading-contains", text: "Notes" },
    },
  ],
};

let app: FastifyInstance;

async function build(rules: Partial<HostedSensitivityRules>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: {} as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      sensitivityRules: rules as HostedSensitivityRules,
    },
  });
}

const add = (payload: unknown) =>
  app.inject({
    method: "POST",
    url: rulesUrl,
    headers: { authorization },
    payload: payload as Record<string, unknown>,
  });

afterEach(async () => {
  await app.close();
});

describe("sensitivity rule routes", () => {
  it("lists a knowledge base's rules without the list's checksum", async () => {
    const list = vi.fn(async () => view);
    await build({ list });

    const response = await app.inject({ method: "GET", url: rulesUrl, headers: { authorization } });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith("career");
    expect(response.json()).toEqual({
      knowledgeBaseId: "career",
      version: 1,
      createdAt: view.createdAt,
      rules: view.rules,
    });
  });

  it("adds a rule, with or without an id", async () => {
    const addRule = vi.fn(async () => view);
    await build({ add: addRule });

    const named = await add({
      id: "private-notes",
      tier: "never-share",
      match: { kind: "heading-contains", text: "Notes" },
    });
    const generated = await add({
      tier: "sensitive",
      match: { kind: "heading-path", path: ["Experience", "Salary"] },
    });

    expect(named.statusCode).toBe(201);
    expect(generated.statusCode).toBe(201);
    expect(addRule.mock.calls).toEqual([
      [
        "career",
        { tier: "never-share", match: { kind: "heading-contains", text: "Notes" } },
        "private-notes",
      ],
      [
        "career",
        { tier: "sensitive", match: { kind: "heading-path", path: ["Experience", "Salary"] } },
        undefined,
      ],
    ]);
  });

  it.each([
    ["an unknown tier", { tier: "secret", match: { kind: "heading-contains", text: "Notes" } }],
    ["an empty heading", { tier: "never-share", match: { kind: "heading-contains", text: " " } }],
    ["an empty path", { tier: "never-share", match: { kind: "heading-path", path: [] } }],
    [
      "an unsafe id",
      { id: "../x", tier: "never-share", match: { kind: "heading-contains", text: "Notes" } },
    ],
    [
      "an extra field",
      { tier: "never-share", match: { kind: "heading-contains", text: "N" }, at: 1 },
    ],
  ])("refuses %s before saving", async (_name, payload) => {
    const addRule = vi.fn();
    await build({ add: addRule });

    expect((await add(payload)).statusCode).toBe(400);
    expect(addRule).not.toHaveBeenCalled();
  });

  it("answers 422 to a refused change and 404 to an unknown knowledge base", async () => {
    await build({
      add: async () => {
        throw new CliUserError("A sensitivity rule with id private-notes already exists.");
      },
      remove: async () => {
        throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
      },
    });

    const refused = await add({
      id: "private-notes",
      tier: "never-share",
      match: { kind: "heading-contains", text: "Notes" },
    });
    const missing = await app.inject({
      method: "DELETE",
      url: `${rulesUrl}/private-notes`,
      headers: { authorization },
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toBe(
      "A sensitivity rule with id private-notes already exists.",
    );
    expect(missing.statusCode).toBe(404);
  });

  it("removes a rule by id", async () => {
    const remove = vi.fn(async () => ({ ...view, version: 2, rules: [] }));
    await build({ remove });

    const response = await app.inject({
      method: "DELETE",
      url: `${rulesUrl}/private-notes`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(remove).toHaveBeenCalledWith("career", "private-notes");
    expect(response.json().rules).toEqual([]);
  });
});
