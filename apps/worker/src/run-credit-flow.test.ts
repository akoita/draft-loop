import { randomUUID } from "node:crypto";
import type { ApplicationService } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import {
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
} from "@draft-loop/storage-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assignInternalPlan, runtimeRole, runtimeUrl } from "./hosted-test-support.js";
import { runCreditsFields, runCreditsMessage } from "./logging.js";
import { type RunCreditsClosed, tenantRunCredits } from "./run-credit-settlement.js";
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const organisation = "org-credits";
/** A deployment's tenant in owner-token mode: no organisation row, so no ledger. */
const ownerTenant = "owner-tenant";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const hour = 60 * 60 * 1000;

type Service = Pick<ApplicationService, "status" | "resume">;

/** Only the fields the worker reads; the rest of a snapshot does not matter here. */
function snapshot(
  runId: string,
  state: string,
  options: { draft?: boolean; lastError?: object | null } = {},
): RunSnapshot {
  return {
    runId,
    workspaceId: "workspace-1",
    state,
    lastError: options.lastError ?? null,
    artifact: options.draft === true ? { id: "artifact-1" } : null,
    budget: { maxRounds: 3, maxCostUsd: 2, maxDurationMs: 600_000 },
    executionHistory: [],
    totalCostUsd: 0,
  } as unknown as RunSnapshot;
}

describe.runIf(connectionString !== undefined)("run credits on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `credit_flow_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  let tenancy: PostgresTenancy;
  const closed: RunCreditsClosed[] = [];

  const ledger = (tenantId = organisation) => tenancy.forTenant(tenantId).creditLedger;
  const reserve = (runId: string, reservedAt = new Date()) =>
    ledger().reserve({ runId, credits: 2, estimateVersion: 1, now: reservedAt });
  const stateOf = async (runId: string) => (await ledger().reservationFor(runId))?.state;
  const rowCount = async (kind: string, runId: string) =>
    Number(
      (
        await admin.query(
          `SELECT count(*) AS n FROM ${schema}.credit_ledger WHERE run_id = $1 AND kind = $2`,
          [runId, kind],
        )
      ).rows[0].n,
    );

  /** A handler over a service that reports `status` and, when resumed, `resumed`. */
  function handlerFor(
    status: RunSnapshot | undefined,
    resumed?: RunSnapshot,
    extra: { recordErased?: boolean } = {},
  ) {
    const service = {
      status: vi.fn<Service["status"]>(async () => status),
      resume: vi.fn<Service["resume"]>(async () => {
        if (resumed === undefined) throw new Error("unexpected resume");
        return resumed;
      }),
    };
    const outcomes: RunJobOutcome[] = [];
    const handle = createRunJobHandler({
      serviceFor: () => service,
      workspaceRoot: () => "/unused",
      allowProviderData: true,
      budgetCeiling,
      ...(extra.recordErased === undefined
        ? {}
        : { recordErased: async () => extra.recordErased === true }),
      credits: tenantRunCredits({ tenancy, onClosed: (entry) => closed.push(entry) }),
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
    const run = (tenantId: string, runId: string) =>
      handle({ tenantId, workspaceId: "workspace-1", runId }, { requeue: async () => undefined });
    return { service, outcomes, run };
  }

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    await admin.query(`INSERT INTO ${schema}.organisations (id, name) VALUES ($1, $2)`, [
      organisation,
      "Fictional credits organisation",
    ]);
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    await assignInternalPlan(tenancy, organisation);
  });

  afterAll(async () => {
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("settles a run that reached a draft, once, however often its job is repeated", async () => {
    await reserve("run-draft");
    closed.length = 0;
    const { run, service } = handlerFor(
      snapshot("run-draft", "drafting"),
      snapshot("run-draft", "awaiting-approval", { draft: true }),
    );

    await run(organisation, "run-draft");
    await run(organisation, "run-draft");

    expect(service.resume).toHaveBeenCalledTimes(2);
    expect(await stateOf("run-draft")).toBe("settled");
    expect(await rowCount("settle", "run-draft")).toBe(1);
    expect(await rowCount("refund", "run-draft")).toBe(0);
    expect(closed).toEqual([
      {
        organisationId: organisation,
        runId: "run-draft",
        credits: 2,
        estimateVersion: 1,
        outcome: "settled",
        estimatedUsd: 0,
      },
    ]);
    // The line the margin alert reads: a stable message, ids and numbers only.
    expect(runCreditsMessage).toBe("run credits settled");
    expect(runCreditsFields(closed[0] as RunCreditsClosed)).toEqual(closed[0]);
  });

  it("refunds a run that failed before its first draft, and does not execute it again", async () => {
    await reserve("run-failed");
    closed.length = 0;
    // A failure with no attempts left: the worker does not retry it (#1763).
    const failed = snapshot("run-failed", "provider-error", {
      lastError: { code: "timeout", retryable: false },
    });
    const first = handlerFor(snapshot("run-failed", "drafting"), failed);

    await first.run(organisation, "run-failed");
    const replay = handlerFor(failed, snapshot("run-failed", "awaiting-approval", { draft: true }));
    await replay.run(organisation, "run-failed");

    expect(await stateOf("run-failed")).toBe("refunded");
    expect(await rowCount("refund", "run-failed")).toBe(1);
    expect(await rowCount("settle", "run-failed")).toBe(0);
    expect(closed).toMatchObject([{ runId: "run-failed", outcome: "refunded", credits: 2 }]);
    expect(replay.outcomes).toEqual(["credits-closed"]);
    expect(replay.service.status).not.toHaveBeenCalled();
    expect(replay.service.resume).not.toHaveBeenCalled();
  });

  it("keeps the reservation of a paused run open", async () => {
    await reserve("run-paused");
    closed.length = 0;
    const { run, outcomes } = handlerFor(snapshot("run-paused", "paused", { draft: true }));

    await run(organisation, "run-paused");

    expect(outcomes).toEqual(["held"]);
    expect(await stateOf("run-paused")).toBe("open");
    expect(closed).toEqual([]);
  });

  it("refunds a run whose record was erased before the job ran", async () => {
    await reserve("run-erased");
    closed.length = 0;
    const { run, service } = handlerFor(undefined, undefined, { recordErased: true });

    await run(organisation, "run-erased");

    expect(service.status).not.toHaveBeenCalled();
    expect(await stateOf("run-erased")).toBe("refunded");
    expect(closed).toMatchObject([
      { runId: "run-erased", outcome: "refunded", estimatedUsd: null },
    ]);
  });

  it("does nothing for a tenant without an organisation, as in owner-token mode", async () => {
    closed.length = 0;
    const { run, outcomes } = handlerFor(
      snapshot("run-owner", "drafting"),
      snapshot("run-owner", "awaiting-approval", { draft: true }),
    );

    await run(ownerTenant, "run-owner");

    expect(outcomes).toEqual(["advanced"]);
    expect(closed).toEqual([]);
    expect(await ledger(ownerTenant).reservationFor("run-owner")).toBeUndefined();
  });

  it("reconciles stale reservations whose run was never saved or finished without a job", async () => {
    const stale = new Date(Date.now() - 3 * hour);
    await reserve("run-lost", stale);
    await reserve("run-stopped", stale);
    await reserve("run-working", stale);
    await reserve("run-fresh", new Date(Date.now() - 5 * 60 * 1000));
    const storage = tenancy.forTenant(organisation);
    const save = (run: RunSnapshot) =>
      storage.set(`draft-loop:orchestration:run:${run.runId}`, JSON.stringify(run));
    await save(snapshot("run-stopped", "stopped", { draft: true }));
    await save(snapshot("run-working", "drafting"));
    closed.length = 0;
    const { run } = handlerFor(snapshot("run-other", "paused"));

    await run(organisation, "run-other");

    expect(await stateOf("run-lost")).toBe("refunded");
    expect(await stateOf("run-stopped")).toBe("settled");
    expect(await stateOf("run-working")).toBe("open");
    expect(await stateOf("run-fresh")).toBe("open");
    expect(closed.map(({ runId, outcome }) => [runId, outcome]).sort()).toEqual([
      ["run-lost", "refunded"],
      ["run-stopped", "settled"],
    ]);
  });
});
