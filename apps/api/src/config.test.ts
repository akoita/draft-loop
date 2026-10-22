import { describe, expect, it } from "vitest";
import { ApiConfigError, readApiConfig, readHostedStorageConfig } from "./config.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

describe("readApiConfig", () => {
  it("reads Cloud Run's port and the owner token", () => {
    expect(readApiConfig({ PORT: "9000", DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toEqual({
      host: "0.0.0.0",
      port: 9000,
      ownerToken,
    });
  });

  it("defaults to port 8080", () => {
    expect(readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken }).port).toBe(8080);
  });

  it.each([
    ["missing", undefined],
    ["too short", "short-token"],
    ["with whitespace", `${ownerToken} ${ownerToken}`],
  ])("refuses an owner token that is %s", (_label, token) => {
    expect(() =>
      readApiConfig(token === undefined ? {} : { DRAFT_LOOP_API_OWNER_TOKEN: token }),
    ).toThrow(ApiConfigError);
  });

  it("reads the worker's Cloud Run job, and refuses anything but a full job name", () => {
    const workerJob = "projects/example-proj/locations/europe-west1/jobs/draft-loop-worker";
    expect(
      readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken, DRAFT_LOOP_WORKER_JOB: workerJob })
        .workerJob,
    ).toBe(workerJob);
    expect(readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken }).workerJob).toBeUndefined();
    expect(() =>
      readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken, DRAFT_LOOP_WORKER_JOB: "worker" }),
    ).toThrow(ApiConfigError);
  });

  it.each(["0", "65536", "80a", ""])("refuses port %j", (port) => {
    expect(() => readApiConfig({ PORT: port, DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toThrow(
      ApiConfigError,
    );
  });
});

describe("readHostedStorageConfig", () => {
  const env = {
    DRAFT_LOOP_DATABASE_URL: "postgres://runtime@db.example.test/draft_loop",
    DRAFT_LOOP_TENANT_ID: "owner",
    DRAFT_LOOP_BLOB_BUCKET: "draft-loop-local",
  };

  it("reads the database, tenant and bucket, with default schemas", () => {
    expect(readHostedStorageConfig(env)).toEqual({
      databaseUrl: env.DRAFT_LOOP_DATABASE_URL,
      databaseSchema: "draft_loop",
      queueSchema: "draft_loop_queue",
      tenantId: "owner",
      blobBucket: "draft-loop-local",
    });
    expect(
      readHostedStorageConfig({ ...env, DRAFT_LOOP_GCS_ENDPOINT: "http://gcs:4443" }).gcsEndpoint,
    ).toBe("http://gcs:4443");
    expect(
      readHostedStorageConfig({ ...env, DRAFT_LOOP_MAX_SOURCE_BYTES: "5242880" }).maxSourceBytes,
    ).toBe(5_242_880);
  });

  it.each([
    ["without a database", { DRAFT_LOOP_DATABASE_URL: "" }],
    ["without a bucket", { DRAFT_LOOP_BLOB_BUCKET: "" }],
    ["with an unsafe tenant", { DRAFT_LOOP_TENANT_ID: "../other" }],
    ["with an unsafe schema", { DRAFT_LOOP_DATABASE_SCHEMA: "draft-loop; drop" }],
    ["with a source limit of no bytes", { DRAFT_LOOP_MAX_SOURCE_BYTES: "0" }],
    ["with a source limit Cloud Run refuses", { DRAFT_LOOP_MAX_SOURCE_BYTES: "40000000" }],
    ["with a source limit that is not a number", { DRAFT_LOOP_MAX_SOURCE_BYTES: "10MB" }],
  ])("refuses settings %s", (_label, override) => {
    expect(() => readHostedStorageConfig({ ...env, ...override })).toThrow(ApiConfigError);
  });
});
