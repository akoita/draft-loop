/**
 * The application plan a run made before drafting, as Run details shows it (#1304): the job's
 * central themes, what the CV leads with, what is cut, and the themes the evidence does not
 * support. The host reads the run's recorded `run.application-plan` event and resolves requirement
 * ids to their text, so only short user-visible text and counts cross the bridge, never evidence
 * ids. Runs that did not plan keep Run details exactly as before.
 *
 * The runtime key lists are bound to the interfaces, so adding a field to one without the other is
 * a compile error rather than a validator that silently rejects real payloads.
 */

export const applicationPlanReviewStates = ["accepted", "revised", "pending"] as const;
export type ApplicationPlanReviewState = (typeof applicationPlanReviewStates)[number];
export const applicationPlanCutActions = ["drop", "compress"] as const;

export interface ApplicationPlanThemeView {
  readonly title: string;
  readonly rationale: string;
  /** The text of the job requirements the theme answers. */
  readonly requirements: readonly string[];
  /** How many approved accomplishments prove the theme; zero for a gap. */
  readonly proofCount: number;
  /** True when no approved evidence supports the theme: told to the candidate, never claimed. */
  readonly gap: boolean;
}

export interface ApplicationPlanCutView {
  readonly action: (typeof applicationPlanCutActions)[number];
  readonly target: string;
  readonly reason: string;
}

export interface RunApplicationPlanView {
  /** The central themes, most important first. */
  readonly themes: readonly ApplicationPlanThemeView[];
  readonly summaryAngle: string;
  readonly coreAreas: readonly string[];
  readonly cuts: readonly ApplicationPlanCutView[];
  /** Whether the critic accepted the plan, the author revised it once, or no review is in yet. */
  readonly review: ApplicationPlanReviewState;
  /** The critic's review points, when it asked for changes. */
  readonly reviewPoints: readonly string[];
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const runApplicationPlanKeys = exactKeys<RunApplicationPlanView>()([
  "themes",
  "summaryAngle",
  "coreAreas",
  "cuts",
  "review",
  "reviewPoints",
]);
export const applicationPlanThemeKeys = exactKeys<ApplicationPlanThemeView>()([
  "title",
  "rationale",
  "requirements",
  "proofCount",
  "gap",
]);
export const applicationPlanCutKeys = exactKeys<ApplicationPlanCutView>()([
  "action",
  "target",
  "reason",
]);

const maximumThemes = 5;
const maximumItems = 10;
const maximumText = 2_000;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).every((key) => keys.includes(key)) ? raw : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumText
    ? value
    : undefined;
}

function texts(value: unknown, limit = maximumItems): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const items = value.map(text);
  return items.every((item): item is string => item !== undefined) ? items : undefined;
}

function themeView(value: unknown): ApplicationPlanThemeView | undefined {
  const raw = record(value, applicationPlanThemeKeys);
  if (raw === undefined) return undefined;
  const title = text(raw.title);
  const rationale = text(raw.rationale);
  const requirements = texts(raw.requirements);
  const proofCount = raw.proofCount;
  if (
    title === undefined ||
    rationale === undefined ||
    requirements === undefined ||
    typeof proofCount !== "number" ||
    !Number.isInteger(proofCount) ||
    proofCount < 0 ||
    proofCount > 100 ||
    typeof raw.gap !== "boolean"
  ) {
    return undefined;
  }
  return { title, rationale, requirements, proofCount, gap: raw.gap };
}

function cutView(value: unknown): ApplicationPlanCutView | undefined {
  const raw = record(value, applicationPlanCutKeys);
  if (raw === undefined) return undefined;
  const target = text(raw.target);
  const reason = text(raw.reason);
  const action = (applicationPlanCutActions as readonly unknown[]).includes(raw.action)
    ? (raw.action as ApplicationPlanCutView["action"])
    : undefined;
  return action === undefined || target === undefined || reason === undefined
    ? undefined
    : { action, target, reason };
}

/** The view with only its known fields, or `undefined` when the value does not have its shape. */
export function normalizeRunApplicationPlan(value: unknown): RunApplicationPlanView | undefined {
  const raw = record(value, runApplicationPlanKeys);
  if (raw === undefined || !Array.isArray(raw.themes) || !Array.isArray(raw.cuts)) return undefined;
  if (raw.themes.length > maximumThemes || raw.cuts.length > maximumItems) return undefined;
  const themes = raw.themes.map(themeView);
  const cuts = raw.cuts.map(cutView);
  const summaryAngle = text(raw.summaryAngle);
  const coreAreas = texts(raw.coreAreas);
  const reviewPoints = texts(raw.reviewPoints);
  const review = (applicationPlanReviewStates as readonly unknown[]).includes(raw.review)
    ? (raw.review as ApplicationPlanReviewState)
    : undefined;
  if (
    !themes.every((theme): theme is ApplicationPlanThemeView => theme !== undefined) ||
    !cuts.every((cut): cut is ApplicationPlanCutView => cut !== undefined) ||
    summaryAngle === undefined ||
    coreAreas === undefined ||
    reviewPoints === undefined ||
    review === undefined
  ) {
    return undefined;
  }
  return { themes, summaryAngle, coreAreas, cuts, review, reviewPoints };
}

/** What the application layer records of a run's plan, as the host reads it. */
export interface RecordedApplicationPlan {
  readonly plan: {
    readonly themes: readonly {
      readonly title: string;
      readonly rationale: string;
      readonly requirementIds: readonly string[];
      readonly evidenceChunkIds: readonly string[];
      readonly gap: boolean;
    }[];
    readonly leads: {
      readonly summaryAngle: string;
      readonly coreAreas: readonly { readonly text: string }[];
    };
    readonly cuts: readonly ApplicationPlanCutView[];
  };
  readonly review: {
    readonly verdict: "accept" | "revise";
    readonly points: readonly { readonly text: string }[];
  } | null;
  readonly revised: boolean;
}

/** The ids of the requirements a recorded plan answers, so the host can resolve their text. */
export function applicationPlanRequirementIds(plan: RecordedApplicationPlan): readonly string[] {
  return [...new Set(plan.plan.themes.flatMap(({ requirementIds }) => requirementIds))];
}

/** The view the host sends: requirement ids resolved to text (the id when unknown). */
export function runApplicationPlanView(
  recorded: RecordedApplicationPlan,
  requirementTexts: ReadonlyMap<string, string>,
): RunApplicationPlanView | undefined {
  const { plan, review } = recorded;
  return normalizeRunApplicationPlan({
    themes: plan.themes.map((theme) => ({
      title: theme.title,
      rationale: theme.rationale,
      requirements: [
        ...new Set(
          theme.requirementIds.map((id) => (requirementTexts.get(id) ?? id).slice(0, maximumText)),
        ),
      ].slice(0, maximumItems),
      proofCount: theme.evidenceChunkIds.length,
      gap: theme.gap,
    })),
    summaryAngle: plan.leads.summaryAngle,
    coreAreas: plan.leads.coreAreas.map(({ text: item }) => item),
    cuts: plan.cuts.map(({ action, target, reason }) => ({ action, target, reason })),
    review: review === null ? "pending" : review.verdict === "accept" ? "accepted" : "revised",
    reviewPoints: review?.verdict === "revise" ? review.points.map(({ text: item }) => item) : [],
  });
}

/** The review state with the run's application plan, when it made one. */
export function withRunApplicationPlan<State extends object>(
  state: State,
  applicationPlan: RunApplicationPlanView | null,
): State {
  return applicationPlan === null ? state : { ...state, applicationPlan };
}

/** What Run details shows: the supported themes, the lead, the cuts, and the gaps. */
export interface RunApplicationPlanDisplay {
  readonly themes: readonly ApplicationPlanThemeView[];
  readonly gaps: readonly ApplicationPlanThemeView[];
  readonly summaryAngle: string;
  readonly coreAreas: readonly string[];
  readonly cuts: readonly ApplicationPlanCutView[];
  readonly reviewNote: string;
  readonly reviewPoints: readonly string[];
}

const reviewNotes: Readonly<Record<ApplicationPlanReviewState, string>> = {
  accepted: "The critic accepted this plan before drafting.",
  revised: "The critic asked for changes and the author revised the plan once.",
  pending: "The critic had not reviewed this plan when the run stopped.",
};

/** `undefined` hides the section. */
export function runApplicationPlanDisplay(
  plan: RunApplicationPlanView | null | undefined,
): RunApplicationPlanDisplay | undefined {
  if (plan === undefined || plan === null) return undefined;
  return {
    themes: plan.themes.filter(({ gap }) => !gap),
    gaps: plan.themes.filter(({ gap }) => gap),
    summaryAngle: plan.summaryAngle,
    coreAreas: plan.coreAreas,
    cuts: plan.cuts,
    reviewNote: reviewNotes[plan.review],
    reviewPoints: plan.reviewPoints,
  };
}
