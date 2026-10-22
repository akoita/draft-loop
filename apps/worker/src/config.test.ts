import { RunBudgetCeilingConfigError } from "@draft-loop/application";
import { describe, expect, it } from "vitest";
import { readMigrationConfig, readWorkerConfig, WorkerConfigError } from "./config.js";

const env = {
  DRAFT_LOOP_DATABASE_URL: "postgres://runtime@db.example.test/draft_loop",
  DRAFT_LOOP_TENANT_ID: "owner",
  DRAFT_LOOP_BLOB_BUCKET: "draft-loop-local",
  DRAFT_LOOP_RUN_MAX_ROUNDS: "5",
  DRAFT_LOOP_RUN_MAX_COST_USD: "3",
  DRAFT_LOOP_RUN_MAX_DURATION_MS: "1800000",
};

describe("readWorkerConfig", () => {
  it("reads the database, tenant, bucket and run ceiling, with provider data off by default", () => {
    expect(readWorkerConfig(env)).toEqual({
      databaseUrl: env.DRAFT_LOOP_DATABASE_URL,
      databaseSchema: "draft_loop",
      queueSchema: "draft_loop_queue",
      tenantId: "owner",
      blobBucket: "draft-loop-local",
      allowProviderData: false,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
    });
    expect(
      readWorkerConfig({ ...env, DRAFT_LOOP_ALLOW_PROVIDER_DATA: "true" }).allowProviderData,
    ).toBe(true);
  });

  it.each([
    ["without a database", { DRAFT_LOOP_DATABASE_URL: "" }],
    ["with an unsafe tenant", { DRAFT_LOOP_TENANT_ID: "a/b" }],
    ["with an unclear provider-data setting", { DRAFT_LOOP_ALLOW_PROVIDER_DATA: "yes" }],
  ])("refuses settings %s", (_label, override) => {
    expect(() => readWorkerConfig({ ...env, ...override })).toThrow(WorkerConfigError);
  });

  it("reads the model gateway when a Vertex project is set", () => {
    const gateway = readWorkerConfig({
      ...env,
      DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
      DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
      DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/latest",
    }).modelGateway;

    expect(readWorkerConfig(env).modelGateway).toBeUndefined();
    expect(gateway).toMatchObject({ vertexProjectId: "synthetic-project", vertexLocation: "eu" });
  });

  it("refuses to start without a run ceiling", () => {
    expect(() => readWorkerConfig({ ...env, DRAFT_LOOP_RUN_MAX_COST_USD: "" })).toThrow(
      RunBudgetCeilingConfigError,
    );
  });
});

describe("readMigrationConfig", () => {
  it("reads the owner's connection and the runtime role", () => {
    expect(
      readMigrationConfig({
        DRAFT_LOOP_MIGRATION_DATABASE_URL: "postgres://owner@db.example.test/draft_loop",
        DRAFT_LOOP_RUNTIME_ROLE: "draft_loop_app",
      }),
    ).toEqual({
      databaseUrl: "postgres://owner@db.example.test/draft_loop",
      databaseSchema: "draft_loop",
      queueSchema: "draft_loop_queue",
      runtimeRole: "draft_loop_app",
      runtimeMembers: [],
    });
    expect(() =>
      readMigrationConfig({
        DRAFT_LOOP_MIGRATION_DATABASE_URL: "postgres://owner@db.example.test/draft_loop",
        DRAFT_LOOP_RUNTIME_ROLE: "app; drop",
      }),
    ).toThrow(WorkerConfigError);
  });

  it("reads the IAM database users that join the runtime role, and refuses anything else", () => {
    const base = {
      DRAFT_LOOP_MIGRATION_DATABASE_URL: "postgres://owner@db.example.test/draft_loop",
      DRAFT_LOOP_RUNTIME_ROLE: "draft_loop_app",
    };
    expect(
      readMigrationConfig({
        ...base,
        DRAFT_LOOP_RUNTIME_MEMBERS:
          " api-runtime@example-proj.iam, worker-runtime@example-proj.iam ",
      }).runtimeMembers,
    ).toEqual(["api-runtime@example-proj.iam", "worker-runtime@example-proj.iam"]);
    for (const members of ['api"; drop role x; --@example-proj.iam', "postgres", "a@b.iam"]) {
      expect(() => readMigrationConfig({ ...base, DRAFT_LOOP_RUNTIME_MEMBERS: members })).toThrow(
        WorkerConfigError,
      );
    }
  });
});
