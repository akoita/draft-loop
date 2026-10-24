import { describe, expect, it } from "vitest";
import { ApiConfigError, readApiConfig, readHostedStorageConfig } from "./config.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

describe("readApiConfig", () => {
  it("reads Cloud Run's port and the owner token", () => {
    expect(readApiConfig({ PORT: "9000", DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toEqual({
      host: "0.0.0.0",
      port: 9000,
      ownerToken,
      auth: { mode: "owner" },
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

  it("reads the web screen's directory, and refuses a relative path", () => {
    expect(
      readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken, DRAFT_LOOP_WEB_ROOT: "/app/web" })
        .webRoot,
    ).toBe("/app/web");
    expect(readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken }).webRoot).toBeUndefined();
    expect(() =>
      readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken, DRAFT_LOOP_WEB_ROOT: "web/dist" }),
    ).toThrow(ApiConfigError);
  });

  it.each(["0", "65536", "80a", ""])("refuses port %j", (port) => {
    expect(() => readApiConfig({ PORT: port, DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toThrow(
      ApiConfigError,
    );
  });
});

describe("readApiConfig's sign-in settings", () => {
  const oidc = {
    DRAFT_LOOP_API_OWNER_TOKEN: ownerToken,
    DRAFT_LOOP_AUTH_MODE: "oidc",
    DRAFT_LOOP_OIDC_ISSUER: "https://id.example.test/realms/draft-loop",
    DRAFT_LOOP_OIDC_AUDIENCE: "draft-loop-api",
    DRAFT_LOOP_OIDC_WEB_CLIENT_ID: "draft-loop-web",
  };

  it("defaults to owner mode, ignoring sign-in settings", () => {
    expect(readApiConfig({ ...oidc, DRAFT_LOOP_AUTH_MODE: "owner" }).auth).toEqual({
      mode: "owner",
    });
    expect(readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken }).auth).toEqual({
      mode: "owner",
    });
  });

  it("reads the identity provider, discovering its keys unless named", () => {
    expect(readApiConfig(oidc).auth).toEqual({
      mode: "oidc",
      issuer: "https://id.example.test/realms/draft-loop",
      audience: "draft-loop-api",
      webClientId: "draft-loop-web",
      allowHttp: false,
    });
    const jwksUrl = "https://id.example.test/realms/draft-loop/protocol/openid-connect/certs";
    expect(readApiConfig({ ...oidc, DRAFT_LOOP_OIDC_JWKS_URL: jwksUrl }).auth).toMatchObject({
      jwksUrl,
    });
  });

  it("still requires the owner token, the operator's credential", () => {
    expect(() => readApiConfig({ ...oidc, DRAFT_LOOP_API_OWNER_TOKEN: "" })).toThrow(
      ApiConfigError,
    );
  });

  it("accepts a plain-http provider only when the local stack allows it", () => {
    const local = { ...oidc, DRAFT_LOOP_OIDC_ISSUER: "http://keycloak:8080/realms/draft-loop" };
    expect(() => readApiConfig(local)).toThrow(ApiConfigError);
    expect(readApiConfig({ ...local, DRAFT_LOOP_OIDC_ALLOW_HTTP: "1" }).auth).toMatchObject({
      issuer: "http://keycloak:8080/realms/draft-loop",
      allowHttp: true,
    });
  });

  it.each([
    ["an unknown mode", { DRAFT_LOOP_AUTH_MODE: "password" }],
    ["no issuer", { DRAFT_LOOP_OIDC_ISSUER: "" }],
    ["an issuer that is not a URL", { DRAFT_LOOP_OIDC_ISSUER: "keycloak" }],
    ["an issuer with a query", { DRAFT_LOOP_OIDC_ISSUER: "https://id.example.test/?realm=a" }],
    ["no audience", { DRAFT_LOOP_OIDC_AUDIENCE: "" }],
    ["an audience with whitespace", { DRAFT_LOOP_OIDC_AUDIENCE: "draft loop" }],
    ["no web client id", { DRAFT_LOOP_OIDC_WEB_CLIENT_ID: "" }],
    ["a plain-http key address", { DRAFT_LOOP_OIDC_JWKS_URL: "http://id.example.test/certs" }],
    ["an unclear http switch", { DRAFT_LOOP_OIDC_ALLOW_HTTP: "yes" }],
  ])("refuses %s", (_label, override) => {
    expect(() => readApiConfig({ ...oidc, ...override })).toThrow(ApiConfigError);
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

  it("requires the owner's tenant in owner mode only", () => {
    const withoutTenant = { ...env, DRAFT_LOOP_TENANT_ID: "" };
    expect(() => readHostedStorageConfig(withoutTenant)).toThrow(ApiConfigError);
    expect(() => readHostedStorageConfig(withoutTenant, "owner")).toThrow(ApiConfigError);
    expect(readHostedStorageConfig(withoutTenant, "oidc")).not.toHaveProperty("tenantId");
    expect(readHostedStorageConfig(env, "oidc").tenantId).toBe("owner");
    expect(() =>
      readHostedStorageConfig({ ...env, DRAFT_LOOP_TENANT_ID: "../other" }, "oidc"),
    ).toThrow(ApiConfigError);
  });
});
