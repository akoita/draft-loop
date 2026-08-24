import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** The scopes for which the application currently needs a durable writer lease. */
export const storageWriterLeaseScopes = ["workspace", "candidate-knowledge-store"] as const;

export type StorageWriterLeaseScope = (typeof storageWriterLeaseScopes)[number];

export type StorageWriterLeaseConflictStatus = "active" | "timeout";
export type StorageWriterLeaseStatus = StorageWriterLeaseConflictStatus | "lost";

export interface StorageWriterLeaseDiagnostic {
  readonly scope: StorageWriterLeaseScope;
  readonly activeOperation: string;
  readonly retryable: boolean;
  readonly status: StorageWriterLeaseStatus;
}

/** A content-free diagnostic for a lease conflict or a lease that was lost. */
export class StorageWriterLeaseError extends Error {
  public readonly diagnostic: Readonly<StorageWriterLeaseDiagnostic>;
  public readonly scope: StorageWriterLeaseScope;
  public readonly activeOperation: string;
  public readonly retryable: boolean;
  public readonly status: StorageWriterLeaseStatus;

  public constructor(diagnostic: StorageWriterLeaseDiagnostic) {
    const frozenDiagnostic = Object.freeze({ ...diagnostic });
    super(
      `Storage writer lease ${frozenDiagnostic.status}: scope=${frozenDiagnostic.scope}; activeOperation=${frozenDiagnostic.activeOperation}; retryable=${frozenDiagnostic.retryable}.`,
    );
    this.name = "StorageWriterLeaseError";
    this.diagnostic = frozenDiagnostic;
    this.scope = frozenDiagnostic.scope;
    this.activeOperation = frozenDiagnostic.activeOperation;
    this.retryable = frozenDiagnostic.retryable;
    this.status = frozenDiagnostic.status;
  }
}

/** A live lease prevented acquisition, or the bounded wait elapsed. */
export class StorageWriterLeaseConflictError extends StorageWriterLeaseError {
  public declare readonly status: StorageWriterLeaseConflictStatus;

  public constructor(
    diagnostic: Omit<StorageWriterLeaseDiagnostic, "status"> & {
      readonly status: StorageWriterLeaseConflictStatus;
    },
  ) {
    super(diagnostic);
    this.name = "StorageWriterLeaseConflictError";
  }
}

/** The caller tried to use a lease after it expired or was fenced by a successor. */
export class StorageWriterLeaseLostError extends StorageWriterLeaseError {
  public declare readonly status: "lost";

  public constructor(
    diagnostic: Omit<StorageWriterLeaseDiagnostic, "status"> & { readonly status: "lost" },
  ) {
    super(diagnostic);
    this.name = "StorageWriterLeaseLostError";
  }
}

/** Input was not a safe writer-lease request. */
export class StorageWriterLeaseValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StorageWriterLeaseValidationError";
  }
}

/** The local SQLite coordinator could not be opened or used. */
export class StorageWriterLeaseUnavailableError extends Error {
  public constructor(message = "The storage writer lease coordinator is unavailable.") {
    super(message);
    this.name = "StorageWriterLeaseUnavailableError";
  }
}

export interface StorageWriterLeaseOptions {
  /** A caller-owned SQLite file kept separate from any replaceable data store. */
  readonly coordinatorPath: string;
  readonly scope: StorageWriterLeaseScope;
  /** The operation code is intentionally limited to a safe, non-secret token. */
  readonly operation: string;
  /** An opaque token. It is never returned in metadata or diagnostics. */
  readonly ownerId?: string;
  readonly leaseDurationMs?: number;
  readonly waitTimeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Narrow test seam for deterministic expiry and fencing tests. */
  readonly now?: () => number;
  /** Narrow test seam for deterministic owner allocation. */
  readonly idFactory?: () => string;
}

export interface StorageWriterLease {
  readonly scope: StorageWriterLeaseScope;
  readonly operation: string;
  readonly generation: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  /** Throws a content-free lost error when this lease is no longer current. */
  readonly assertCurrent: () => void;
  /** Extends this lease only when its owner and fencing generation still match. */
  readonly renew: () => void;
}

export type StorageWriterLeaseCallback<T> = (lease: StorageWriterLease) => T | PromiseLike<T>;

const operationPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const unknownOperation = "unknown";
const defaultLeaseDurationMs = 30_000;
const defaultWaitTimeoutMs = 0;
const maxTimerMs = 2_147_483_647;
const sqliteBusyRetryMs = 25;
const NO_ERROR = Symbol("no error");

interface SqliteStatement {
  readonly run: (...parameters: readonly unknown[]) => {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  };
  readonly get: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => Row | undefined;
}

interface SqliteHandle {
  readonly exec: (sql: string) => void;
  readonly pragma: (sql: string) => unknown;
  readonly prepare: (sql: string) => SqliteStatement;
  readonly close: () => void;
}

interface SqliteConstructor {
  new (filename: string): SqliteHandle;
}

interface LeaseRow {
  readonly [key: string]: unknown;
  readonly scope: string;
  readonly generation: number;
  readonly owner_id: string | null;
  readonly operation_code: string | null;
  readonly acquired_at: number | null;
  readonly expires_at: number | null;
}

interface NormalizedOptions {
  readonly coordinatorPath: string;
  readonly scope: StorageWriterLeaseScope;
  readonly operation: string;
  readonly ownerId: string;
  readonly leaseDurationMs: number;
  readonly waitTimeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly now: () => number;
}

interface AcquiredLease {
  readonly generation: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

interface ConflictObservation {
  readonly activeOperation: string;
}

interface LeaseState {
  readonly options: NormalizedOptions;
  readonly database: SqliteHandle;
  readonly generation: number;
  readonly acquiredAt: number;
  expiresAt: number;
  released: boolean;
  lostError: StorageWriterLeaseLostError | undefined;
}

const createSchema = `
  CREATE TABLE IF NOT EXISTS writer_leases (
    scope TEXT PRIMARY KEY NOT NULL CHECK (scope IN ('workspace', 'candidate-knowledge-store')),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    owner_id TEXT,
    operation_code TEXT,
    acquired_at INTEGER,
    expires_at INTEGER,
    CHECK (
      (owner_id IS NULL AND operation_code IS NULL AND acquired_at IS NULL AND expires_at IS NULL)
      OR
      (owner_id IS NOT NULL AND operation_code IS NOT NULL AND acquired_at IS NOT NULL AND expires_at IS NOT NULL)
    )
  )
`;

const acquireStatement = `
  INSERT INTO writer_leases (
    scope,
    generation,
    owner_id,
    operation_code,
    acquired_at,
    expires_at
  ) VALUES (?, 1, ?, ?, ?, ?)
  ON CONFLICT(scope) DO UPDATE SET
    generation = writer_leases.generation + 1,
    owner_id = excluded.owner_id,
    operation_code = excluded.operation_code,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  WHERE writer_leases.owner_id IS NULL
     OR writer_leases.expires_at <= excluded.acquired_at
  RETURNING scope, generation, owner_id, operation_code, acquired_at, expires_at
`;

const currentStatement = `
  SELECT scope, generation, owner_id, operation_code, acquired_at, expires_at
  FROM writer_leases
  WHERE scope = ?
`;

const renewStatement = `
  UPDATE writer_leases
  SET expires_at = ?
  WHERE scope = ?
    AND owner_id = ?
    AND generation = ?
    AND expires_at > ?
`;

const releaseStatement = `
  UPDATE writer_leases
  SET owner_id = NULL,
      operation_code = NULL,
      acquired_at = NULL,
      expires_at = NULL
  WHERE scope = ?
    AND owner_id = ?
    AND generation = ?
    AND expires_at > ?
`;

function moduleRequire(): NodeRequire {
  try {
    return createRequire(import.meta.url);
  } catch {
    // Electron Forge can emit a CommonJS main bundle without a usable import.meta.url.
    return createRequire(join(process.cwd(), "package.json"));
  }
}

function loadSqlite(filename: string): SqliteHandle {
  let loaded: unknown;
  const require = moduleRequire();
  try {
    loaded = require("better-sqlite3");
  } catch {
    const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
      .resourcesPath;
    if (resourcesPath === undefined) {
      throw new StorageWriterLeaseUnavailableError();
    }
    try {
      loaded = require(join(resourcesPath, "better-sqlite3"));
    } catch {
      throw new StorageWriterLeaseUnavailableError();
    }
  }
  const Constructor = (loaded as { readonly default?: unknown }).default ?? loaded;
  if (typeof Constructor !== "function") {
    throw new StorageWriterLeaseUnavailableError();
  }
  try {
    return new (Constructor as SqliteConstructor)(filename);
  } catch {
    throw new StorageWriterLeaseUnavailableError();
  }
}

function openCoordinator(path: string): SqliteHandle {
  let database: SqliteHandle | undefined;
  try {
    database = loadSqlite(path);
    // Keep the coordinator private on platforms/filesystems that support POSIX modes.
    try {
      chmodSync(path, 0o600);
    } catch {
      // Permission hardening is best effort on platforms without POSIX file modes.
    }
    database.pragma("busy_timeout = 50");
    database.pragma("synchronous = FULL");
    database.exec(createSchema);
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the content-free coordinator error below.
    }
    if (error instanceof StorageWriterLeaseUnavailableError) {
      throw error;
    }
    throw new StorageWriterLeaseUnavailableError();
  }
}

function isBusyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "SQLITE_BUSY" ||
      (error as { readonly code?: unknown }).code === "SQLITE_LOCKED")
  );
}

function isStorageWriterLeaseScope(value: unknown): value is StorageWriterLeaseScope {
  return value === "workspace" || value === "candidate-knowledge-store";
}

function requireNow(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    throw new StorageWriterLeaseValidationError("Storage writer lease clock is invalid.");
  }
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new StorageWriterLeaseValidationError("Storage writer lease clock is invalid.");
  }
  return value;
}

function requireDuration(value: number | undefined, field: string, allowZero: boolean): number {
  const normalized =
    value ?? (field === "leaseDurationMs" ? defaultLeaseDurationMs : defaultWaitTimeoutMs);
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < (allowZero ? 0 : 1) ||
    normalized > maxTimerMs
  ) {
    throw new StorageWriterLeaseValidationError(`Storage writer lease ${field} is invalid.`);
  }
  return normalized;
}

function requireSafeOperation(operation: unknown): string {
  if (typeof operation !== "string" || operation.length < 1 || operation.length > 64) {
    throw new StorageWriterLeaseValidationError("Storage writer lease operation code is invalid.");
  }
  if (!operationPattern.test(operation)) {
    throw new StorageWriterLeaseValidationError("Storage writer lease operation code is invalid.");
  }
  return operation;
}

function requireOpaqueOwner(owner: unknown): string {
  if (typeof owner !== "string" || !ownerPattern.test(owner)) {
    throw new StorageWriterLeaseValidationError("Storage writer lease owner token is invalid.");
  }
  return owner;
}

function normalizeOptions(options: StorageWriterLeaseOptions): NormalizedOptions {
  if (typeof options !== "object" || options === null) {
    throw new StorageWriterLeaseValidationError("Storage writer lease options are required.");
  }
  if (typeof options.coordinatorPath !== "string" || options.coordinatorPath.trim() === "") {
    throw new StorageWriterLeaseValidationError(
      "Storage writer lease coordinator path is required.",
    );
  }
  if (!isStorageWriterLeaseScope(options.scope)) {
    throw new StorageWriterLeaseValidationError("Storage writer lease scope is invalid.");
  }
  const operation = requireSafeOperation(options.operation);
  const now = options.now ?? Date.now;
  if (typeof now !== "function") {
    throw new StorageWriterLeaseValidationError("Storage writer lease clock is invalid.");
  }
  requireNow(now);
  const ownerFactory = options.idFactory ?? randomUUID;
  let owner = options.ownerId;
  if (owner === undefined) {
    try {
      owner = ownerFactory();
    } catch {
      throw new StorageWriterLeaseValidationError("Storage writer lease owner token is invalid.");
    }
  }
  return {
    coordinatorPath: options.coordinatorPath,
    scope: options.scope,
    operation,
    ownerId: requireOpaqueOwner(owner),
    leaseDurationMs: requireDuration(options.leaseDurationMs, "leaseDurationMs", false),
    waitTimeoutMs: requireDuration(options.waitTimeoutMs, "waitTimeoutMs", true),
    signal: options.signal,
    now,
  };
}

function createAbortError(): Error {
  const error = new Error("Storage writer lease acquisition was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function safeOperationFromRow(operation: unknown): string {
  return typeof operation === "string" && operation.length <= 64 && operationPattern.test(operation)
    ? operation
    : unknownOperation;
}

function conflict(
  scope: StorageWriterLeaseScope,
  activeOperation: string,
  status: StorageWriterLeaseConflictStatus,
): StorageWriterLeaseConflictError {
  return new StorageWriterLeaseConflictError({
    scope,
    activeOperation: safeOperationFromRow(activeOperation),
    retryable: true,
    status,
  });
}

function currentSafeOperation(state: LeaseState): string {
  try {
    const row = state.database.prepare(currentStatement).get<LeaseRow>(state.options.scope);
    if (row?.owner_id !== null && row?.owner_id !== undefined) {
      return safeOperationFromRow(row.operation_code);
    }
  } catch {
    // A coordinator failure cannot safely identify the current operation.
  }
  return unknownOperation;
}

function lost(state: LeaseState): StorageWriterLeaseLostError {
  return new StorageWriterLeaseLostError({
    scope: state.options.scope,
    activeOperation: currentSafeOperation(state),
    retryable: true,
    status: "lost",
  });
}

function rowIsLive(row: LeaseRow | undefined, now: number): boolean {
  return (
    row !== undefined &&
    typeof row.owner_id === "string" &&
    typeof row.operation_code === "string" &&
    typeof row.expires_at === "number" &&
    row.expires_at > now
  );
}

function acquireOnce(
  database: SqliteHandle,
  options: NormalizedOptions,
  now: number,
): AcquiredLease | ConflictObservation {
  try {
    const expiresAt = now + options.leaseDurationMs;
    const row = database
      .prepare(acquireStatement)
      .get<LeaseRow>(options.scope, options.ownerId, options.operation, now, expiresAt);
    if (row !== undefined) {
      return {
        generation: row.generation,
        acquiredAt: row.acquired_at as number,
        expiresAt: row.expires_at as number,
      };
    }
    const active = database.prepare(currentStatement).get<LeaseRow>(options.scope);
    return {
      activeOperation: rowIsLive(active, now)
        ? safeOperationFromRow(active?.operation_code)
        : unknownOperation,
    };
  } catch (error) {
    if (isBusyError(error)) {
      return { activeOperation: unknownOperation };
    }
    throw new StorageWriterLeaseUnavailableError();
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function acquire(database: SqliteHandle, options: NormalizedOptions): Promise<AcquiredLease> {
  const startedAt = requireNow(options.now);
  const clockDeadline = startedAt + options.waitTimeoutMs;
  const wallDeadline = Date.now() + options.waitTimeoutMs;
  let lastActiveOperation = unknownOperation;

  while (true) {
    throwIfAborted(options.signal);
    const now = requireNow(options.now);
    const result = acquireOnce(database, options, now);
    if ("generation" in result) {
      return result;
    }
    lastActiveOperation = result.activeOperation;
    const remainingByClock = clockDeadline - now;
    const remainingByWall = wallDeadline - Date.now();
    if (options.waitTimeoutMs === 0 || remainingByClock <= 0 || remainingByWall <= 0) {
      throw conflict(
        options.scope,
        lastActiveOperation,
        options.waitTimeoutMs === 0 ? "active" : "timeout",
      );
    }
    await waitForRetry(
      Math.max(1, Math.min(sqliteBusyRetryMs, remainingByClock, remainingByWall)),
      options.signal,
    );
  }
}

function markLost(state: LeaseState): StorageWriterLeaseLostError {
  const existing = state.lostError;
  if (existing !== undefined) return existing;
  const error = lost(state);
  state.lostError = error;
  return error;
}

function assertCurrent(state: LeaseState): void {
  if (state.released) throw markLost(state);
  const now = requireNow(state.options.now);
  try {
    const row = state.database.prepare(currentStatement).get<LeaseRow>(state.options.scope);
    if (
      row === undefined ||
      row.owner_id !== state.options.ownerId ||
      row.generation !== state.generation ||
      row.operation_code !== state.options.operation ||
      typeof row.expires_at !== "number" ||
      row.expires_at <= now
    ) {
      throw markLost(state);
    }
  } catch (error) {
    if (error instanceof StorageWriterLeaseLostError) throw error;
    throw markLost(state);
  }
}

function renew(state: LeaseState): void {
  if (state.released) throw markLost(state);
  if (state.lostError !== undefined) throw state.lostError;
  const now = requireNow(state.options.now);
  const expiresAt = now + state.options.leaseDurationMs;
  try {
    const result = state.database
      .prepare(renewStatement)
      .run(expiresAt, state.options.scope, state.options.ownerId, state.generation, now);
    if (result.changes !== 1) throw markLost(state);
    state.expiresAt = expiresAt;
  } catch (error) {
    if (error instanceof StorageWriterLeaseLostError) throw error;
    throw markLost(state);
  }
}

function release(state: LeaseState): void {
  if (state.released) return;
  if (state.lostError !== undefined) throw state.lostError;
  const now = requireNow(state.options.now);
  try {
    const result = state.database
      .prepare(releaseStatement)
      .run(state.options.scope, state.options.ownerId, state.generation, now);
    if (result.changes !== 1) throw markLost(state);
    state.released = true;
  } catch (error) {
    if (error instanceof StorageWriterLeaseLostError) throw error;
    throw markLost(state);
  }
}

function createLease(
  database: SqliteHandle,
  options: NormalizedOptions,
  acquired: AcquiredLease,
): StorageWriterLease {
  const state: LeaseState = {
    options,
    database,
    generation: acquired.generation,
    acquiredAt: acquired.acquiredAt,
    expiresAt: acquired.expiresAt,
    released: false,
    lostError: undefined,
  };
  const capability: StorageWriterLease = {
    scope: options.scope,
    operation: options.operation,
    generation: acquired.generation,
    acquiredAt: acquired.acquiredAt,
    get expiresAt(): number {
      return state.expiresAt;
    },
    assertCurrent: (): void => assertCurrent(state),
    renew: (): void => renew(state),
  };
  leaseState.set(capability, state);
  return Object.freeze(capability);
}

function startHeartbeat(lease: StorageWriterLease, durationMs: number): () => void {
  const intervalMs = Math.max(1, Math.min(1_000, Math.floor(durationMs / 3)));
  const timer = setInterval(() => {
    try {
      lease.renew();
    } catch {
      // renew() records the fenced/lost state; the callback observes it through
      // assertCurrent or the post-callback guard. No error escapes the timer.
    }
  }, intervalMs);
  timer.unref?.();
  return (): void => clearInterval(timer);
}

/**
 * Run one operation while holding a durable, fenced writer lease.
 *
 * The coordinator file is supplied by the caller and is deliberately opaque
 * to all returned metadata and diagnostics.
 */
export async function withStorageWriterLease<T>(
  options: StorageWriterLeaseOptions,
  callback: StorageWriterLeaseCallback<T>,
): Promise<T> {
  const normalized = normalizeOptions(options);
  throwIfAborted(normalized.signal);
  let database: SqliteHandle | undefined;
  let lease: StorageWriterLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let result: T | undefined;
  let outcomeError: unknown = NO_ERROR;
  try {
    database = openCoordinator(normalized.coordinatorPath);
    const acquired = await acquire(database, normalized);
    lease = createLease(database, normalized, acquired);
    throwIfAborted(normalized.signal);
    stopHeartbeat = startHeartbeat(lease, normalized.leaseDurationMs);
    result = await callback(lease);
    const state = leaseState.get(lease);
    if (state?.released !== true) {
      lease.assertCurrent();
    }
  } catch (error) {
    outcomeError = error;
  }

  stopHeartbeat?.();
  if (lease !== undefined) {
    try {
      const state = leaseState.get(lease);
      if (state !== undefined) {
        release(state);
      }
    } catch (cleanupError) {
      // A callback failure remains primary if guarded release also fails.
      if (outcomeError === NO_ERROR) outcomeError = cleanupError;
    }
  }
  try {
    database?.close();
  } catch {
    if (outcomeError === NO_ERROR) {
      outcomeError = new StorageWriterLeaseUnavailableError();
    }
  }
  if (outcomeError !== NO_ERROR) throw outcomeError;
  return result as T;
}

const leaseState = new WeakMap<StorageWriterLease, LeaseState>();
