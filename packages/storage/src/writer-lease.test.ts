import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type StorageWriterLease,
  StorageWriterLeaseConflictError,
  StorageWriterLeaseLostError,
  StorageWriterLeaseValidationError,
  withStorageWriterLease,
} from "./writer-lease.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("durable storage writer leases", () => {
  let tempDir: string;
  let coordinatorPath: string;
  let now: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "draft-loop-writer-lease-test-"));
    coordinatorPath = join(tempDir, "coordinator.sqlite");
    now = 1_000;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function options(
    ownerId: string,
    overrides: Partial<Parameters<typeof withStorageWriterLease>[0]> = {},
  ): Parameters<typeof withStorageWriterLease>[0] {
    return {
      coordinatorPath,
      scope: "workspace",
      operation: "workspace-write",
      ownerId,
      leaseDurationMs: 100,
      waitTimeoutMs: 0,
      now: () => now,
      ...overrides,
    };
  }

  it("rejects an active conflict with a frozen, path-free diagnostic", async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const firstRun = withStorageWriterLease(options("owner-one"), async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;

    let conflictError: unknown;
    try {
      await withStorageWriterLease(
        options("owner-two", { operation: "workspace-rebuild" }),
        async () => undefined,
      );
    } catch (error) {
      conflictError = error;
    }

    expect(conflictError).toBeInstanceOf(StorageWriterLeaseConflictError);
    const error = conflictError as StorageWriterLeaseConflictError;
    expect(error.diagnostic).toEqual({
      scope: "workspace",
      activeOperation: "workspace-write",
      retryable: true,
      status: "active",
    });
    expect(Object.isFrozen(error.diagnostic)).toBe(true);
    expect(error.message).not.toContain(tempDir);
    expect(error.message).not.toContain("owner-one");
    expect(error.message).not.toContain("owner-two");

    finish.resolve();
    await firstRun;
  });

  it("takes over an expired row with an increasing generation", async () => {
    const firstStarted = deferred<void>();
    const firstFinish = deferred<void>();
    let firstLease: StorageWriterLease | undefined;
    const firstRun = withStorageWriterLease(options("owner-one"), async (lease) => {
      firstLease = lease;
      firstStarted.resolve();
      await firstFinish.promise;
    });
    await firstStarted.promise;
    expect(firstLease?.generation).toBe(1);

    now += 101;
    let successorLease: StorageWriterLease | undefined;
    const successorStarted = deferred<void>();
    const successorFinish = deferred<void>();
    const successorRun = withStorageWriterLease(
      options("owner-two", { operation: "workspace-rebuild" }),
      async (lease) => {
        successorLease = lease;
        successorStarted.resolve();
        await successorFinish.promise;
      },
    );
    await successorStarted.promise;
    expect(successorLease?.generation).toBe(2);

    let staleRenewError: unknown;
    try {
      firstLease?.renew();
    } catch (error) {
      staleRenewError = error;
    }
    expect(staleRenewError).toBeInstanceOf(StorageWriterLeaseLostError);
    expect((staleRenewError as StorageWriterLeaseLostError).activeOperation).toBe(
      "workspace-rebuild",
    );
    firstFinish.resolve();
    await expect(firstRun).rejects.toBeInstanceOf(StorageWriterLeaseLostError);
    await expect(
      withStorageWriterLease(
        options("owner-three", { operation: "workspace-delete" }),
        async () => undefined,
      ),
    ).rejects.toMatchObject({
      activeOperation: "workspace-rebuild",
      status: "active",
    });
    successorFinish.resolve();
    await successorRun;
  });

  it("releases ownership after callback failure and after pre-abort", async () => {
    const callbackError = new Error("callback failed");
    await expect(
      withStorageWriterLease(options("owner-one"), async () => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);

    const generationAfterFailure = await withStorageWriterLease(
      options("owner-two"),
      async (lease) => lease.generation,
    );
    expect(generationAfterFailure).toBe(2);

    const controller = new AbortController();
    controller.abort();
    await expect(
      withStorageWriterLease(options("owner-three", { signal: controller.signal }), async () => 1),
    ).rejects.toMatchObject({ name: "AbortError" });

    const generationAfterAbort = await withStorageWriterLease(
      options("owner-four"),
      async (lease) => lease.generation,
    );
    expect(generationAfterAbort).toBe(3);
  });

  it("aborts a bounded wait without taking ownership", async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const firstRun = withStorageWriterLease(options("owner-one"), async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;

    const controller = new AbortController();
    let waitingCallbackStarted = false;
    const waiting = withStorageWriterLease(
      options("owner-two", { waitTimeoutMs: 500, signal: controller.signal }),
      async () => {
        waitingCallbackStarted = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(waitingCallbackStarted).toBe(false);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });

    finish.resolve();
    await firstRun;
    await expect(
      withStorageWriterLease(options("owner-three"), async (lease) => lease.generation),
    ).resolves.toBe(2);
  });

  it("reports a bounded wait timeout", async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const firstRun = withStorageWriterLease(options("owner-one"), async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;

    const timeoutError = await withStorageWriterLease(
      options("owner-two", { waitTimeoutMs: 5 }),
      async () => undefined,
    ).catch((error: unknown) => error);
    expect(timeoutError).toBeInstanceOf(StorageWriterLeaseConflictError);
    expect((timeoutError as StorageWriterLeaseConflictError).status).toBe("timeout");

    finish.resolve();
    await firstRun;
  });

  it("rejects unsafe operation codes before opening the coordinator", async () => {
    await expect(
      withStorageWriterLease(
        options("owner-one", { operation: "file:///private/source" }),
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(StorageWriterLeaseValidationError);
    await expect(
      withStorageWriterLease(options("owner-one", { operation: "raw content" }), async () => 1),
    ).rejects.toBeInstanceOf(StorageWriterLeaseValidationError);
  });

  it("persists the generation across coordinator reopen", async () => {
    const firstGeneration = await withStorageWriterLease(
      options("owner-one", { scope: "candidate-knowledge-store", operation: "ckb-write" }),
      async (lease) => lease.generation,
    );
    const secondGeneration = await withStorageWriterLease(
      options("owner-two", { scope: "candidate-knowledge-store", operation: "ckb-refresh" }),
      async (lease) => lease.generation,
    );

    expect(firstGeneration).toBe(1);
    expect(secondGeneration).toBe(2);
  });
});
