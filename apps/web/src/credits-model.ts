import { formatDate, formatEuros, formatLocale } from "@draft-loop/ui/locale-format";
import { plural, t } from "@lingui/core/macro";
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

/** An amount of credits, such as `1 credit` or `12 credits`. */
export function creditCount(count: number): string {
  return plural(count, { one: "# credit", other: "# credits" });
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
      message: message ?? t`The credit estimate could not be read.`,
    };
  }
}

/** A period end as people read it, in UTC. */
export function formatPeriodEnd(periodEnd: string, locale?: string): string {
  return (
    formatDate(periodEnd, { timeZone: "UTC", ...(locale === undefined ? {} : { locale }) }) ??
    periodEnd
  );
}

/** The balance in one line, such as `38 of 50 credits left. The period ends on 24 Nov 2026.` */
export function balanceLine(credits: MemberCredits, locale?: string): string {
  if (credits.unlimited || credits.remaining === null || credits.allowance === null)
    return t`Your plan has unlimited credits.`;
  const ends =
    credits.periodEnd === null
      ? ""
      : t` The period ends on ${formatPeriodEnd(credits.periodEnd, locale)}.`;
  const extra =
    credits.grantsRemaining > 0
      ? t` That includes ${creditCount(credits.grantsRemaining)} granted to you.`
      : "";
  return `${remainingOfAllowance(credits.remaining, credits.allowance)}.${ends}${extra}`;
}

/**
 * The balance in a few characters for a phone's header, such as `38 / 50`: the count alone when
 * bought credits exceed the allowance, and `∞` when unlimited. The full line stays for screen
 * readers.
 */
export function balanceChipShort(credits: MemberCredits): string {
  if (credits.unlimited || credits.remaining === null || credits.allowance === null) return "∞";
  return credits.remaining > credits.allowance
    ? String(credits.remaining)
    : `${credits.remaining} / ${credits.allowance}`;
}

/** The balance as a few words for the header, such as `38 of 50 credits left`. */
export function balanceChip(credits: MemberCredits): string {
  if (credits.unlimited || credits.remaining === null || credits.allowance === null)
    return t`Unlimited credits`;
  return remainingOfAllowance(credits.remaining, credits.allowance);
}

/**
 * What is left against the period's allowance, such as `38 of 50 credits left`. Bought or granted
 * credits can exceed the allowance; then only the count is given, such as `9 credits left`.
 */
function remainingOfAllowance(remaining: number, allowance: number): string {
  return remaining > allowance
    ? t`${creditCount(remaining)} left`
    : t`${remaining} of ${creditCount(allowance)} left`;
}

/** The estimate beside the start button, such as `This run uses 2 credits`. */
export function estimateLine(estimate: RunEstimate): string {
  return t`This run uses ${creditCount(estimate.credits)}.`;
}

/** Where and how a reset time is shown; the person's own locale and time zone by default. */
export interface ClockOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

/**
 * Why Start would be refused because the day's runs are used (#3126), with the local time the
 * daily limit resets; `undefined` while runs are left or the plan has no daily limit.
 */
export function runsUsedUp(estimate: RunEstimate, clock: ClockOptions = {}): string | undefined {
  const day = estimate.runsToday;
  if (day === undefined || day.limit === null || day.used < day.limit) return undefined;
  const limit = day.limit;
  const at = new Date(day.resetsAt);
  const time = Number.isNaN(at.getTime())
    ? undefined
    : new Intl.DateTimeFormat(formatLocale(clock.locale), {
        hour: "2-digit",
        minute: "2-digit",
        ...(clock.timeZone === undefined ? {} : { timeZone: clock.timeZone }),
      }).format(at);
  const used = plural(limit, {
    one: "Your plan allows # run a day, and today's is used.",
    other: "Your plan allows # runs a day, and today's are used.",
  });
  return time === undefined ? used : t`${used} Runs come back at ${time}.`;
}

/** Notes on a run the plan or the balance would refuse, in plain words. */
export function estimateNotes(estimate: RunEstimate, clock: ClockOptions = {}): string[] {
  const notes: string[] = [];
  const usedUp = runsUsedUp(estimate, clock);
  if (usedUp !== undefined) notes.push(usedUp);
  const plan = estimate.plan;
  if (plan !== undefined && !plan.allowed) {
    notes.push(
      plan.code === "plan_required"
        ? t`Your organisation has no plan yet.`
        : tierNotInPlan(plan.role, plan.tier),
    );
  }
  const balance = estimate.balance;
  if (balance !== undefined && !balance.unlimited && !balance.sufficient) {
    notes.push(
      balance.remaining === null
        ? t`There are not enough credits left for this run.`
        : t`There are not enough credits left for this run. You have ${creditCount(balance.remaining)}.`,
    );
  }
  return notes;
}

function tierNotInPlan(role: string | undefined, tier: string | undefined): string {
  const models = tier === undefined ? t`These models` : `${capital(tier)} models`;
  const who = role === undefined ? "" : ` for the ${role}`;
  return t`Your plan does not include ${models.toLowerCase()}${who}. Choose another preset or model.`;
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
          ? t`This run needs more credits`
          : t`This run needs ${creditCount(details.estimate)}`;
      const has =
        details?.remaining === undefined
          ? ""
          : t` and you have ${creditCount(details.remaining)} left`;
      return t`${needs}${has}. Ask the owner for more credits, or wait for the next period.`;
    }
    case "403 model_tier_not_in_plan":
      return t`${tierNotInPlan(details?.role, details?.tier)} Ask the owner about a bigger plan.`;
    case "403 plan_required":
      return t`Your organisation has no plan yet. Ask the owner to choose one.`;
    case "422 model_tier_unknown":
      return t`DraftLoop cannot price one of the workspace's models yet. Choose another preset or model.`;
    case "429 run_cap_reached":
      return runCapMessage(details);
    case "503 spend_pool_exhausted":
      return t`DraftLoop's model budget for this month is used up, so new runs cannot start. They open again on the 1st of next month.`;
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
      ? t`Your plan's runs for today are used. Try again later.`
      : plural(limit, {
          one: "Your plan allows # run a day, and today's is used. Try again later.",
          other: "Your plan allows # runs a day, and today's are used. Try again later.",
        });
  return limit === undefined
    ? t`Your plan's limit on runs at the same time is reached. Wait for a run to finish, then try again.`
    : plural(limit, {
        one: "Your plan allows # run at the same time, and it is running. Wait for it to finish, then try again.",
        other:
          "Your plan allows # runs at the same time, and they are running. Wait for one to finish, then try again.",
      });
}

function planLimitMessage(details: ApiRequestError["details"]): string {
  const value = details?.value;
  if (details?.limit === "seats") {
    const lead =
      value === undefined
        ? t`All the seats in your plan are taken.`
        : plural(value, {
            one: "Your plan allows # seat, and it is taken.",
            other: "Your plan allows # seats, and all are taken.",
          });
    return `${lead} ${t`Remove a member, or ask the owner for a bigger plan, before inviting someone.`}`;
  }
  if (details?.limit === "candidateRecords") {
    const lead =
      value === undefined
        ? t`All the candidates in your plan are in use.`
        : plural(value, {
            one: "Your plan allows # candidate, and it is in use.",
            other: "Your plan allows # candidates, and all are in use.",
          });
    return `${lead} ${t`Delete a candidate you no longer need, or ask the owner for a bigger plan, before creating another.`}`;
  }
  return t`Your plan's limit is reached. Ask the owner for a bigger plan.`;
}

/** What to tell the member about a failed call: a plan refusal first, then a consent refusal. */
export function describeStartError(error: unknown): string {
  return planRefusalMessage(error) ?? describeActionError(error);
}

export type CreditPackOffer = MemberCredits["creditPacks"][number];

/** A pack as its buy button names it, such as `5 credits for €22.00`, tax included. */
export function packLabel(pack: CreditPackOffer, locale?: string): string {
  const price = formatEuros(pack.priceEurCents / 100, locale === undefined ? {} : { locale });
  return t`${creditCount(pack.credits)} for ${price}`;
}

/** Why the buyer is back from the payment page, read from the address. */
export type PurchaseReturn = "done" | "cancelled";

export function purchaseReturn(search: string): PurchaseReturn | undefined {
  const value = new URLSearchParams(search).get("purchase");
  return value === "done" || value === "cancelled" ? value : undefined;
}

/** What to tell a buyer who came back from the payment page. */
export function purchaseReturnText(back: PurchaseReturn): string {
  return back === "done"
    ? t`Payment received. New credits show in your balance within a minute.`
    : t`The payment was cancelled. Nothing was charged.`;
}

/**
 * Opens the payment provider's checkout for a pack and answers its address. The page is on the
 * provider's own domain; anything else is refused before the browser leaves.
 */
export async function startPurchase(
  client: ApiClient,
  pack: CreditPackOffer["id"],
): Promise<string> {
  const { checkoutUrl } = await client.call("POST /v1/organisation/credit-purchases", {
    body: { pack },
  });
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") throw new Error("The payment page is not secure.");
  return url.toString();
}
