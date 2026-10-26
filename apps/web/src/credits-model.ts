import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { describeActionError } from "./consent-model.js";

export type MemberCredits = ApiSchemas["MemberCredits"];
export type RunEstimate = ApiSchemas["RunEstimate"];

/** What the balance line shows: hidden in owner-token mode, where nothing is metered for people. */
export type CreditsState =
  | { readonly kind: "loading" }
  | { readonly kind: "hidden" }
  | { readonly kind: "no-plan" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly credits: MemberCredits };

/** What the estimate beside the start button shows. */
export type EstimateState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly estimate: RunEstimate };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** An amount of credits, such as `1 credit` or `12 credits`. */
export function creditCount(count: number): string {
  return plural(count, "credit", "credits");
}

/** Reads the organisation's balance; the route answers 404 in owner-token mode. */
export async function readCredits(client: ApiClient): Promise<CreditsState> {
  try {
    return { kind: "ready", credits: await client.call("GET /v1/organisation/credits", {}) };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 404) return { kind: "hidden" };
      if (error.code === "plan_required") return { kind: "no-plan" };
    }
    return { kind: "failed" };
  }
}

/** Reads the estimate of the run the next start would make. */
export async function readEstimate(
  client: ApiClient,
  workspaceId: string,
  applicationId: string | undefined,
): Promise<EstimateState> {
  try {
    const estimate = await client.call("GET /v1/workspaces/{workspaceId}/runs/estimate", {
      path: { workspaceId },
      ...(applicationId === undefined ? {} : { query: { applicationId } }),
    });
    return { kind: "ready", estimate };
  } catch (error) {
    const message = planRefusalMessage(error);
    return {
      kind: "failed",
      message: message ?? "The credit estimate could not be read.",
    };
  }
}

/** A period end as people read it, in UTC. */
export function formatPeriodEnd(periodEnd: string, locale?: string): string {
  return new Date(periodEnd).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" });
}

/** The balance in one line, such as `38 of 50 credits left. The period ends on 24 Nov 2026.` */
export function balanceLine(credits: MemberCredits, locale?: string): string {
  if (credits.unlimited || credits.remaining === null || credits.allowance === null)
    return "Your plan has unlimited credits.";
  const ends =
    credits.periodEnd === null
      ? ""
      : ` The period ends on ${formatPeriodEnd(credits.periodEnd, locale)}.`;
  const extra =
    credits.grantsRemaining > 0
      ? ` That includes ${creditCount(credits.grantsRemaining)} granted to you.`
      : "";
  return `${credits.remaining} of ${creditCount(credits.allowance)} left.${ends}${extra}`;
}

/** The 80% warning, or `undefined` while the balance is below it. */
export function balanceWarning(credits: MemberCredits): string | undefined {
  if (!credits.warning) return undefined;
  return credits.remaining === 0
    ? "The credits are used up. New runs wait for the next period or a grant."
    : "Most of this period's credits are used. Runs stop starting when they run out.";
}

/** The estimate beside the start button, such as `This run uses 2 credits`. */
export function estimateLine(estimate: RunEstimate): string {
  return `This run uses ${creditCount(estimate.credits)}.`;
}

/** Notes on a run the plan or the balance would refuse, in plain words. */
export function estimateNotes(estimate: RunEstimate): string[] {
  const notes: string[] = [];
  const plan = estimate.plan;
  if (plan !== undefined && !plan.allowed) {
    notes.push(
      plan.code === "plan_required"
        ? "Your organisation has no plan yet."
        : tierNotInPlan(plan.role, plan.tier),
    );
  }
  const balance = estimate.balance;
  if (balance !== undefined && !balance.unlimited && !balance.sufficient) {
    notes.push(
      balance.remaining === null
        ? "There are not enough credits left for this run."
        : `There are not enough credits left for this run. You have ${creditCount(balance.remaining)}.`,
    );
  }
  return notes;
}

function tierNotInPlan(role: string | undefined, tier: string | undefined): string {
  const models = tier === undefined ? "These models" : `${capital(tier)} models`;
  const who = role === undefined ? "" : ` for the ${role}`;
  return `Your plan does not include ${models.toLowerCase()}${who}. Choose another preset or model.`;
}

function capital(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

/**
 * A plain message for a refused run start, seat or record, or `undefined` for any other error.
 * The messages carry codes' numbers and names only, never candidate content.
 */
export function planRefusalMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const { code, status, details } = error;
  switch (`${status} ${code}`) {
    case "402 credits_insufficient": {
      const needs =
        details?.estimate === undefined
          ? "This run needs more credits"
          : `This run needs ${creditCount(details.estimate)}`;
      const has =
        details?.remaining === undefined
          ? ""
          : ` and you have ${creditCount(details.remaining)} left`;
      return `${needs}${has}. Ask the owner for more credits, or wait for the next period.`;
    }
    case "403 model_tier_not_in_plan":
      return `${tierNotInPlan(details?.role, details?.tier)} Ask the owner about a bigger plan.`;
    case "403 plan_required":
      return "Your organisation has no plan yet. Ask the owner to choose one.";
    case "422 model_tier_unknown":
      return "DraftLoop cannot price one of the workspace's models yet. Choose another preset or model.";
    case "429 run_cap_reached":
      return runCapMessage(details);
    case "409 plan_limit_reached":
      return planLimitMessage(details);
    default:
      return undefined;
  }
}

function runCapMessage(details: ApiRequestError["details"]): string {
  const limit = typeof details?.limit === "number" ? details.limit : undefined;
  if (details?.cap === "per_day")
    return limit === undefined
      ? "Your plan's runs for today are used. Try again later."
      : `Your plan allows ${plural(limit, "run", "runs")} a day, and today's are used. Try again later.`;
  return limit === undefined
    ? "Your plan's limit on runs at the same time is reached. Wait for a run to finish, then try again."
    : `Your plan allows ${plural(limit, "run", "runs")} at the same time, and they are running. Wait for one to finish, then try again.`;
}

function planLimitMessage(details: ApiRequestError["details"]): string {
  const value = details?.value;
  if (details?.limit === "seats") {
    return `${value === undefined ? "All the seats in your plan are taken." : `Your plan allows ${plural(value, "seat", "seats")}, and all are taken.`} Remove a member, or ask the owner for a bigger plan, before inviting someone.`;
  }
  if (details?.limit === "candidateRecords")
    return `${value === undefined ? "All the candidate records in your plan are in use." : `Your plan allows ${plural(value, "candidate record", "candidate records")}, and all are in use.`} Delete a record you no longer need, or ask the owner for a bigger plan, before creating another.`;
  return "Your plan's limit is reached. Ask the owner for a bigger plan.";
}

/** What to tell the member about a failed call: a plan refusal first, then a consent refusal. */
export function describeStartError(error: unknown): string {
  return planRefusalMessage(error) ?? describeActionError(error);
}
