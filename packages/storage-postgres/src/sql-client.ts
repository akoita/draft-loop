import pg from "pg";

/** One statement's result rows, keyed by column name. */
export type SqlRow = Record<string, unknown>;

/** Runs parameterized SQL. Both the pool and a transaction's client satisfy it. */
export interface SqlExecutor {
  readonly query: (text: string, parameters?: readonly unknown[]) => Promise<readonly SqlRow[]>;
}

export interface SqlTransactionOptions {
  /** Reads from one consistent snapshot (REPEATABLE READ, READ ONLY). */
  readonly readOnlySnapshot?: boolean;
}

/**
 * A connection pool scoped to one schema and, for storage, one tenant, with transactions and an
 * explicit close. With a tenant, every statement runs in a transaction that sets it first.
 */
export interface SqlClient extends SqlExecutor {
  /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
  readonly transaction: <Result>(
    work: (executor: SqlExecutor) => Promise<Result>,
    options?: SqlTransactionOptions,
  ) => Promise<Result>;
  readonly close: () => Promise<void>;
}

export interface SqlClientOptions {
  readonly connectionString: string;
  /** The schema every statement resolves unqualified names in. Defaults to `public`. */
  readonly schema?: string;
  readonly maxConnections?: number;
  /**
   * The tenant every transaction acts for, set as the transaction-local `draft_loop.tenant_id`
   * that row-level security and the `tenant_id` defaults read. Omitted only for migrations.
   */
  readonly tenantId?: string;
}

const tenantPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Validates a tenant id before it scopes any transaction. */
export function requireTenantId(tenantId: string): string {
  if (!tenantPattern.test(tenantId)) throw new Error("Invalid tenant id");
  return tenantId;
}

const schemaPattern = /^[a-z_][a-z0-9_]{0,62}$/u;

/** Validates a schema name before it reaches a connection option or a DDL statement. */
export function requireSchemaName(schema: string): string {
  if (!schemaPattern.test(schema)) {
    throw new Error(`Invalid Postgres schema name: ${schema}`);
  }
  return schema;
}

function executorFor(target: pg.Pool | pg.PoolClient): SqlExecutor {
  return {
    query: async (text, parameters = []) => (await target.query(text, [...parameters])).rows,
  };
}

/** Opens a pool whose connections resolve names in the requested schema. */
export function createSqlClient(options: SqlClientOptions): SqlClient {
  const schema = requireSchemaName(options.schema ?? "public");
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    options: `-c search_path=${schema}`,
  });
  const tenantId = options.tenantId === undefined ? undefined : requireTenantId(options.tenantId);
  const transaction: SqlClient["transaction"] = async (work, transactionOptions = {}) => {
    const connection = await pool.connect();
    try {
      await connection.query(
        transactionOptions.readOnlySnapshot === true
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN",
      );
      if (tenantId !== undefined) {
        await connection.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
      }
      const result = await work(executorFor(connection));
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  };
  return {
    query:
      tenantId === undefined
        ? executorFor(pool).query
        : (text, parameters) => transaction((executor) => executor.query(text, parameters)),
    transaction,
    close: () => pool.end(),
  };
}
