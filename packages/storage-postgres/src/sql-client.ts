import pg from "pg";

/** One statement's result rows, keyed by column name. */
export type SqlRow = Record<string, unknown>;

/** Runs parameterized SQL. Both the pool and a transaction's client satisfy it. */
export interface SqlExecutor {
  readonly query: (text: string, parameters?: readonly unknown[]) => Promise<readonly SqlRow[]>;
}

/** A connection pool scoped to one schema, with transactions and an explicit close. */
export interface SqlClient extends SqlExecutor {
  /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
  readonly transaction: <Result>(
    work: (executor: SqlExecutor) => Promise<Result>,
  ) => Promise<Result>;
  readonly close: () => Promise<void>;
}

export interface SqlClientOptions {
  readonly connectionString: string;
  /** The schema every statement resolves unqualified names in. Defaults to `public`. */
  readonly schema?: string;
  readonly maxConnections?: number;
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
  return {
    ...executorFor(pool),
    transaction: async (work) => {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await work(executorFor(connection));
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
