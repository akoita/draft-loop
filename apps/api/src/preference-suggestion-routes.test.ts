import { type ApplicationService, CliUserError } from "@draft-loop/application";
import type {
  PreferenceSuggestion,
  PreferenceSuggestions,
} from "@draft-loop/application/preference-suggestions";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const base = "/v1/workspaces/workspace-1/preference-suggestions";
const root = "/tenants/owner/workspaces/workspace-1";
const id = "preference-0123456789abcdef";

const suggestion: PreferenceSuggestion = {
  id,
  kind: "section-order",
  sectionOrder: ["summary", "skills", "experience"],
  occurrences: 3,
  applications: 2,
  reason: "You approved 3 drafts across 2 applications with sections in this order.",
};

let app: FastifyInstance;

async function build(suggestions?: PreferenceSuggestions): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: {} as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      ...(suggestions === undefined ? {} : { preferenceSuggestions: suggestions }),
    },
  });
}

function fake(): PreferenceSuggestions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: vi.fn(async (at: string) => {
      calls.push(`list ${at}`);
      return [suggestion];
    }),
    accept: vi.fn(async (at: string, chosen: string) => {
      calls.push(`accept ${at} ${chosen}`);
      if (chosen !== id) throw new CliUserError("No such suggestion.");
      return suggestion;
    }),
    dismiss: vi.fn(async (at: string, chosen: string) => {
      calls.push(`dismiss ${at} ${chosen}`);
    }),
  };
}

afterEach(async () => {
  await app.close();
});

describe("preference suggestion routes", () => {
  it("lists the suggestions for the workspace", async () => {
    const suggestions = fake();
    await build(suggestions);
    const response = await app.inject({ method: "GET", url: base, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ suggestions: [suggestion] });
    expect(suggestions.calls).toEqual([`list ${root}`]);
  });

  it("accepts and dismisses by id", async () => {
    const suggestions = fake();
    await build(suggestions);
    const accepted = await app.inject({
      method: "POST",
      url: `${base}/${id}/accept`,
      headers: { authorization },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: suggestion });
    const dismissed = await app.inject({
      method: "POST",
      url: `${base}/${id}/dismiss`,
      headers: { authorization },
    });
    expect(dismissed.json()).toEqual({ dismissed: id });
    expect(suggestions.calls).toEqual([`accept ${root} ${id}`, `dismiss ${root} ${id}`]);
  });

  it("refuses a malformed id and answers an unknown one as rejected", async () => {
    await build(fake());
    const malformed = await app.inject({
      method: "POST",
      url: `${base}/not-an-id/accept`,
      headers: { authorization },
    });
    expect(malformed.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "POST",
      url: `${base}/preference-ffffffffffffffff/accept`,
      headers: { authorization },
    });
    expect(unknown.statusCode).toBe(422);
  });

  it("is not served without suggestions", async () => {
    await build();
    const response = await app.inject({ method: "GET", url: base, headers: { authorization } });
    expect(response.statusCode).toBe(404);
  });
});
