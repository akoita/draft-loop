import type { SqlExecutor } from "./sql-client.js";

/** The highest cap the operator may set; the deployment's variable has the same bound. */
export const maximumBetaAccountCap = 100_000;

/** The cap the operator set at runtime (#2998), or undefined while none is set. */
export async function readOperatorCap(executor: SqlExecutor): Promise<number | undefined> {
  const [row] = await executor.query("SELECT account_cap FROM beta_account_cap");
  return row === undefined ? undefined : Number(row.account_cap);
}

/** Sets the runtime cap, replacing any earlier one. */
export async function writeOperatorCap(
  executor: SqlExecutor,
  input: { readonly cap: number; readonly now: Date },
): Promise<void> {
  if (!Number.isInteger(input.cap) || input.cap < 0 || input.cap > maximumBetaAccountCap) {
    throw new Error(
      `The beta account cap must be a whole number from 0 to ${maximumBetaAccountCap}.`,
    );
  }
  if (Number.isNaN(input.now.getTime())) throw new Error("A clock must be a valid date.");
  await executor.query(
    `INSERT INTO beta_account_cap (id, account_cap, updated_at) VALUES (true, $1, $2)
     ON CONFLICT (id) DO UPDATE SET account_cap = EXCLUDED.account_cap, updated_at = EXCLUDED.updated_at`,
    [input.cap, input.now.toISOString()],
  );
}
