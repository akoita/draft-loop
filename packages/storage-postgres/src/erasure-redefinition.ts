/**
 * The erasure functions list every table a record or an organisation holds, so a migration that
 * adds a table redefines them. These helpers take the latest definition from the migration that
 * last wrote it and insert the new steps, so each redefinition differs from the last by its new
 * tables only. Migration SQL derived this way is as fixed as the SQL it is derived from.
 */

/** The `EXECUTE format(...)` statement that defines `name` in an earlier migration's SQL. */
export function erasureDefinition(sql: string, name: string): string {
  const start = sql.indexOf(
    `EXECUTE format($template$\n        CREATE OR REPLACE FUNCTION %1$I.${name}(`,
  );
  const closing = "$template$, current_schema());";
  const end = sql.indexOf(closing, start);
  if (start < 0 || end < 0) throw new Error(`The ${name} definition was not found.`);
  return sql.slice(start, end + closing.length);
}

/** Inserts `lines` before the one step that `anchor` names. */
export function withErasureSteps(
  definition: string,
  anchor: string,
  lines: readonly string[],
): string {
  if (definition.split(anchor).length !== 2) {
    throw new Error("The erasure step anchor was not found exactly once.");
  }
  return definition.replace(anchor, () => `${lines.map((line) => `${line}\n`).join("")}${anchor}`);
}
