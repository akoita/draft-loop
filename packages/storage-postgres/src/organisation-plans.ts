import type { Entitlements } from "@draft-loop/domain/entitlements";
import {
  type EntitlementOverrides,
  entitlementOverridesSchema,
  type PlanId,
  planCatalogV1,
  planIdSchema,
  resolveEntitlements,
} from "@draft-loop/schemas/entitlements";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

/** What an operator assigns to an organisation. */
export interface PlanAssignmentInput {
  readonly planId: PlanId;
  /** Per-organisation entitlement overrides; omitted means none. */
  readonly overrides?: EntitlementOverrides | undefined;
  /** Seats held; required for a seat-priced plan, ignored for the others. */
  readonly seats?: number | undefined;
  /** The UTC date, `YYYY-MM-DD`, the current credit period starts. */
  readonly periodStart: string;
  /** When the operator made the assignment, an ISO 8601 timestamp. */
  readonly assignedAt: string;
}

/** An organisation's plan assignment as stored: ids, numbers and dates only. */
export interface PlanAssignment {
  readonly planId: PlanId;
  readonly catalogVersion: number;
  readonly overrides: EntitlementOverrides;
  /** Seats held, or null when the plan is not seat-priced. */
  readonly seats: number | null;
  /** The UTC date, `YYYY-MM-DD`, the current credit period starts. */
  readonly periodStart: string;
  readonly assignedAt: string;
}

/** One tenant's plan assignment: the current one, its history and the entitlements it grants. */
export interface OrganisationPlans {
  /** The tenant's current assignment, or undefined when it has none. */
  readonly currentPlanAssignment: () => Promise<PlanAssignment | undefined>;
  /** Replaces the current assignment and appends it to the history, in one transaction. */
  readonly assignPlan: (input: PlanAssignmentInput) => Promise<PlanAssignment>;
  /** Every assignment the tenant has had, oldest first. */
  readonly planAssignmentHistory: () => Promise<readonly PlanAssignment[]>;
  /** The entitlements of the current assignment, or undefined when the tenant has none. */
  readonly currentEntitlements: () => Promise<Entitlements | undefined>;
}

export type PlanAssignmentErrorCode =
  | "invalid_plan_assignment"
  | "organisation_not_found"
  | "stored_plan_invalid";

/** A refused assignment or unreadable stored one. Messages never carry the rejected values. */
export class PlanAssignmentError extends Error {
  readonly code: PlanAssignmentErrorCode;

  constructor(code: PlanAssignmentErrorCode, message: string) {
    super(message);
    this.name = "PlanAssignmentError";
    this.code = code;
  }
}

const assignmentColumns = `plan_id, catalog_version, overrides, seats,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, assigned_at`;

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function utcDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !datePattern.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new PlanAssignmentError(
      "invalid_plan_assignment",
      "The credit period start must be a UTC date, YYYY-MM-DD.",
    );
  }
  return value;
}

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new PlanAssignmentError(
      "invalid_plan_assignment",
      "The assignment time must be an ISO 8601 timestamp.",
    );
  }
  return parsed.toISOString();
}

/** Validates an assignment the way the stored one will be read back, so it can always resolve. */
function requirePlanAssignmentInput(input: PlanAssignmentInput): PlanAssignment {
  const planId = planIdSchema.safeParse(input.planId);
  const overrides = entitlementOverridesSchema.safeParse(input.overrides ?? {});
  if (!planId.success || !overrides.success) {
    throw new PlanAssignmentError(
      "invalid_plan_assignment",
      !planId.success ? "Unknown plan id." : "Invalid entitlement overrides.",
    );
  }
  const seatPriced = planCatalogV1.plans[planId.data].seatPriced;
  const seats = seatPriced ? (input.seats ?? null) : null;
  try {
    resolveEntitlements(planId.data, overrides.data, { seats: seats ?? undefined });
  } catch {
    throw new PlanAssignmentError(
      "invalid_plan_assignment",
      "A seat-priced plan needs a positive whole number of seats.",
    );
  }
  return {
    planId: planId.data,
    catalogVersion: planCatalogV1.version,
    overrides: overrides.data,
    seats,
    periodStart: utcDate(input.periodStart),
    assignedAt: isoTimestamp(input.assignedAt),
  };
}

/** The table's checks hold the shapes, so a row that no longer parses is corrupt, not user input. */
function planAssignment(row: SqlRow): PlanAssignment {
  const planId = planIdSchema.safeParse(row.plan_id);
  const overrides = entitlementOverridesSchema.safeParse(row.overrides);
  const catalogVersion = Number(row.catalog_version);
  if (!planId.success || !overrides.success || catalogVersion !== planCatalogV1.version) {
    throw new PlanAssignmentError(
      "stored_plan_invalid",
      "The stored plan assignment is not valid for the plan catalog.",
    );
  }
  return {
    planId: planId.data,
    catalogVersion,
    overrides: overrides.data,
    seats: row.seats === null || row.seats === undefined ? null : Number(row.seats),
    periodStart: String(row.period_start),
    assignedAt: (row.assigned_at instanceof Date
      ? row.assigned_at
      : new Date(String(row.assigned_at))
    ).toISOString(),
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23503";
}

async function insertAssignment(
  executor: SqlExecutor,
  table: "organisation_plans" | "organisation_plan_history",
  assignment: PlanAssignment,
  conflict = "",
): Promise<SqlRow | undefined> {
  const [row] = await executor.query(
    `INSERT INTO ${table}
       (plan_id, catalog_version, overrides, seats, period_start, assigned_at)
     VALUES ($1, $2, $3::jsonb, $4, $5::date, $6)${conflict}
     RETURNING ${assignmentColumns}`,
    [
      assignment.planId,
      assignment.catalogVersion,
      JSON.stringify(assignment.overrides),
      assignment.seats,
      assignment.periodStart,
      assignment.assignedAt,
    ],
  );
  return row;
}

const replaceCurrent = `
  ON CONFLICT (tenant_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id, catalog_version = EXCLUDED.catalog_version,
    overrides = EXCLUDED.overrides, seats = EXCLUDED.seats,
    period_start = EXCLUDED.period_start, assigned_at = EXCLUDED.assigned_at`;

/**
 * The tenant's plan assignment on Postgres. The current row is keyed by the tenant, which is the
 * organisation, and row-level security confines every statement to it. The operator reaches
 * another organisation by opening that organisation's tenant, as organisation erasure does.
 */
export function createOrganisationPlans(client: SqlSession): OrganisationPlans {
  const current = async (): Promise<PlanAssignment | undefined> => {
    const [row] = await client.query(`SELECT ${assignmentColumns} FROM organisation_plans`);
    return row === undefined ? undefined : planAssignment(row);
  };
  return {
    currentPlanAssignment: current,

    assignPlan: async (input) => {
      const assignment = requirePlanAssignmentInput(input);
      try {
        return await client.transaction(async (executor) => {
          // The current row's lock is taken first, so concurrent assignments append in the order
          // in which they replace the current one.
          const row = await insertAssignment(
            executor,
            "organisation_plans",
            assignment,
            replaceCurrent,
          );
          await insertAssignment(executor, "organisation_plan_history", assignment);
          if (row === undefined) throw new Error("The plan assignment was not stored.");
          return planAssignment(row);
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new PlanAssignmentError("organisation_not_found", "No such organisation.");
        }
        throw error;
      }
    },

    planAssignmentHistory: async () => {
      const rows = await client.query(
        `SELECT ${assignmentColumns} FROM organisation_plan_history ORDER BY sequence`,
      );
      return rows.map(planAssignment);
    },

    currentEntitlements: async () => {
      const assignment = await current();
      if (assignment === undefined) return undefined;
      return resolveEntitlements(assignment.planId, assignment.overrides, {
        seats: assignment.seats ?? undefined,
      });
    },
  };
}
