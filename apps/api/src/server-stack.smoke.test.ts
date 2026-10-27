import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Set by `pnpm server:test` once the local stack is up (docs/operations/local-server-stack.md);
 * skipped otherwise. The smoke drives the API and the worker containers end to end, through the
 * API only: nothing is seeded in the database or the bucket.
 */
const apiUrl = process.env.DRAFT_LOOP_TEST_API_URL;
/**
 * A small public page the deployment's smoke reads as a job page; unset, that step is skipped. A
 * deployment's API reaches the internet only through the page fetcher (#1837).
 */
const jobPageUrl = process.env.DRAFT_LOOP_TEST_JOB_PAGE_URL;

const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** The response fields the smoke reads; each response carries the ones its route returns. */
interface ResponseBody {
  readonly id: string;
  readonly runId: string;
  readonly state: string;
  readonly round: number;
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly sources?: readonly {
      readonly status: string;
      readonly provenance?: { readonly kind: string };
    }[];
  };
  readonly run: { readonly state: string; readonly round: number };
  readonly draft: { readonly sections: readonly unknown[] } | null;
  readonly findings: readonly {
    readonly id: string;
    readonly severity: string;
    readonly decision: string;
  }[];
  readonly candidateDirection: string | null;
  readonly error: { readonly code: string };
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly exports: readonly { readonly id: string }[];
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
  /** Waits for the worker to bring a run to the person's review. */
  const awaitReview = async (runId: string) => {
    let latest = (await request(`${workspacePath}/runs/${runId}`)).body;
    for (let attempt = 0; attempt < 60 && latest.state !== "awaiting-approval"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      latest = (await request(`${workspacePath}/runs/${runId}`)).body;
    }
    return latest;
  };
  let brief: { briefId: string; version: number } | undefined;
  let firstRunId = "";

  it("serves the web screen and its script without a token", async () => {
    const page = await fetch(`${apiUrl}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await page.text();
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1];
    expect(script).toMatch(/^\/assets\//);
    expect((await fetch(`${apiUrl}${script}`)).status).toBe(200);
  });

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

    brief = { briefId: reviewed.body.brief.id, version: reviewed.body.brief.version };
    const begun = await send(
      "POST",
      `${workspacePath}/runs`,
      { opportunityBrief: brief },
      { "idempotency-key": `smoke-${suffix}` },
    );
    expect(begun.status).toBe(201);
    firstRunId = begun.body.runId;
    expect(await awaitReview(firstRunId)).toMatchObject({
      runId: firstRunId,
      state: "awaiting-approval",
      hasDraft: true,
      approval: "pending",
    });
  }, 120_000);

  const settled = (severity: string) => (severity === "error" ? "overridden" : "accepted");

  /** Decides every finding, approves, exports a DOCX and downloads it, checking its bytes. */
  const approveAndDownload = async (runId: string) => {
    const runPath = `${workspacePath}/runs/${runId}`;
    const review = await request(`${runPath}/review`);
    expect(review.status).toBe(200);
    expect(review.body.draft?.sections.length).toBeGreaterThan(0);
    for (const finding of review.body.findings) {
      const decided = await send(
        "PUT",
        `${runPath}/findings/${encodeURIComponent(finding.id)}/decision`,
        // A blocking finding is overridden: accepting it would only ask for another round.
        {
          decision: settled(finding.severity),
          rationale: "Checked against the source.",
        },
      );
      expect(decided.status).toBe(200);
    }
    const decided = await request(`${runPath}/review`);
    expect(
      decided.body.findings.filter(({ decision, severity }) => decision !== settled(severity)),
    ).toEqual([]);

    let approved = await send("POST", `${runPath}/approve`, {});
    if (approved.status === 409 && approved.body.error.code === "readiness_blocked") {
      approved = await send("POST", `${runPath}/approve`, {
        readinessOverrideRationale: "Synthetic smoke run: the owner accepts the open checks.",
      });
    }
    expect(approved).toMatchObject({ status: 200, body: { state: "approved" } });

    const exported = await send(
      "POST",
      `${runPath}/exports`,
      { format: "docx" },
      { "idempotency-key": `export-${runId}` },
    );
    expect(exported.status).toBe(201);
    expect((await request(`${runPath}/exports`)).body.exports.map(({ id }) => id)).toEqual([
      exported.body.id,
    ]);
    const download = await fetch(
      `${apiUrl}${runPath}/exports/${encodeURIComponent(exported.body.id)}/content`,
      { headers: { authorization: `Bearer ${process.env.DRAFT_LOOP_TEST_API_OWNER_TOKEN ?? ""}` } },
    );
    expect(download.status).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.byteLength).toBe(exported.body.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(exported.body.checksum);
    expect(download.headers.get("x-content-sha256")).toBe(exported.body.checksum);
    // A DOCX is a zip archive.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect((await request(runPath)).body.state).toBe("exported");
  };

  it("decides the run's findings, approves it and downloads its DOCX", async () => {
    await approveAndDownload(firstRunId);
  }, 60_000);

  it("takes a second run through one revision round before exporting it", async () => {
    const begun = await send(
      "POST",
      `${workspacePath}/runs`,
      { opportunityBrief: brief },
      { "idempotency-key": `smoke-revision-${suffix}` },
    );
    expect(begun.status).toBe(201);
    const drafted = await awaitReview(begun.body.runId);
    expect(drafted.state).toBe("awaiting-approval");

    const revision = await send(
      "POST",
      `${workspacePath}/runs/${begun.body.runId}/revision`,
      { candidateDirection: "Lead with the TypeScript services." },
      { "idempotency-key": `revision-${suffix}` },
    );
    expect(revision).toMatchObject({ status: 200, body: { state: "revising" } });
    expect(await awaitReview(begun.body.runId)).toMatchObject({
      state: "awaiting-approval",
      round: drafted.round + 1,
    });
    expect((await request(`${workspacePath}/runs/${begun.body.runId}/review`)).body).toMatchObject({
      candidateDirection: "Lead with the TypeScript services.",
    });
    await approveAndDownload(begun.body.runId);
  }, 120_000);

  it.runIf(jobPageUrl !== undefined)(
    "reads an approved job page through the page fetcher",
    async () => {
      const application = await send("POST", `${workspacePath}/applications`, {
        name: `Job page ${suffix}`,
        jobUrl: jobPageUrl,
        jobUrlApproved: true,
      });
      expect(application.status).toBe(201);
      const created = await send("POST", `${workspacePath}/opportunities`, {
        applicationId: application.body.id,
        sources: [
          {
            id: "posting",
            kind: "approved-url",
            classification: "job-posting",
            url: jobPageUrl,
            approved: true,
          },
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.brief.sources).toEqual([
        expect.objectContaining({
          status: "available",
          provenance: expect.objectContaining({ kind: "approved-url" }),
        }),
      ]);
    },
    60_000,
  );
});
