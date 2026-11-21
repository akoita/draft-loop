/**
 * The content-free usage funnel (#2834): where testers stop, week by week. It reduces each
 * organisation's first time at each step, read from existing records, to counts. It never sees a
 * name, an address, a CV or a job text, and it shows no organisation on its own: every number
 * adds organisations up.
 */

/** The funnel's steps, in the order a tester reaches them. */
export const usageFunnelSteps = [
  "signedIn",
  "evidence",
  "briefReviewed",
  "draftFinished",
  "approved",
  "exported",
  "prepared",
] as const;

export type UsageFunnelStep = (typeof usageFunnelSteps)[number];

/** One organisation's milestones: ISO times, `null` for a step it has not reached. */
export interface OrganisationMilestones {
  /** When each member first signed in, for the weekly sign-ups. */
  readonly memberSignIns: readonly string[];
  readonly firsts: Readonly<Record<UsageFunnelStep, string | null>>;
  /** Times of activity in the window (runs, decisions, exports, evidence), for weekly activity. */
  readonly activity: readonly string[];
}

export interface UsageFunnelWeek {
  /** Monday of the week, `YYYY-MM-DD`, UTC. */
  readonly weekStart: string;
  /** Members who first signed in that week. */
  readonly signUps: number;
  /** Organisations that reached each step for the first time that week. */
  readonly firsts: Readonly<Record<UsageFunnelStep, number>>;
  /** Organisations with any activity that week. */
  readonly activeOrganisations: number;
}

export interface UsageFunnelStepTotal {
  readonly step: UsageFunnelStep;
  /** Organisations first signed in within the window that reached this step by now. */
  readonly reached: number;
  /** Share of the previous step's organisations that reached this one; `null` for the first. */
  readonly fromPrevious: number | null;
}

export interface UsageFunnel {
  readonly weeks: readonly UsageFunnelWeek[];
  /** The cohort of the window: organisations first signed in during these weeks. */
  readonly cohort: readonly UsageFunnelStepTotal[];
  /** Organisations read, all of them, for the totals. */
  readonly organisations: number;
}

const dayMs = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week holding `time`. */
export function weekStartOf(time: Date): Date {
  const day = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * dayMs);
}

function emptySteps(): Record<UsageFunnelStep, number> {
  return Object.fromEntries(usageFunnelSteps.map((step) => [step, 0])) as Record<
    UsageFunnelStep,
    number
  >;
}

/** The first day of the window that `usageFunnel` reports for `weeks` weeks ending with `now`'s. */
export function usageFunnelSince(now: Date, weeks: number): Date {
  return new Date(weekStartOf(now).getTime() - (weeks - 1) * 7 * dayMs);
}

/** The funnel over the last `weeks` weeks, the current one last. */
export function usageFunnel(input: {
  readonly organisations: readonly OrganisationMilestones[];
  readonly now: Date;
  readonly weeks: number;
}): UsageFunnel {
  const { organisations, now, weeks } = input;
  if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new Error("A funnel covers 1 to 52 weeks.");
  }
  const since = usageFunnelSince(now, weeks);
  const starts = Array.from({ length: weeks }, (_, index) =>
    new Date(since.getTime() + index * 7 * dayMs).toISOString().slice(0, 10),
  );
  const rows = starts.map((weekStart) => ({
    weekStart,
    signUps: 0,
    firsts: emptySteps(),
    active: 0,
  }));
  const indexOf = (iso: string | null): number | undefined => {
    if (iso === null) return undefined;
    const time = Date.parse(iso);
    if (!Number.isFinite(time) || time < since.getTime() || time > now.getTime()) return undefined;
    return Math.floor((time - since.getTime()) / (7 * dayMs));
  };
  const cohort = emptySteps();

  for (const organisation of organisations) {
    for (const signIn of organisation.memberSignIns) {
      const index = indexOf(signIn);
      if (index !== undefined) (rows[index] as (typeof rows)[number]).signUps += 1;
    }
    for (const step of usageFunnelSteps) {
      const index = indexOf(organisation.firsts[step]);
      if (index !== undefined) (rows[index] as (typeof rows)[number]).firsts[step] += 1;
    }
    const activeWeeks = new Set(
      organisation.activity.flatMap((time) => {
        const index = indexOf(time);
        return index === undefined ? [] : [index];
      }),
    );
    for (const index of activeWeeks) (rows[index] as (typeof rows)[number]).active += 1;
    // The cohort: organisations first signed in within the window, and how far each got.
    if (indexOf(organisation.firsts.signedIn) !== undefined) {
      for (const step of usageFunnelSteps) {
        if (organisation.firsts[step] !== null) cohort[step] += 1;
      }
    }
  }

  return {
    weeks: rows.map(({ weekStart, signUps, firsts, active }) => ({
      weekStart,
      signUps,
      firsts,
      activeOrganisations: active,
    })),
    cohort: usageFunnelSteps.map((step, index) => {
      const previous = index === 0 ? undefined : usageFunnelSteps[index - 1];
      const before = previous === undefined ? undefined : cohort[previous];
      return {
        step,
        reached: cohort[step],
        fromPrevious:
          before === undefined
            ? null
            : before === 0
              ? 0
              : Math.round((cohort[step] / before) * 100) / 100,
      };
    }),
    organisations: organisations.length,
  };
}

/** Where the funnel reads from: the deployment's organisations and each one's milestones. */
export interface UsageFunnelSource {
  readonly organisations: (limit: number) => Promise<readonly string[]>;
  readonly milestones: (organisationId: string, since: Date) => Promise<OrganisationMilestones>;
}

/** The most organisations one report reads. */
export const maximumFunnelOrganisations = 1_000;

/** Reads every organisation's milestones, one at a time, and reduces them to the funnel. */
export async function readUsageFunnel(
  source: UsageFunnelSource,
  options: { readonly now: Date; readonly weeks: number },
): Promise<UsageFunnel> {
  const since = usageFunnelSince(options.now, options.weeks);
  const organisations: OrganisationMilestones[] = [];
  for (const organisationId of await source.organisations(maximumFunnelOrganisations)) {
    organisations.push(await source.milestones(organisationId, since));
  }
  return usageFunnel({ organisations, now: options.now, weeks: options.weeks });
}
