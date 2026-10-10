import { createRequire } from "node:module";
import { join } from "node:path";

import { StorageUnavailableError } from "./storage-errors.js";

/** The better-sqlite3 surface the storage uses, loaded lazily as an optional dependency. */
interface SqliteStatement {
  readonly run: (...parameters: readonly unknown[]) => {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  };
  readonly get: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => Row | undefined;
  readonly all: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => readonly Row[];
}

export interface SqliteHandle {
  readonly exec: (sql: string) => void;
  readonly pragma: (sql: string) => unknown;
  readonly prepare: (sql: string) => SqliteStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
  readonly backup: (destination: string) => Promise<unknown>;
  readonly close: () => void;
}

interface SqliteConstructor {
  new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): SqliteHandle;
}

export interface SqliteStorageOpenOptions {
  readonly readOnly?: boolean;
  readonly fileMustExist?: boolean;
}

function moduleRequire(): NodeRequire {
  try {
    return createRequire(import.meta.url);
  } catch {
    // Electron Forge emits the main bundle as CommonJS. In that bundle Vite
    // can leave import.meta.url undefined, so use an absolute cwd anchor.
    return createRequire(join(process.cwd(), "package.json"));
  }
}

export function loadSqlite(filename: string, options: SqliteStorageOpenOptions = {}): SqliteHandle {
  let loaded: unknown;
  const require = moduleRequire();
  try {
    loaded = require("better-sqlite3");
  } catch (error) {
    const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
      .resourcesPath;
    if (resourcesPath === undefined) {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
    try {
      loaded = require(join(resourcesPath, "better-sqlite3"));
    } catch {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
  }
  const Constructor = (loaded as { readonly default?: unknown }).default ?? loaded;
  if (typeof Constructor !== "function") {
    throw new StorageUnavailableError("The better-sqlite3 module did not expose a constructor.");
  }
  const sqliteOptions: { readonly?: boolean; fileMustExist?: boolean } = {};
  if (options.readOnly !== undefined) sqliteOptions.readonly = options.readOnly;
  if (options.fileMustExist !== undefined) sqliteOptions.fileMustExist = options.fileMustExist;
  return new (Constructor as SqliteConstructor)(filename, sqliteOptions);
}
