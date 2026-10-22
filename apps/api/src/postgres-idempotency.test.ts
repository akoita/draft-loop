import { randomUUID } from "node:crypto";
import {
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { IdempotencyInProgressError } from "./idempotency.js";
import { describeIdempotencyStoreContract } from "./idempotency-contract.js";
import { createPostgresIdempotencyStore } from "./postgres-idempotency.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("Postgres idempotency store", () => {
  const url = connectionString ?? "";
  const schema = `idempotency_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const opened: PostgresStorage[] = [];
  let tenantSuffix = 0;

  /** One API instance's storage; `tenantId` defaults to a fresh tenant, so tests stay apart. */
  const openStorage = async (tenantId = `tenant-${++tenantSuffix}`) => {
    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    opened.push(storage);
    return storage;
  };

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
  });

  afterAll(async () => {
    await Promise.all(opened.map((storage) => storage.close()));
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
  });

  describeIdempotencyStoreContract("Postgres", async (options) => {
    const storage = await openStorage();
    return {
      store: createPostgresIdempotencyStore({ keys: storage.idempotencyKeys, ...options }),
      close: async () => undefined,
    };
  });

  it("runs a command once when two instances answer the same key at once", async () => {
    const tenantId = `tenant-${++tenantSuffix}`;
    const first = await openStorage(tenantId);
    const second = await openStorage(tenantId);
    let finish: () => void = () => undefined;
    const produce = vi.fn(
      () =>
        new Promise<{ runId: string }>((resolve) => {
          finish = () => resolve({ runId: "run-1" });
        }),
    );
    const store = (storage: PostgresStorage) =>
      createPostgresIdempotencyStore({ keys: storage.idempotencyKeys, pollMs: 10 });

    const running = store(first).once("runs:w", "key-1", { a: 1 }, produce);
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(1));
    const retry = store(second).once("runs:w", "key-1", { a: 1 }, produce);
    finish();

    expect(await running).toEqual({ runId: "run-1" });
    expect(await retry).toEqual({ runId: "run-1" });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("answers a retry that outwaits a running command with a retryable error", async () => {
    const keys = (await openStorage()).idempotencyKeys;
    const store = createPostgresIdempotencyStore({ keys, waitMs: 50, pollMs: 10 });
    const stuck = vi.fn(() => new Promise<never>(() => undefined));
    const retry = vi.fn(async () => "second");

    void store.once("runs:w", "key-1", { a: 1 }, stuck);
    await vi.waitFor(() => expect(stuck).toHaveBeenCalledTimes(1));

    await expect(store.once("runs:w", "key-1", { a: 1 }, retry)).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it("takes over a key whose command stopped without a result once its lease ends", async () => {
    let now = Date.parse("2026-10-22T10:00:00.000Z");
    const keys = (await openStorage()).idempotencyKeys;
    const store = createPostgresIdempotencyStore({ keys, leaseMs: 1_000, now: () => now });
    // A crashed instance: its command never settles, so the key stays without a result.
    const stuck = vi.fn(() => new Promise<never>(() => undefined));
    void store.once("runs:w", "key-1", { a: 1 }, stuck);
    await vi.waitFor(() => expect(stuck).toHaveBeenCalledTimes(1));

    now += 1_000;

    await expect(store.once("runs:w", "key-1", { a: 1 }, async () => "retried")).resolves.toBe(
      "retried",
    );
  });

  it("sweeps expired keys a bounded number at a time", async () => {
    const at = new Date("2026-10-22T10:00:00.000Z");
    const keys = (await openStorage()).idempotencyKeys;
    for (const key of ["a", "b", "c"]) {
      await keys.claim({ scope: "s", key, fingerprint: "0".repeat(64), at, leaseMs: 1, ttlMs: 1 });
    }
    const later = new Date(at.getTime() + 1_000);

    expect(await keys.sweep(later, 2)).toBe(2);
    expect(await keys.sweep(later, 2)).toBe(1);
    expect(await keys.sweep(later, 2)).toBe(0);
  });
});
