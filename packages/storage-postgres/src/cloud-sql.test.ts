import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CloudSqlConfigError,
  type CloudSqlConnector,
  readCloudSqlProxyConfig,
  startCloudSqlProxy,
  startConfiguredCloudSqlProxy,
} from "./cloud-sql.js";

function recordingConnector(failure?: Error) {
  const calls: Parameters<CloudSqlConnector["startLocalProxy"]>[0][] = [];
  let closed = 0;
  const connector: CloudSqlConnector = {
    startLocalProxy: async (options) => {
      calls.push(options);
      if (failure !== undefined) throw failure;
    },
    close: () => {
      closed += 1;
    },
  };
  return { connector, calls, closed: () => closed };
}

describe("readCloudSqlProxyConfig", () => {
  it("stays off without an instance, and defaults the socket directory", () => {
    expect(readCloudSqlProxyConfig({})).toBeUndefined();
    expect(readCloudSqlProxyConfig({ DRAFT_LOOP_CLOUD_SQL_INSTANCE: " " })).toBeUndefined();
    expect(
      readCloudSqlProxyConfig({ DRAFT_LOOP_CLOUD_SQL_INSTANCE: "example-proj:europe-west1:db" }),
    ).toEqual({
      instanceConnectionName: "example-proj:europe-west1:db",
      socketDirectory: "/tmp/cloudsql",
    });
  });

  it("refuses a malformed instance or a relative socket directory", () => {
    expect(() => readCloudSqlProxyConfig({ DRAFT_LOOP_CLOUD_SQL_INSTANCE: "db" })).toThrow(
      CloudSqlConfigError,
    );
    expect(() =>
      readCloudSqlProxyConfig({
        DRAFT_LOOP_CLOUD_SQL_INSTANCE: "example-proj:europe-west1:db",
        DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR: "cloudsql",
      }),
    ).toThrow(CloudSqlConfigError);
  });
});

describe("startCloudSqlProxy", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "cloud-sql-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("listens on the Postgres socket name over the private IP, signing in as the identity", async () => {
    const recorded = recordingConnector();
    const socketDirectory = path.join(directory, "sockets");
    const proxy = await startCloudSqlProxy({
      instanceConnectionName: "example-proj:europe-west1:db",
      socketDirectory,
      login: "iam",
      connector: recorded.connector,
    });
    expect(recorded.calls).toEqual([
      {
        instanceConnectionName: "example-proj:europe-west1:db",
        ipType: "PRIVATE",
        authType: "IAM",
        listenOptions: { path: path.join(socketDirectory, ".s.PGSQL.5432") },
      },
    ]);
    expect((await stat(socketDirectory)).mode & 0o777).toBe(0o700);
    proxy.close();
    expect(recorded.closed()).toBe(1);
  });

  it("passes a built-in user's password through for the migration job", async () => {
    const recorded = recordingConnector();
    await startCloudSqlProxy({
      instanceConnectionName: "example-proj:europe-west1:db",
      socketDirectory: directory,
      login: "password",
      connector: recorded.connector,
    });
    expect(recorded.calls[0]?.authType).toBe("PASSWORD");
  });

  it("closes the connector when the socket cannot start", async () => {
    const recorded = recordingConnector(new Error("instance unreachable"));
    await expect(
      startCloudSqlProxy({
        instanceConnectionName: "example-proj:europe-west1:db",
        socketDirectory: directory,
        login: "iam",
        connector: recorded.connector,
      }),
    ).rejects.toThrow("instance unreachable");
    expect(recorded.closed()).toBe(1);
  });

  it("does nothing when the environment leaves it off", async () => {
    const proxy = await startConfiguredCloudSqlProxy({}, "iam");
    expect(() => proxy.close()).not.toThrow();
  });
});
