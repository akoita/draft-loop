import { describe, expect, it } from "vitest";
import { readMigrationConfig, readWorkerConfig, WorkerConfigError } from "./config.js";

const env = {
  DRAFT_LOOP_DATABASE_URL: "postgres://runtime@db.example.test/draft_loop",
  DRAFT_LOOP_TENANT_ID: "owner",
  DRAFT_LOOP_BLOB_BUCKET: "draft-loop-local",
};

describe("readWorkerConfig", () => {
  it("reads the database, tenant and bucket, with provider data off by default", () => {
    expect(readWorkerConfig(env)).toEqual({
      databaseUrl: env.DRAFT_LOOP_DATABASE_URL,
      databaseSchema: "draft_loop",
      queueSchema: "draft_loop_queue",
      tenantId: "owner",
      blobBucket: "draft-loop-local",
      allowProviderData: false,
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
    });
    expect(() =>
      readMigrationConfig({
        DRAFT_LOOP_MIGRATION_DATABASE_URL: "postgres://owner@db.example.test/draft_loop",
        DRAFT_LOOP_RUNTIME_ROLE: "app; drop",
      }),
    ).toThrow(WorkerConfigError);
  });
});
