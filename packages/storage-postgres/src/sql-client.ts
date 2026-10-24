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

/** Runs parameterized SQL and transactions without owning the pool underneath. */
export interface SqlSession extends SqlExecutor {
  /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
  readonly transaction: <Result>(
    work: (executor: SqlExecutor) => Promise<Result>,
    options?: SqlTransactionOptions,
  ) => Promise<Result>;
}

/**
 * A connection pool scoped to one schema and, for storage, one tenant, with transactions and an
 * explicit close. With a tenant, every statement runs in a transaction that sets it first.
 */
export interface SqlClient extends SqlSession {
  readonly close: () => Promise<void>;
}

/**
 * One schema's connection pool shared by many tenants. Its own statements run without a tenant;
 * `forTenant` hands out a session whose every statement runs in a transaction that sets that
 * tenant first. Sessions borrow the pool, so only the pool closes.
 */
export interface SqlPool extends SqlClient {
  readonly forTenant: (tenantId: string) => SqlSession;
}

export type SqlPoolOptions = Omit<SqlClientOptions, "tenantId">;

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
export function createSqlPool(options: SqlPoolOptions): SqlPool {
  const schema = requireSchemaName(options.schema ?? "public");
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    options: `-c search_path=${schema}`,
  });
  const transactionFor =
    (tenantId: string | undefined): SqlSession["transaction"] =>
    async (work, transactionOptions = {}) => {
      const connection = await pool.connect();
      try {
        await connection.query(
          transactionOptions.readOnlySnapshot === true
            ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
            : "BEGIN",
        );
        // Transaction-local, so a connection returns to the pool without any tenant set.
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
    query: executorFor(pool).query,
    transaction: transactionFor(undefined),
    forTenant: (tenantId) => {
      const transaction = transactionFor(requireTenantId(tenantId));
      return {
        query: (text, parameters) => transaction((executor) => executor.query(text, parameters)),
        transaction,
      };
    },
    close: () => pool.end(),
  };
}

/** Opens a pool for migrations without a tenant, or for one tenant's storage. */
export function createSqlClient(options: SqlClientOptions): SqlClient {
  const { tenantId, ...poolOptions } = options;
  if (tenantId !== undefined) requireTenantId(tenantId);
  const pool = createSqlPool(poolOptions);
  const session = tenantId === undefined ? pool : pool.forTenant(tenantId);
  return { query: session.query, transaction: session.transaction, close: pool.close };
}
