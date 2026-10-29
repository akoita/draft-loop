import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { formatLimitDuration } from "./execution-limits.js";
import { HostStartDialog } from "./host-panels.js";
import { localWriterWarningFor } from "./local-writer-warning.js";
import type { CandidateProfileSelection, DesktopReviewState, ReviewAction } from "./model.js";
import {
  modelProfileEntryForReference,
  modelProfilePresets,
  withModelProfileLevels,
} from "./model-profile-picker-state.js";
import { effortDisplayName, presetDisplayName } from "./model-profile-presentation.js";
import type { ProviderRoute } from "./provider-routes.js";
import type { RunEvidenceModeView } from "./run-evidence-mode.js";
import type { StartEvidencePreview } from "./start-evidence-preview.js";
import {
  type ReviewedRequirementsSelection,
  reviewedRequirementsCounts,
} from "./start-requirements-model.js";

/** The action a confirmed Start dispatches, unchanged from what the trigger would have sent. */
export type StartReviewAction = Extract<ReviewAction, { readonly type: "start" }>;

export interface StartConfirmationModel {
  readonly role: "Author" | "Critic";
  readonly company: string;
  readonly model: string;
  /** The model profile tier, when the applied profile's id names one and no preset covers the pair. */
  readonly tier: string | null;
  /** How the call is reached and billed, or `null` when the host did not say. */
  readonly route: string | null;
  /** The reasoning level the run will use, such as "High reasoning", or `null` when unknown. */
  readonly reasoning: string | null;
}

export interface StartConfirmationLine {
  readonly label: string;
  readonly value: string;
}

export interface StartConfirmationSummary {
  /** The preset the applied pair matches, named once instead of a tier per model. */
  readonly preset: string | null;
  readonly models: readonly [StartConfirmationModel, StartConfirmationModel];
  readonly sameCompanyWarning: string | null;
  /** Said when a local model writes, which no local model has passed the quality check for. */
  readonly localWriterWarning: string | null;
  readonly inputs: readonly StartConfirmationLine[];
  readonly settings: readonly StartConfirmationLine[];
  readonly changedPairNote: string | null;
}

export interface StartConfirmationContext {
  readonly action: StartReviewAction;
  /** The reviewed brief the run would bind, when the screen has resolved it. */
  readonly reviewedRequirements?: ReviewedRequirementsSelection | null;
  /** The pinned career profile; `undefined` when the screen does not know, `null` for none. */
  readonly candidateProfile?: StartCandidateProfile | null;
  /** The model profiles the run applies; their ids name the tier. */
  readonly modelProfiles?: StartModelProfiles;
  /** What evidence the run would send; absent or `null` omits the line. */
  readonly evidencePreview?: StartEvidencePreview | null;
}

export type StartCandidateProfile = Pick<CandidateProfileSelection, "version">;

export interface StartModelProfile {
  readonly id: string;
  readonly version?: number;
  /** A chosen reasoning level; absent uses the profile's own. */
  readonly effort?: string | undefined;
}

export interface StartModelProfiles {
  readonly author?: StartModelProfile;
  readonly critic?: StartModelProfile;
}

function sameProfile(
  applied: StartModelProfile | undefined,
  preset: { readonly id: string; readonly version: number },
): boolean {
  return applied?.id === preset.id && applied.version === preset.version;
}

/** The display name of the preset whose two profiles the run applies, or `null` for any other pair. */
export function startModelPreset(profiles: StartModelProfiles | undefined): string | null {
  const preset = modelProfilePresets.find(
    (candidate) =>
      sameProfile(profiles?.author, candidate.author) &&
      sameProfile(profiles?.critic, candidate.critic),
  );
  return preset === undefined ? null : presetDisplayName(preset.label);
}

const tierPrefixes: readonly (readonly [string, string])[] = [
  ["economy-", "Economy"],
  ["balanced-", "Balanced"],
  ["standard-", "Standard"],
  ["premium-", "Premium"],
  ["dev-", "Development"],
];

/** The tier a model profile id names by its prefix, or `null` when the id names none. */
export function modelProfileTier(profileId: string | undefined): string | null {
  if (profileId === undefined) return null;
  return tierPrefixes.find(([prefix]) => profileId.startsWith(prefix))?.[1] ?? null;
}

const companyNames: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

function companyName(company: string): string {
  return companyNames[company.trim().toLowerCase()] ?? company;
}

const sessionRouteLabels: Readonly<Record<"anthropic" | "openai", string>> = {
  anthropic: "Claude session",
  openai: "ChatGPT session",
};

export const apiKeyRouteLabel = "API key, billed per token";
export const demoRouteLabel = "Demo, no provider call";

function routeOf(state: DesktopReviewState, company: string): ProviderRoute | null {
  const provider = company.trim().toLowerCase();
  if (state.providerRoutes === undefined) return null;
  if (provider !== "anthropic" && provider !== "openai") return null;
  return state.providerRoutes[provider];
}

function routeLabel(state: DesktopReviewState, company: string): string | null {
  if (state.setup.fixtureMode) return demoRouteLabel;
  const route = routeOf(state, company);
  if (route === null) return null;
  if (route === "api-key") return apiKeyRouteLabel;
  const provider = company.trim().toLowerCase() as "anthropic" | "openai";
  return sessionRouteLabels[provider];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The requirements line when the person chose the raw job description explicitly. */
export const chosenRawJobDescriptionValue =
  "Raw job description, chosen under Advanced (coverage scoring is less reliable)";
/** The requirements line when the application has no brief, so the run reads the job text. */
export const jobTextRequirementsValue = "Read from the job text (no requirements brief)";

function requirementsValue(state: DesktopReviewState, context: StartConfirmationContext): string {
  if (context.action.requirementsSource === "job-description") return chosenRawJobDescriptionValue;
  const reviewed = context.reviewedRequirements;
  if (reviewed !== null && reviewed !== undefined) {
    return `Reviewed brief v${reviewed.version} · ${reviewedRequirementsCounts(reviewed)}`;
  }
  const selected = state.setup.reviewedOpportunity;
  if (selected !== null && selected !== undefined) return `Reviewed brief v${selected.version}`;
  return jobTextRequirementsValue;
}

/** The evidence line: the mode the run would use and how much of the source that is. */
export function evidencePreviewValue(preview: StartEvidencePreview): string {
  if (preview.status === "checking") return "Checking…";
  const { requestedMode, effectiveMode, chunkCount, sourceCount, fallbackReason } = preview.preview;
  if (requestedMode === "retrieval") return "Retrieval";
  if (effectiveMode === "full-source") {
    const from = sourceCount === undefined ? "" : ` from ${plural(sourceCount, "source")}`;
    return `Full source · ${plural(chunkCount, "chunk")}${from} (fits)`;
  }
  if (fallbackReason === "no-eligible-chunks") {
    return "Full source has no eligible chunks; retrieval will be used";
  }
  return `Full source does not fit the budget for this pair (${plural(chunkCount, "chunk")}); retrieval will be used`;
}

/**
 * Asks for the evidence preview each time the confirmation opens: "checking" until it answers,
 * then the answer, or nothing when there is none or the request fails. Only opening asks again,
 * so a caller may pass a new function on every render.
 */
export function useStartEvidencePreview(
  open: boolean,
  preview: (() => Promise<RunEvidenceModeView | null>) | undefined,
): StartEvidencePreview | null {
  const [current, setCurrent] = useState<StartEvidencePreview | null>(null);
  const latest = useRef(preview);
  // Declared first, so it runs before the request below in the same commit.
  useEffect(() => {
    latest.current = preview;
  });
  useEffect(
    () => requestStartEvidencePreview(open ? latest.current : undefined, setCurrent),
    [open],
  );
  return current;
}

/**
 * One request for the preview: `checking` at once, then the answer, or `null` when there is no
 * request, no preview or a failure. The returned function drops a late answer.
 */
export function requestStartEvidencePreview(
  ask: (() => Promise<RunEvidenceModeView | null>) | undefined,
  set: (preview: StartEvidencePreview | null) => void,
): () => void {
  if (ask === undefined) {
    set(null);
    return () => undefined;
  }
  let active = true;
  set({ status: "checking" });
  ask().then(
    (result) => {
      if (active) set(result === null ? null : { status: "ready", preview: result });
    },
    () => {
      if (active) set(null);
    },
  );
  return () => {
    active = false;
  };
}

function writingPolicyValue(state: DesktopReviewState): string {
  if (state.setup.writingPolicyStatus === "unavailable") return "Unavailable";
  if (state.setup.writingPolicyStatus === "active") {
    return state.setup.writingPolicy === null
      ? "Active"
      : `Active, ${state.setup.writingPolicy.version}`;
  }
  return "None";
}

function callLimitValue(state: DesktopReviewState): string | null {
  const routes = state.providerRoutes;
  if (state.setup.fixtureMode || routes === undefined) return null;
  const author = routeOf(state, state.providerTransmissionPreflight.author.company);
  const critic = routeOf(state, state.providerTransmissionPreflight.critic.company);
  const limit = `${formatLimitDuration(routes.sessionCallLimitMs)} per call`;
  if (author === "user-session" && critic === "user-session") return limit;
  if (author === "user-session") return `${limit} for the author`;
  if (critic === "user-session") return `${limit} for the critic`;
  return null;
}

function changedPairNote(state: DesktopReviewState): string | null {
  const latest = state.applicationRuns?.find((row) => row.latest) ?? state.applicationRuns?.[0];
  if (latest === undefined || latest.authorModel === "" || latest.criticModel === "") return null;
  const { author, critic } = state.providerTransmissionPreflight;
  if (latest.authorModel === author.model && latest.criticModel === critic.model) return null;
  return `The last run on this application used ${latest.authorModel} → ${latest.criticModel}.`;
}

/**
 * The level a role will run at: the chosen one, else its profile's own, as "High reasoning" or
 * "Low reasoning (default)"; `null` without a known profile.
 */
export function startReasoningLevel(
  profile: StartModelProfile | undefined,
  role: "author" | "critic",
): string | null {
  if (profile === undefined) return null;
  if (profile.effort !== undefined) return `${effortDisplayName(profile.effort)} reasoning`;
  if (profile.version === undefined) return null;
  const own = modelProfileEntryForReference({ id: profile.id, version: profile.version }, role)
    ?.profile.runtime.effort;
  return own === undefined ? null : `${effortDisplayName(own)} reasoning (default)`;
}

/** Everything the start confirmation shows, worked out from the review state alone. */
export function startConfirmationSummary(
  state: DesktopReviewState,
  context: StartConfirmationContext,
): StartConfirmationSummary {
  const { author, critic } = state.providerTransmissionPreflight;
  const presetName = startModelPreset(context.modelProfiles);
  const preset =
    presetName === null || context.modelProfiles === undefined
      ? presetName
      : withModelProfileLevels(presetName, {
          author: context.modelProfiles.author ?? {},
          critic: context.modelProfiles.critic ?? {},
        });
  const model = (
    role: "Author" | "Critic",
    identity: { readonly company: string; readonly model: string },
  ): StartConfirmationModel => ({
    role,
    company: companyName(identity.company),
    model: identity.model,
    tier:
      preset === null
        ? modelProfileTier(
            (role === "Author" ? context.modelProfiles?.author : context.modelProfiles?.critic)?.id,
          )
        : null,
    route: routeLabel(state, identity.company),
    reasoning: startReasoningLevel(
      role === "Author" ? context.modelProfiles?.author : context.modelProfiles?.critic,
      role === "Author" ? "author" : "critic",
    ),
  });
  const sameCompany = author.company.trim().toLowerCase() === critic.company.trim().toLowerCase();
  const inputs: StartConfirmationLine[] = [
    { label: "Requirements", value: requirementsValue(state, context) },
  ];
  if (context.candidateProfile !== undefined) {
    inputs.push({
      label: "Career profile",
      value:
        context.candidateProfile === null ? "None pinned" : `v${context.candidateProfile.version}`,
    });
  }
  inputs.push({ label: "Writing policy", value: writingPolicyValue(state) });
  if (context.evidencePreview !== undefined && context.evidencePreview !== null) {
    inputs.push({ label: "Evidence", value: evidencePreviewValue(context.evidencePreview) });
  }
  const settings: StartConfirmationLine[] = [];
  if (state.setup.autopilot !== undefined) {
    settings.push({ label: "Autopilot", value: state.setup.autopilot ? "On" : "Off" });
  }
  settings.push({
    label: "Round limit",
    value: plural(state.providerTransmissionPreflight.budget.maxRounds, "round"),
  });
  const callLimit = callLimitValue(state);
  if (callLimit !== null) settings.push({ label: "Call limit", value: callLimit });
  return {
    preset,
    models: [model("Author", author), model("Critic", critic)],
    sameCompanyWarning: sameCompany
      ? `Author and critic are both from ${companyName(author.company)}, so the critique is not a cross-company check.`
      : null,
    localWriterWarning: localWriterWarningFor(author.company),
    inputs,
    settings,
    changedPairNote: changedPairNote(state),
  };
}

/** The Length choice (#1366): keep the writing policy's target, or write to one page or two. */
export type StartLengthChoice = "policy" | "one-page" | "two-page";

export const startLengthLabels: Readonly<Record<StartLengthChoice, string>> = {
  policy: "Writing policy",
  "one-page": "One page",
  "two-page": "Two pages",
};

/**
 * What the dialog's buttons do: Start closes it and sends the trigger's own action, the same
 * object it would have sent before the check existed, plus a page target when one was chosen;
 * Cancel only closes it.
 */
export function startConfirmationHandlers(
  action: StartReviewAction,
  dispatch: (action: StartReviewAction) => void,
  close: () => void,
): {
  readonly onStart: (length?: StartLengthChoice) => void;
  readonly onCancel: () => void;
} {
  return {
    onStart: (length = "policy") => {
      close();
      dispatch(length === "policy" ? action : { ...action, pageTarget: length });
    },
    onCancel: close,
  };
}

export interface StartConfirmationProps {
  readonly summary: StartConfirmationSummary;
  readonly dialogRef: RefObject<HTMLDivElement | null>;
  readonly onStart: (length: StartLengthChoice) => void;
  readonly onCancel: () => void;
  /** The screen's existing "Change models" control, when it offers one. */
  readonly changeModelsAction?: ReactNode;
  /** The application the run belongs to, passed to the host's panel in the dialog. */
  readonly applicationId?: string | null;
}

function Lines({ lines }: { readonly lines: readonly StartConfirmationLine[] }) {
  return (
    <dl className="start-confirmation-lines">
      {lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface StartActionsProps {
  /** Why Start waits, from the host's panel; `null` lets it start. */
  readonly blockedReason: string | null;
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly changeModelsAction?: ReactNode;
}

/** Start, the screen's Change models control and Cancel; Start waits while the host blocks it. */
export function StartActions({
  blockedReason,
  onStart,
  onCancel,
  changeModelsAction,
}: StartActionsProps) {
  return (
    <div className="start-confirmation-actions">
      <button
        className="button button-primary"
        type="button"
        disabled={blockedReason !== null}
        aria-describedby={blockedReason === null ? undefined : "start-confirmation-blocked"}
        onClick={onStart}
      >
        Start
      </button>
      {blockedReason === null ? null : (
        <p className="start-confirmation-note" id="start-confirmation-blocked" role="status">
          {blockedReason}
        </p>
      )}
      {changeModelsAction === undefined || changeModelsAction === null ? null : (
        // The screen's own control opens the models dialog; this one closes first.
        <span className="start-confirmation-change-models" onClickCapture={onCancel}>
          {changeModelsAction}
        </span>
      )}
      <button className="button button-quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * The check a person makes before a run begins its provider calls. Start sends the trigger's own
 * action; Cancel sends nothing. Start comes first so it takes the focus, and Enter confirms.
 */
export function StartConfirmation({
  summary,
  dialogRef,
  onStart,
  onCancel,
  changeModelsAction,
  applicationId = null,
}: StartConfirmationProps) {
  const [length, setLength] = useState<StartLengthChoice>("policy");
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card start-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-confirmation-title"
        aria-describedby="start-confirmation-copy"
        ref={dialogRef}
      >
        <h2 id="start-confirmation-title">Start this review?</h2>
        <p className="modal-copy" id="start-confirmation-copy">
          Check what the run will use. No provider call is made until you start.
        </p>
        <section aria-labelledby="start-confirmation-models">
          <h3 id="start-confirmation-models">Models</h3>
          <dl className="start-confirmation-lines">
            {summary.preset === null ? null : (
              <div>
                <dt>Preset</dt>
                <dd>{summary.preset}</dd>
              </div>
            )}
            {summary.models.map((model) => (
              <div key={model.role}>
                <dt>{model.role}</dt>
                <dd>
                  {[model.company, model.model, model.tier, model.reasoning, model.route]
                    .filter((part): part is string => part !== null)
                    .join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
          {summary.localWriterWarning === null ? null : (
            <p className="start-confirmation-warning" role="note">
              {summary.localWriterWarning}
            </p>
          )}
          {summary.sameCompanyWarning === null ? null : (
            <p className="start-confirmation-warning" role="note">
              {summary.sameCompanyWarning}
            </p>
          )}
          {summary.changedPairNote === null ? null : (
            <p className="start-confirmation-note">{summary.changedPairNote}</p>
          )}
        </section>
        <section aria-labelledby="start-confirmation-inputs">
          <h3 id="start-confirmation-inputs">Inputs</h3>
          <Lines lines={summary.inputs} />
        </section>
        <section aria-labelledby="start-confirmation-settings">
          <h3 id="start-confirmation-settings">Run settings</h3>
          <Lines lines={summary.settings} />
          <fieldset className="start-confirmation-length">
            <legend>Length</legend>
            {(Object.keys(startLengthLabels) as StartLengthChoice[]).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="start-confirmation-length"
                  value={choice}
                  checked={length === choice}
                  onChange={() => setLength(choice)}
                />
                {startLengthLabels[choice]}
              </label>
            ))}
            <p className="start-confirmation-note">
              One page or two is saved as your writing policy's page target, and the draft is
              written to it.
            </p>
          </fieldset>
        </section>
        <HostStartDialog applicationId={applicationId} setBlockedReason={setBlockedReason} />
        <StartActions
          blockedReason={blockedReason}
          onStart={() => onStart(length)}
          onCancel={onCancel}
          changeModelsAction={changeModelsAction}
        />
      </div>
    </div>
  );
}
