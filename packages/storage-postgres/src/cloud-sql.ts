import { mkdir } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";

import { AuthTypes, Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector";

/**
 * On Cloud Run the services reach Cloud SQL on its private IP through Google's connector, which
 * opens a TLS tunnel with the service identity and, for IAM logins, signs the user in with that
 * identity, so no database password exists (ADR 0011, D14). The connector listens on a local Unix
 * socket, and the database URL names its directory as `host`, so storage and the run queue keep
 * opening plain `pg` connections. Compose and CI leave it off and connect with their URLs.
 */
export interface CloudSqlProxyConfig {
  /** The instance's connection name, `project:region:instance`. */
  readonly instanceConnectionName: string;
  /** The directory the socket `.s.PGSQL.5432` is created in. */
  readonly socketDirectory: string;
}

/** The part of the connector this module uses, so tests can stand in for it. */
export interface CloudSqlConnector {
  /** Resolves a function that opens one TLS tunnel to the instance, signed in as configured. */
  readonly getOptions: (options: {
    readonly instanceConnectionName: string;
    readonly ipType: IpAddressTypes;
    readonly authType: AuthTypes;
  }) => Promise<{ readonly stream: () => Duplex }>;
  readonly close: () => void;
}

export interface CloudSqlProxyOptions extends CloudSqlProxyConfig {
  /**
   * `iam` signs in as the service identity's IAM database user (the API and the worker);
   * `password` passes the URL's built-in user and password through (the migration job).
   */
  readonly login: "iam" | "password";
  readonly connector?: CloudSqlConnector;
}

export interface CloudSqlProxy {
  /** Closes the socket and the tunnels; call it after the pools that use them have ended. */
  readonly close: () => void;
}

export class CloudSqlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSqlConfigError";
  }
}

const instancePattern = /^[a-z0-9.:-]+:[a-z0-9-]+:[a-z0-9-]+$/u;

/** Reads the connector's settings; without `DRAFT_LOOP_CLOUD_SQL_INSTANCE` it stays off. */
export function readCloudSqlProxyConfig(env: NodeJS.ProcessEnv): CloudSqlProxyConfig | undefined {
  const instanceConnectionName = env.DRAFT_LOOP_CLOUD_SQL_INSTANCE?.trim() ?? "";
  if (instanceConnectionName === "") return undefined;
  if (!instancePattern.test(instanceConnectionName)) {
    throw new CloudSqlConfigError(
      "DRAFT_LOOP_CLOUD_SQL_INSTANCE must be a connection name, project:region:instance.",
    );
  }
  const socketDirectory = env.DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR?.trim() || "/tmp/cloudsql";
  if (!path.isAbsolute(socketDirectory)) {
    throw new CloudSqlConfigError("DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR must be an absolute path.");
  }
  return { instanceConnectionName, socketDirectory };
}

/**
 * Joins one local connection to one tunnel. The connector's own `startLocalProxy` pipes the two
 * sockets with no error listener, so a write to a side the other end has closed (EPIPE) was an
 * unhandled error that stopped the whole process, failing every request in flight. Here an error
 * on either side ends both, and only that one database connection fails.
 */
export function joinTunnel(local: Socket, tunnel: Duplex): void {
  const end = () => {
    local.destroy();
    tunnel.destroy();
  };
  local.on("error", end);
  tunnel.on("error", end);
  local.on("close", end);
  tunnel.on("close", end);
  local.pipe(tunnel);
  tunnel.pipe(local);
}

/** Starts the local socket on the instance's private IP. */
export async function startCloudSqlProxy(options: CloudSqlProxyOptions): Promise<CloudSqlProxy> {
  const connector = options.connector ?? new Connector();
  let server: Server | undefined;
  try {
    await mkdir(options.socketDirectory, { recursive: true, mode: 0o700 });
    const { stream } = await connector.getOptions({
      instanceConnectionName: options.instanceConnectionName,
      ipType: IpAddressTypes.PRIVATE,
      authType: options.login === "iam" ? AuthTypes.IAM : AuthTypes.PASSWORD,
    });
    const listening = createServer((local) => {
      let tunnel: Duplex;
      try {
        tunnel = stream();
      } catch {
        local.destroy();
        return;
      }
      joinTunnel(local, tunnel);
    });
    server = listening;
    // A failure after the socket listens must not stop the process either.
    listening.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      listening.once("error", reject);
      listening.listen({ path: path.join(options.socketDirectory, ".s.PGSQL.5432") }, () => {
        listening.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server?.close();
    connector.close();
    throw error;
  }
  const listening = server;
  return {
    close: () => {
      listening.close();
      connector.close();
    },
  };
}

/** Starts the connector when the environment configures it; otherwise does nothing. */
export async function startConfiguredCloudSqlProxy(
  env: NodeJS.ProcessEnv,
  login: CloudSqlProxyOptions["login"],
): Promise<CloudSqlProxy> {
  const config = readCloudSqlProxyConfig(env);
  if (config === undefined) return { close: () => undefined };
  return startCloudSqlProxy({ ...config, login });
}
