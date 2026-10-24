import { randomUUID } from "node:crypto";
import {
  createPostgresTenantDirectory,
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { hostedOperatorFor } from "./hosted-application.js";
import { cloudLoggingOptions } from "./logging.js";
import type { TenantApplication } from "./tenant-context.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const north = "org-plans-north";
const south = "org-plans-south";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)(
  "the operator's plans and credits on Postgres",
  () => {
    const url = connectionString ?? "";
    const schema = `operator_plans_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: url, schema, maxConnections: 1 });
    const logLines: string[] = [];
    let tenancy: PostgresTenancy;
    let directory: PostgresTenantDirectory;
    let app: FastifyInstance;

    const operator = async (request: InjectOptions) => {
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${ownerToken}`, ...request.headers },
      });
      return {
        status: response.statusCode,
        body: response.json(),
        code: response.json()?.error?.code,
      };
    };
    const base = (organisationId: string) => `/v1/operator/organisations/${organisationId}`;
    const assign = (organisationId: string, payload: Record<string, unknown>) =>
      operator({ method: "PUT", url: `${base(organisationId)}/plan`, payload });
    const grant = (
      organisationId: string,
      payload: Record<string, unknown>,
      idempotencyKey: string = randomUUID(),
    ) =>
      operator({
        method: "POST",
        url: `${base(organisationId)}/credit-grants`,
        payload,
        headers: { "idempotency-key": idempotencyKey },
      });
    const read = (organisationId: string) =>
      operator({ method: "GET", url: `${base(organisationId)}/credits` });
    const audits = () =>
      logLines
        .map((line) => JSON.parse(line) as { audit?: Record<string, unknown> })
        .flatMap((line) => (line.audit === undefined ? [] : [line.audit]));

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
      await migratePostgresStorage({ connectionString: url, schema });
      await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
      tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
      directory = await createPostgresTenantDirectory({
        connectionString: runtimeUrl(url),
        schema,
      });
      for (const organisationId of [north, south]) {
        await directory.createOrganisation({
          organisationId,
          name: `Example ${organisationId}`,
          firstOwnerEmail: `owner@${organisationId}.example.test`,
        });
      }
      app = await buildApi({
        ownerToken,
        logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
        tenants: {
          budgetCeiling: { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 },
          // Never composed: the operator's routes read no tenant application.
          applicationFor: () => ({}) as TenantApplication,
          operatorFor: hostedOperatorFor(tenancy),
        },
      });
    });

    afterAll(async () => {
      await app?.close();
      await directory?.close();
      await tenancy?.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.close();
    });

    it("answers an organisation with no plan and refuses an unknown one", async () => {
      const empty = await read(north);
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({
        organisationId: north,
        assignment: null,
        entitlements: null,
        balance: { allowance: 0, grantsRemaining: 0, remaining: 0 },
      });
      for (const response of [
        await read("org-plans-missing"),
        await assign("org-plans-missing", { planId: "pro" }),
        await grant("org-plans-missing", { credits: 5, reason: "goodwill" }),
      ]) {
        expect(response.status).toBe(404);
        expect(response.code).toBe("organisation_not_found");
      }
    });

    it("refuses an unknown plan and a Team without seats, and stores nothing", async () => {
      for (const payload of [
        { planId: "platinum" },
        { planId: "team" },
        { planId: "pro", periodStart: "2026-02-30" },
      ]) {
        const response = await assign(north, payload);
        expect(response.status).toBe(422);
        expect(response.code).toBe("invalid_plan_assignment");
      }
      expect(await tenancy.forTenant(north).organisationPlans.planAssignmentHistory()).toEqual([]);
    });

    it("assigns a plan, replaces it and keeps the history", async () => {
      const first = await assign(north, { planId: "pro", periodStart: "2026-10-01" });
      expect(first.status).toBe(200);
      expect(first.body.assignment).toMatchObject({ planId: "pro", seats: null });
      const proCredits = first.body.entitlements.creditsPerPeriod as number;
      expect(proCredits).toBeGreaterThan(0);

      const second = await assign(north, {
        planId: "team",
        seats: 3,
        overrides: { runsPerDay: 7 },
        periodStart: "2026-10-01",
      });
      expect(second.status).toBe(200);
      expect(second.body.entitlements).toMatchObject({ seats: 3, runsPerDay: 7 });

      const current = await read(north);
      expect(current.body.assignment).toMatchObject({ planId: "team", seats: 3 });
      expect(current.body.balance.allowance).toBe(second.body.entitlements.creditsPerPeriod);
      const history = await tenancy.forTenant(north).organisationPlans.planAssignmentHistory();
      expect(history.map((item) => item.planId)).toEqual(["pro", "team"]);
      expect((await read(south)).body.assignment).toBeNull();
    });

    it("shows a grant in the balance, and a retried grant is not doubled", async () => {
      const before = (await read(north)).body.balance;
      const key = "operator-grant-retry-0001";

      const first = await grant(north, { credits: 25, reason: "goodwill" }, key);
      const retry = await grant(north, { credits: 25, reason: "goodwill" }, key);
      const conflicting = await grant(north, { credits: 26, reason: "goodwill" }, key);
      const after = (await read(north)).body.balance;

      expect(first.status).toBe(201);
      expect(first.body.grant).toMatchObject({ credits: 25, reason: "goodwill" });
      expect(first.body.balance.grantsRemaining).toBe(before.grantsRemaining + 25);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(conflicting).toMatchObject({ status: 409, code: "idempotency_conflict" });
      expect(after.grantsRemaining).toBe(before.grantsRemaining + 25);
      expect(after.remaining).toBe(before.remaining + 25);
      // Another organisation's balance and keys are untouched.
      expect((await read(south)).body.balance.grantsRemaining).toBe(0);
      const other = await grant(south, { credits: 5, reason: "goodwill" }, key);
      expect(other.status).toBe(201);
      expect((await read(south)).body.balance.grantsRemaining).toBe(5);
    });

    it("refuses a bad reason or amount before writing", async () => {
      const before = (await read(north)).body.balance;
      for (const payload of [
        { credits: 0, reason: "goodwill" },
        { credits: 5, reason: "Free text" },
      ]) {
        expect((await grant(north, payload)).status).toBe(400);
      }
      expect((await read(north)).body.balance).toEqual(before);
    });

    it("records one content-free audit line per write", async () => {
      const actions = audits().map((audit) => audit.action);
      expect(actions.filter((action) => action === "organisation_plan_assigned")).toHaveLength(2);
      // The retried grant logged once; south's grant once more.
      expect(actions.filter((action) => action === "credits_granted")).toHaveLength(2);
      expect(audits()).toContainEqual({
        action: "organisation_plan_assigned",
        organisationId: north,
        planId: "team",
        seats: 3,
        periodStart: "2026-10-01",
      });
      expect(audits()).toContainEqual(
        expect.objectContaining({
          action: "credits_granted",
          organisationId: north,
          credits: 25,
          reason: "goodwill",
        }),
      );
      expect(logLines.join("\n")).not.toContain(ownerToken);
    });
  },
);
