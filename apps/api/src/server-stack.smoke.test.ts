import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Set by `pnpm server:test` once the local stack is up (docs/operations/local-server-stack.md);
 * skipped otherwise. The smoke drives the API and the worker containers end to end, through the
 * API only: nothing is seeded in the database or the bucket.
 */
const apiUrl = process.env.DRAFT_LOOP_TEST_API_URL;

const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** The response fields the smoke reads; each response carries the ones its route returns. */
interface ResponseBody {
  readonly id: string;
  readonly runId: string;
  readonly state: string;
  readonly brief: { readonly id: string; readonly version: number };
}

describe.runIf(apiUrl !== undefined)("local server stack", () => {
  // Fresh ids each time, so the smoke runs again on a stack that keeps earlier data.
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `smoke-${suffix}`;
  const workspacePath = `/v1/workspaces/${workspaceId}`;

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${process.env.DRAFT_LOOP_TEST_API_OWNER_TOKEN ?? ""}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    return { status: response.status, body: (await response.json()) as ResponseBody };
  };
  const send = (method: string, path: string, body: object, headers: HeadersInit = {}) =>
    request(path, { method, headers, body: JSON.stringify(body) });

  it("sets up a workspace through the API and reads its run back once the worker has drafted it", async () => {
    expect(await send("PUT", workspacePath, { fixtureMode: true })).toMatchObject({ status: 201 });

    const base = await send("POST", "/v1/knowledge-bases", { displayName: `Career ${suffix}` });
    expect(base.status).toBe(201);
    const upload = await request(`/v1/knowledge-bases/${base.body.id}/sources?name=career.md`, {
      method: "POST",
      headers: { "content-type": "text/markdown" },
      body: career,
    });
    expect(upload.status).toBe(201);
    expect(
      await send("PUT", `${workspacePath}/knowledge-selection`, {
        knowledgeBaseIds: [base.body.id],
      }),
    ).toMatchObject({ status: 200 });

    const created = await send("POST", `${workspacePath}/opportunities`, {
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger: build TypeScript services.",
        },
      ],
    });
    expect(created.status).toBe(201);
    const briefPath = `${workspacePath}/opportunities/${created.body.brief.id}`;
    const edited = await send("PATCH", briefPath, {
      expectedVersion: created.body.brief.version,
      patch: {
        role: { value: "Platform Engineer", sourceIds: ["posting"] },
        requirements: [
          {
            id: "typescript-services",
            text: "Build TypeScript services with deterministic testing",
            priority: "critical",
            sourceIds: ["posting"],
          },
        ],
      },
    });
    expect(edited.status).toBe(200);
    const reviewed = await send("POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);

    const begun = await send(
      "POST",
      `${workspacePath}/runs`,
      {
        opportunityBrief: { briefId: reviewed.body.brief.id, version: reviewed.body.brief.version },
      },
      { "idempotency-key": `smoke-${suffix}` },
    );
    expect(begun.status).toBe(201);
    let latest = begun.body;
    for (let attempt = 0; attempt < 60 && latest.state !== "awaiting-approval"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      latest = (await request(`${workspacePath}/runs/${begun.body.runId}`)).body;
    }
    expect(latest).toMatchObject({
      runId: begun.body.runId,
      state: "awaiting-approval",
      hasDraft: true,
      approval: "pending",
    });
  }, 120_000);
});
