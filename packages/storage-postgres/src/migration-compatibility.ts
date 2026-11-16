/**
 * Expand-and-contract check for Postgres migrations (#2831). A release is rolled back by
 * redeploying the previous images against the newer schema, so a migration must leave the schema
 * usable by the release before it: it may add, never take away or reshape. The guide is
 * docs/engineering/database-schema.md.
 */

/** A schema change the previous release may not survive. */
export interface MigrationCompatibilityFinding {
  readonly version: number;
  readonly rule:
    | "drop-table"
    | "drop-column"
    | "rename"
    | "change-column-type"
    | "add-required-column"
    | "set-not-null";
  readonly statement: string;
}

/** The fields of a migration the check reads. */
export interface CheckedMigration {
  readonly version: number;
  readonly sql: string;
  /**
   * Set only on a contract step: it says what the step removes and which release stopped using
   * it, at least one release before this one. The check then allows that step's removals.
   */
  readonly contract?: string;
}

/** Removes comments, string literals and dollar-quoted bodies, which hold no schema change. */
function schemaStatements(sql: string): readonly string[] {
  const stripped = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/gu, " ")
    .replace(/--[^\n]*/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/'(?:[^']|'')*'/gu, "''");
  return stripped
    .split(";")
    .map((statement) => statement.replace(/\s+/gu, " ").trim())
    .filter((statement) => statement !== "");
}

/** Splits an ALTER TABLE's actions at top-level commas. */
function alterActions(statement: string): readonly string[] {
  const actions: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of statement) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      actions.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  actions.push(current.trim());
  return actions;
}

function statementRules(statement: string): MigrationCompatibilityFinding["rule"][] {
  const rules: MigrationCompatibilityFinding["rule"][] = [];
  if (/^DROP TABLE\b/iu.test(statement)) rules.push("drop-table");
  if (/^ALTER (?:TABLE|INDEX|SEQUENCE|VIEW|FUNCTION|TYPE)\b.*\bRENAME\b/iu.test(statement)) {
    rules.push("rename");
  }
  if (!/^ALTER TABLE\b/iu.test(statement)) return rules;
  for (const action of alterActions(statement)) {
    // DROP COLUMN, or its short form DROP <column>; dropping a constraint, default, NOT NULL,
    // identity or expression only relaxes the schema.
    if (/\bDROP (?!CONSTRAINT\b|DEFAULT\b|NOT NULL\b|IDENTITY\b|EXPRESSION\b)\w/iu.test(action)) {
      rules.push("drop-column");
    }
    if (/\bALTER (?:COLUMN )?\S+ (?:SET DATA )?TYPE\b/iu.test(action)) {
      rules.push("change-column-type");
    }
    if (/\bSET NOT NULL\b/iu.test(action)) rules.push("set-not-null");
    if (
      /\bADD (?:COLUMN )?(?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|CHECK\b|FOREIGN\b|EXCLUDE\b)/iu.test(
        action,
      ) &&
      /\bNOT NULL\b/iu.test(action) &&
      !/\bDEFAULT\b/iu.test(action) &&
      !/\bGENERATED\b/iu.test(action)
    ) {
      rules.push("add-required-column");
    }
  }
  return rules;
}

/** Every reshaping statement of the migrations that are not marked contract steps. */
export function checkMigrationCompatibility(
  migrations: readonly CheckedMigration[],
): readonly MigrationCompatibilityFinding[] {
  const findings: MigrationCompatibilityFinding[] = [];
  for (const migration of migrations) {
    if (migration.contract !== undefined && migration.contract.trim() !== "") continue;
    for (const statement of schemaStatements(migration.sql)) {
      for (const rule of statementRules(statement)) {
        findings.push({ version: migration.version, rule, statement: statement.slice(0, 160) });
      }
    }
  }
  return findings;
}
