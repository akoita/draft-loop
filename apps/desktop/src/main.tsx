import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  type ModelCompany,
  type ModelsPreviewIndependenceResult,
  modelCompanies,
} from "./bridge.js";
import type { DesktopReviewState, FindingDecision, ReviewAction } from "./model.js";
import {
  createDesktopReviewPort,
  DesktopBridgeError,
  type DesktopSetupPort,
  type WorkspaceModelSelection,
} from "./native.js";
import { BrandMark, ReviewWorkspace } from "./review.js";
import { createReviewActionDispatcher, type PendingReviewAction } from "./review-dispatch.js";
import "./styles.css";

const runRefreshIntervalMs = 750;

type DirectFindingDecision = Exclude<FindingDecision, "pending" | "overridden">;

export async function dispatchFindingDecisions(
  state: DesktopReviewState,
  findingIds: readonly string[],
  decision: DirectFindingDecision,
  dispatch: (state: DesktopReviewState, action: ReviewAction) => Promise<DesktopReviewState>,
  onProgress: (state: DesktopReviewState) => void = () => undefined,
): Promise<DesktopReviewState> {
  let next = state;
  for (const findingId of findingIds) {
    next = await dispatch(next, { type: "finding-decision", findingId, decision });
    onProgress(next);
  }
  return next;
}

/**
 * How long a typed model id settles before the pairing is asked about.
 *
 * The preview is a local derivation rather than a provider call, so this is
 * about not asking a question of a half-typed id, not about cost.
 */
const independencePreviewDebounceMs = 250;

/** The workspace-setup form's fields, as a person leaves them. */
export interface WorkspaceSetupDraft {
  readonly name: string;
  readonly authorCompany: ModelCompany;
  readonly authorModel: string;
  readonly criticCompany: ModelCompany;
  readonly criticModel: string;
  readonly localEndpoint: string;
  readonly independenceOverrideRationale: string;
  readonly maxRounds: number;
}

export const initialWorkspaceSetupDraft: WorkspaceSetupDraft = Object.freeze({
  name: "draft-loop-workspace",
  authorCompany: "anthropic",
  authorModel: "",
  criticCompany: "openai",
  criticModel: "",
  localEndpoint: "",
  independenceOverrideRationale: "",
  maxRounds: 3,
});

/** What `models.list` has said about one company so far. */
export type ModelDiscoveryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly models: readonly string[];
      readonly source: "live" | "cache";
      readonly truncated: boolean;
    }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * What `models.preview-independence` has said about the current pairing.
 *
 * The result is carried whole rather than reduced to a boolean here. Nothing
 * in this module decides whether two models are independent: that rule lives
 * in the domain, and a renderer that recomputed it would go on showing the old
 * answer after the rule moved, which is the defect ADR 0005 was written after.
 */
export type IndependencePreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly result: ModelsPreviewIndependenceResult }
  | { readonly status: "unavailable"; readonly reason: string };

export type ModelSide = "author" | "critic";

const modelCompanyLabels: Readonly<Record<ModelCompany, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local model server",
};

const modelSideLabels: Readonly<Record<ModelSide, string>> = {
  author: "Author",
  critic: "Critic",
};

/** The option value that turns a discovered list back into a free-text field. */
export const otherModelOptionValue = "__other__";

function isModelCompany(value: string): value is ModelCompany {
  return (modelCompanies as readonly string[]).includes(value);
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() !== "" ? reason.message : fallback;
}

/** Whether a `local` company on either side means an endpoint field is in play. */
export function requiresLocalEndpoint(draft: WorkspaceSetupDraft): boolean {
  return draft.authorCompany === "local" || draft.criticCompany === "local";
}

/**
 * Whether the model id is chosen from a list or typed.
 *
 * Discovery is best effort, so every path that does not end in a usable list
 * lands on free text: an unreachable provider, a provider with nothing to say,
 * a host with no discovery at all, a local server this workspace has not
 * created yet, and a person who wants a model the list does not carry.
 */
export function modelInputMode(
  company: ModelCompany,
  discovery: ModelDiscoveryState,
  localEndpointNamed: boolean,
  typingOwnModel: boolean,
): "list" | "text" {
  if (typingOwnModel) return "text";
  if (company === "local" && localEndpointNamed) return "text";
  return discovery.status === "ready" && discovery.models.length > 0 ? "list" : "text";
}

/**
 * The line under a model field explaining where its options came from, or why
 * there are none. A free-text fallback with no explanation reads as a defect.
 */
export function modelDiscoveryNote(
  company: ModelCompany,
  discovery: ModelDiscoveryState,
  localEndpointNamed: boolean,
): string {
  if (company === "local" && localEndpointNamed) {
    return "Model discovery can only ask the default local server until this workspace exists, and you named a different address. Type the model id your server serves.";
  }
  switch (discovery.status) {
    case "idle":
      return "";
    case "loading":
      return `Asking ${modelCompanyLabels[company]} which models are available…`;
    case "unavailable":
      return `Models could not be listed. ${discovery.reason} Type the model id instead; this does not stop the workspace being created.`;
    case "ready":
      if (discovery.models.length === 0) {
        return `${modelCompanyLabels[company]} listed no models. Type the model id instead; this does not stop the workspace being created.`;
      }
      return `${discovery.models.length} model${discovery.models.length === 1 ? "" : "s"} listed ${
        discovery.source === "cache" ? "from a recent lookup" : "by the provider"
      }${discovery.truncated ? ", and the provider had more" : ""}. Choose “Other model…” to type one that is not listed.`;
  }
}

/**
 * A side's filter text, remembered against the company it was typed for.
 *
 * The company is carried with the text rather than beside it so that changing
 * company cannot leave a stale filter behind: a filter typed for one provider
 * says nothing about the next provider's list, and a reset that has to be
 * remembered at every call site is a reset that will eventually be forgotten.
 */
export interface ModelFilterState {
  readonly company: ModelCompany;
  readonly text: string;
}

/** The filter as it applies to the company now selected; blank if it was another's. */
export function modelFilterText(filter: ModelFilterState, company: ModelCompany): string {
  return filter.company === company ? filter.text : "";
}

/** Which of a company's models a filter leaves in the select, and what to say. */
export interface ModelFilterResult {
  /** The options to render, in the provider's own order. */
  readonly options: readonly string[];
  /** How many ids the filter actually matched. */
  readonly matched: number;
  /** Whether the current selection had to be retained beyond the matching ids. */
  readonly keptSelected: boolean;
  /** The line under the filter field, or "" when nothing is being filtered. */
  readonly note: string;
}

/**
 * Narrow a discovered list by a typed fragment of a model id.
 *
 * Two rules make this safe to do to a control someone has already used. The
 * current selection is always listed, matching or not, because a select that
 * quietly drops the chosen option reads as the choice having been lost rather
 * than as the list having been narrowed. And no match is a sentence rather
 * than an empty box: a list with nothing in it gives a person nothing to do.
 *
 * This is presentation only. It decides what the select shows, never what the
 * draft holds, so what is submitted is what was chosen either way.
 */
export function filterModelOptions(
  models: readonly string[],
  filter: string,
  selected: string,
): ModelFilterResult {
  const wanted = filter.trim();
  if (wanted === "") {
    const keptSelected = selected !== "" && !models.includes(selected);
    return {
      options: keptSelected ? [...models, selected] : models,
      matched: models.length,
      keptSelected,
      note: "",
    };
  }
  const needle = wanted.toLowerCase();
  const matched = new Set(models.filter((model) => model.toLowerCase().includes(needle)));
  const keptSelected = selected !== "" && !matched.has(selected);
  const providerOptions = models.filter(
    (model) => matched.has(model) || (keptSelected && model === selected),
  );
  const options =
    keptSelected && !models.includes(selected) ? [...providerOptions, selected] : providerOptions;
  const total = `${models.length} model${models.length === 1 ? "" : "s"}`;
  const wayOut = `Clear the filter to see all ${total}, or choose “Other model…” to type an id.`;
  if (matched.size === 0) {
    return {
      options,
      matched: 0,
      keptSelected,
      note: keptSelected
        ? `No model id contains “${wanted}”, so only the model you chose is listed. ${wayOut}`
        : `No model id contains “${wanted}”. ${wayOut}`,
    };
  }
  const shown = `Showing ${matched.size} of ${total} matching “${wanted}”`;
  return {
    options,
    matched: matched.size,
    keptSelected,
    note: keptSelected ? `${shown}, and the model you chose.` : `${shown}.`,
  };
}

/** How the setup form presents what the pairing would record. */
export interface IndependencePreviewSummary {
  readonly tone: "independent" | "shared" | "unrecorded";
  readonly mark: string;
  readonly detail: string;
  readonly lineages: string | null;
}

/**
 * The verdict wording, in the words the trust strip and the CLI already use.
 *
 * A lineage is an operator label that nothing verifies, so the distinct case
 * says what was claimed and immediately says what the claim is worth, and no
 * branch reads as proof of independence.
 */
export function independencePreviewSummary(
  preview: IndependencePreviewState,
  independenceOverrideRationale: string,
): IndependencePreviewSummary {
  switch (preview.status) {
    case "idle":
      return {
        tone: "unrecorded",
        mark: "not checked",
        detail:
          "Name an author model and a critic model, and this will say whether the pairing counts as independent.",
        lineages: null,
      };
    case "loading":
      return {
        tone: "unrecorded",
        mark: "checking",
        detail: "Checking whether the author and critic lineages differ…",
        lineages: null,
      };
    case "unavailable":
      return {
        tone: "unrecorded",
        mark: "not checked",
        detail: `This pairing could not be checked. ${preview.reason} The workspace can still be created, and the run itself refuses a shared lineage unless a rationale is recorded.`,
        lineages: null,
      };
    case "ready": {
      const lineages = `Claimed lineages: author ${preview.result.authorLineage}; critic ${preview.result.criticLineage}`;
      if (preview.result.lineagesDistinct) {
        return {
          tone: "independent",
          mark: "lineages differ",
          detail:
            "Author and critic lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
          lineages,
        };
      }
      if (independenceOverrideRationale.trim() !== "") {
        return {
          tone: "shared",
          mark: "overridden",
          detail:
            "Author and critic would share one lineage, so this critique would not be independent; the workspace will record your rationale.",
          lineages,
        };
      }
      return {
        tone: "shared",
        mark: "not independent",
        detail:
          "Author and critic would share one lineage, so this critique would not be independent. Choose a different model on one side, or record why one lineage on both sides is acceptable.",
        lineages,
      };
    }
  }
}

/** Whether a shared lineage is holding creation back for want of a rationale. */
export function sharedLineageBlocksCreation(
  preview: IndependencePreviewState,
  independenceOverrideRationale: string,
): boolean {
  return (
    preview.status === "ready" &&
    !preview.result.lineagesDistinct &&
    independenceOverrideRationale.trim() === ""
  );
}

/** Why the create button is not available, or null when it is. */
export function workspaceSetupBlocker(
  draft: WorkspaceSetupDraft,
  preview: IndependencePreviewState,
): string | null {
  if (draft.name.trim() === "") return "Name the workspace before creating it.";
  if (!Number.isInteger(draft.maxRounds) || draft.maxRounds < 1 || draft.maxRounds > 20) {
    return "Choose a maximum round count between 1 and 20.";
  }
  if (draft.authorModel.trim() === "" || draft.criticModel.trim() === "") {
    return "Name an author model and a critic model before creating the workspace.";
  }
  if (sharedLineageBlocksCreation(preview, draft.independenceOverrideRationale)) {
    return "Record why one lineage on both sides is acceptable before creating the workspace.";
  }
  return null;
}

/** The draft as `workspace.create` input; blanks are left to the workspace. */
export function workspaceModelSelection(draft: WorkspaceSetupDraft): WorkspaceModelSelection {
  return {
    authorCompany: draft.authorCompany,
    authorModel: draft.authorModel,
    criticCompany: draft.criticCompany,
    criticModel: draft.criticModel,
    ...(requiresLocalEndpoint(draft) ? { localEndpoint: draft.localEndpoint } : {}),
    independenceOverrideRationale: draft.independenceOverrideRationale,
    maxRounds: draft.maxRounds,
  };
}

/**
 * A refused creation, said in terms of the field that can be corrected.
 *
 * The boundary refuses a non-loopback local endpoint before any directory is
 * created, and reports it as invalid input like any other refusal. Naming the
 * endpoint here turns a generic refusal back into something to fix; the rule
 * itself is not restated, because the boundary stays the authority on it.
 */
export function workspaceSetupFailureMessage(reason: unknown, draft: WorkspaceSetupDraft): string {
  const base = messageOf(reason, "The workspace could not be created.");
  const refusedInput = reason instanceof DesktopBridgeError && reason.code === "invalid-input";
  if (refusedInput && requiresLocalEndpoint(draft) && draft.localEndpoint.trim() !== "") {
    return `${base} Check the local model server address: it must be on this machine, such as http://127.0.0.1:11434/v1, and carry no username or password.`;
  }
  return base;
}

interface ModelSideFieldsProps {
  readonly side: ModelSide;
  readonly company: ModelCompany;
  readonly model: string;
  readonly discovery: ModelDiscoveryState;
  readonly localEndpointNamed: boolean;
  readonly typingOwnModel: boolean;
  readonly filter: string;
  readonly disabled: boolean;
  readonly onCompanyChange: (company: ModelCompany) => void;
  readonly onModelChange: (model: string) => void;
  readonly onFilterChange: (filter: string) => void;
  readonly onTypeOwnModel: () => void;
}

function ModelSideFields({
  side,
  company,
  model,
  discovery,
  localEndpointNamed,
  typingOwnModel,
  filter,
  disabled,
  onCompanyChange,
  onModelChange,
  onFilterChange,
  onTypeOwnModel,
}: ModelSideFieldsProps) {
  const label = modelSideLabels[side];
  const mode = modelInputMode(company, discovery, localEndpointNamed, typingOwnModel);
  const note = modelDiscoveryNote(company, discovery, localEndpointNamed);
  const listed = discovery.status === "ready" ? discovery.models : [];
  const filtered = filterModelOptions(listed, filter, model);
  const filterNoteId = `setup-model-filter-note-${side}`;
  return (
    <fieldset className="setup-side">
      <legend>{label} model</legend>
      <label className="setup-field">
        <span>Company</span>
        <select
          value={company}
          disabled={disabled}
          aria-label={`${label} company`}
          onChange={(event) => {
            if (isModelCompany(event.target.value)) onCompanyChange(event.target.value);
          }}
        >
          {modelCompanies.map((candidate) => (
            <option key={candidate} value={candidate}>
              {modelCompanyLabels[candidate]}
            </option>
          ))}
        </select>
      </label>
      {/* A hundred-odd ids is not a choice anyone can make from a list, so the
          filter narrows what the select carries. It is a plain text field
          above a native select on purpose: the platform keeps its own
          keyboard and screen-reader behaviour, which a hand-rolled combobox
          would have to reimplement. */}
      {mode === "list" ? (
        <>
          <label className="setup-field" htmlFor={`setup-model-filter-${side}`}>
            <span>Filter</span>
            <input
              id={`setup-model-filter-${side}`}
              type="text"
              value={filter}
              disabled={disabled}
              placeholder="part of a model id"
              aria-label={`Filter ${label} models`}
              aria-describedby={filterNoteId}
              onChange={(event) => onFilterChange(event.target.value)}
            />
          </label>
          <p
            id={filterNoteId}
            className={`setup-note setup-filter-note${
              filtered.matched === 0 ? " setup-filter-empty" : ""
            }`}
            role="status"
            aria-live="polite"
          >
            {filtered.note}
          </p>
        </>
      ) : null}
      {/* The model control changes shape with what discovery found, so the
          label points at it by id rather than by containment: the association
          has to survive a select becoming a text field. */}
      <label className="setup-field" htmlFor={`setup-model-${side}`}>
        <span>Model</span>
        {mode === "list" ? (
          <select
            id={`setup-model-${side}`}
            value={filtered.options.includes(model) ? model : ""}
            disabled={disabled}
            aria-label={`${label} model`}
            onChange={(event) => {
              if (event.target.value === otherModelOptionValue) onTypeOwnModel();
              else onModelChange(event.target.value);
            }}
          >
            <option value="">Choose a model…</option>
            {filtered.options.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
            <option value={otherModelOptionValue}>Other model…</option>
          </select>
        ) : (
          <input
            id={`setup-model-${side}`}
            type="text"
            value={model}
            disabled={disabled}
            placeholder="model id"
            aria-label={`${label} model`}
            onChange={(event) => onModelChange(event.target.value)}
          />
        )}
      </label>
      {note === "" ? null : <p className="setup-note">{note}</p>}
    </fieldset>
  );
}

interface WorkspaceSetupFormProps {
  readonly draft: WorkspaceSetupDraft;
  readonly discovery: Readonly<Record<ModelCompany, ModelDiscoveryState>>;
  readonly preview: IndependencePreviewState;
  readonly typingOwnModel: Readonly<Record<ModelSide, boolean>>;
  readonly modelFilters: Readonly<Record<ModelSide, ModelFilterState>>;
  readonly busy: boolean;
  readonly onDraftChange: (draft: WorkspaceSetupDraft) => void;
  readonly onModelFilterChange: (side: ModelSide, filter: ModelFilterState) => void;
  readonly onTypeOwnModel: (side: ModelSide) => void;
  readonly onCreate?: (() => void) | undefined;
  readonly onCreateDemo?: (() => void) | undefined;
  readonly onOpen?: (() => void) | undefined;
}

/**
 * Choosing the two models a workspace will run, before it exists.
 *
 * Presentational on purpose: every asynchronous answer it shows — the model
 * lists, the independence verdict — arrives as a prop from a host command, so
 * the form has nothing to work out and nothing to get out of date.
 */
export function WorkspaceSetupForm({
  draft,
  discovery,
  preview,
  typingOwnModel,
  modelFilters,
  busy,
  onDraftChange,
  onModelFilterChange,
  onTypeOwnModel,
  onCreate,
  onCreateDemo,
  onOpen,
}: WorkspaceSetupFormProps) {
  const localEndpointNamed = draft.localEndpoint.trim() !== "";
  const summary = independencePreviewSummary(preview, draft.independenceOverrideRationale);
  const blocked = sharedLineageBlocksCreation(preview, draft.independenceOverrideRationale);
  const blocker = workspaceSetupBlocker(draft, preview);
  return (
    <form
      className="setup-form"
      aria-label="workspace model selection"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocker === null && !busy) onCreate?.();
      }}
    >
      <label className="setup-field">
        <span>Workspace name</span>
        <input
          type="text"
          value={draft.name}
          disabled={busy}
          aria-label="Workspace name"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="setup-field setup-round-limit">
        <span>Maximum review rounds</span>
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={draft.maxRounds}
          disabled={busy}
          aria-label="Maximum review rounds"
          onChange={(event) =>
            onDraftChange({
              ...draft,
              maxRounds: event.target.value === "" ? 0 : Number(event.target.value),
            })
          }
        />
        <span className="setup-note">
          The author and critic stop after this many rounds and return the last fully reviewed draft
          to you. More rounds can improve convergence but use more time and provider budget.
        </span>
      </label>
      <div className="setup-sides">
        <ModelSideFields
          side="author"
          company={draft.authorCompany}
          model={draft.authorModel}
          discovery={discovery[draft.authorCompany]}
          localEndpointNamed={localEndpointNamed}
          typingOwnModel={typingOwnModel.author}
          filter={modelFilterText(modelFilters.author, draft.authorCompany)}
          disabled={busy}
          onCompanyChange={(authorCompany) => {
            onModelFilterChange("author", { company: authorCompany, text: "" });
            onDraftChange({ ...draft, authorCompany, authorModel: "" });
          }}
          onModelChange={(authorModel) => onDraftChange({ ...draft, authorModel })}
          onFilterChange={(text) =>
            onModelFilterChange("author", { company: draft.authorCompany, text })
          }
          onTypeOwnModel={() => onTypeOwnModel("author")}
        />
        <ModelSideFields
          side="critic"
          company={draft.criticCompany}
          model={draft.criticModel}
          discovery={discovery[draft.criticCompany]}
          localEndpointNamed={localEndpointNamed}
          typingOwnModel={typingOwnModel.critic}
          filter={modelFilterText(modelFilters.critic, draft.criticCompany)}
          disabled={busy}
          onCompanyChange={(criticCompany) => {
            onModelFilterChange("critic", { company: criticCompany, text: "" });
            onDraftChange({ ...draft, criticCompany, criticModel: "" });
          }}
          onModelChange={(criticModel) => onDraftChange({ ...draft, criticModel })}
          onFilterChange={(text) =>
            onModelFilterChange("critic", { company: draft.criticCompany, text })
          }
          onTypeOwnModel={() => onTypeOwnModel("critic")}
        />
      </div>
      {requiresLocalEndpoint(draft) ? (
        <label className="setup-field">
          <span>Local model server</span>
          <input
            type="url"
            value={draft.localEndpoint}
            disabled={busy}
            placeholder="http://127.0.0.1:11434/v1"
            aria-label="Local model server address"
            onChange={(event) => onDraftChange({ ...draft, localEndpoint: event.target.value })}
          />
          <span className="setup-note">
            A local model must be served from this machine, so only a loopback address is accepted,
            with no username or password. Leave this empty to use the workspace default.
          </span>
        </label>
      ) : null}
      <div
        className={`trust-badge trust-badge-${summary.tone} setup-independence`}
        role="status"
        aria-live="polite"
      >
        <span className="trust-badge-mark">{summary.mark}</span>
        <span>
          {summary.detail}
          {summary.lineages === null ? null : (
            <span className="setup-lineages">{summary.lineages}</span>
          )}
        </span>
      </div>
      {blocked || draft.independenceOverrideRationale !== "" ? (
        <label className="setup-field">
          <span>Why is one lineage on both sides acceptable? (required)</span>
          <textarea
            value={draft.independenceOverrideRationale}
            disabled={busy}
            aria-label="Independence override rationale"
            onChange={(event) =>
              onDraftChange({ ...draft, independenceOverrideRationale: event.target.value })
            }
          />
          <span className="setup-note">
            This is recorded with every run of the workspace and shown at the approval gate.
          </span>
        </label>
      ) : null}
      {blocker === null ? null : <p className="setup-note setup-blocker">{blocker}</p>}
      <div className="approval-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || onCreate === undefined || blocker !== null}
        >
          Create workspace
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={busy || onCreateDemo === undefined}
          onClick={() => onCreateDemo?.()}
        >
          Try demo workspace
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={busy || onOpen === undefined}
          onClick={() => onOpen?.()}
        >
          Open workspace
        </button>
      </div>
    </form>
  );
}

export function App({ port }: { readonly port?: DesktopSetupPort }) {
  const activePort = useMemo(() => port ?? createDesktopReviewPort(), [port]);
  const [state, setState] = useState<DesktopReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingReviewAction, setPendingReviewAction] = useState<PendingReviewAction | null>(null);
  const [pendingBulkFindingCount, setPendingBulkFindingCount] = useState<number | null>(null);
  const [reviewActionDispatcher] = useState(() =>
    createReviewActionDispatcher(setPendingReviewAction),
  );
  const [draft, setDraft] = useState<WorkspaceSetupDraft>(initialWorkspaceSetupDraft);
  const [typingOwnModel, setTypingOwnModel] = useState<Readonly<Record<ModelSide, boolean>>>({
    author: false,
    critic: false,
  });
  const [modelFilters, setModelFilters] = useState<Readonly<Record<ModelSide, ModelFilterState>>>({
    author: { company: initialWorkspaceSetupDraft.authorCompany, text: "" },
    critic: { company: initialWorkspaceSetupDraft.criticCompany, text: "" },
  });
  const [discovery, setDiscovery] = useState<Readonly<Record<ModelCompany, ModelDiscoveryState>>>({
    anthropic: { status: "idle" },
    openai: { status: "idle" },
    local: { status: "idle" },
  });
  const [preview, setPreview] = useState<IndependencePreviewState>({ status: "idle" });
  const requestedCompanies = useRef(new Set<ModelCompany>());
  const activeExecutionStatus = state?.execution.status;
  const nativeActions = useMemo(
    () => ({
      open: activePort.openWorkspace,
      create: activePort.createWorkspace,
      createDemo: activePort.createDemoWorkspace,
    }),
    [activePort],
  );

  useEffect(() => {
    let active = true;
    void activePort
      .load()
      .then((loaded) => {
        if (active) setState(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : "The review workspace could not load.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activePort]);

  useEffect(() => {
    if (activeExecutionStatus !== "running") return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const loaded = await activePort.load();
        if (active) {
          setState(loaded);
          setImportError(null);
        }
      } catch (reason: unknown) {
        if (active) {
          setImportError(
            reason instanceof Error ? reason.message : "Review progress could not be refreshed.",
          );
        }
      } finally {
        loading = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), runRefreshIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activePort, activeExecutionStatus]);

  const onAction = (action: ReviewAction) => {
    if (state === null) return;
    setImportError(null);
    reviewActionDispatcher.dispatch(action, async () => {
      try {
        setState(await activePort.dispatch(state, action));
      } catch (reason: unknown) {
        setImportError(
          reason instanceof Error ? reason.message : "The review action could not be completed.",
        );
      }
    });
  };

  const onBulkFindingDecision = (
    findingIds: readonly string[],
    decision: DirectFindingDecision,
  ) => {
    const firstFindingId = findingIds[0];
    if (state === null || firstFindingId === undefined) return;
    setImportError(null);
    setPendingBulkFindingCount(findingIds.length);
    const pendingAction: ReviewAction = {
      type: "finding-decision",
      findingId: firstFindingId,
      decision,
    };
    const started = reviewActionDispatcher.dispatch(pendingAction, async () => {
      try {
        await dispatchFindingDecisions(state, findingIds, decision, activePort.dispatch, setState);
      } catch (reason: unknown) {
        setImportError(
          reason instanceof Error
            ? reason.message
            : "The finding decisions could not be completed.",
        );
      } finally {
        setPendingBulkFindingCount(null);
      }
    });
    if (!started) setPendingBulkFindingCount(null);
  };

  useEffect(() => {
    if (pendingReviewAction === null) return;
    const interval = window.setInterval(reviewActionDispatcher.updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [pendingReviewAction, reviewActionDispatcher]);

  const setup = async (
    action: (() => Promise<DesktopReviewState>) | undefined,
    describeFailure: (reason: unknown) => string = (reason) =>
      messageOf(reason, "The workspace could not be opened."),
  ) => {
    if (action === undefined) return;
    setBusy(true);
    setError(null);
    setImportError(null);
    try {
      setState(await action());
    } catch (reason: unknown) {
      setError(describeFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  const setupVisible = error !== null;
  const listModels = activePort.listModels;
  const previewIndependence = activePort.previewIndependence;
  const localEndpointNamed = draft.localEndpoint.trim() !== "";
  const authorCompany = draft.authorCompany;
  const criticCompany = draft.criticCompany;
  const authorModel = draft.authorModel.trim();
  const criticModel = draft.criticModel.trim();

  /**
   * Ask each selected company for its models, once, and never block on it.
   *
   * Discovery is a convenience: a company whose list cannot be fetched falls
   * back to a typed model id and says why, and nothing here can stop a
   * workspace being created. `local` is skipped once an endpoint is named,
   * because the host can only ask the endpoint an open workspace configured
   * and this workspace does not exist yet.
   */
  useEffect(() => {
    if (!setupVisible) return;
    let active = true;
    for (const company of new Set<ModelCompany>([authorCompany, criticCompany])) {
      if (company === "local" && localEndpointNamed) continue;
      if (requestedCompanies.current.has(company)) continue;
      requestedCompanies.current.add(company);
      if (listModels === undefined) {
        setDiscovery((current) => ({
          ...current,
          [company]: {
            status: "unavailable",
            reason: "This host does not offer model discovery.",
          },
        }));
        continue;
      }
      setDiscovery((current) => ({ ...current, [company]: { status: "loading" } }));
      void listModels(company)
        .then((result) => {
          if (!active) return;
          setDiscovery((current) => ({
            ...current,
            [company]: {
              status: "ready",
              models: result.models.map((model) => model.id),
              source: result.source,
              truncated: result.truncated,
            },
          }));
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setDiscovery((current) => ({
            ...current,
            [company]: {
              status: "unavailable",
              reason: messageOf(reason, "The provider could not be reached."),
            },
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [setupVisible, listModels, authorCompany, criticCompany, localEndpointNamed]);

  /**
   * Ask the domain what this pairing would record, every time it changes.
   *
   * The verdict is never worked out here. A renderer that compared companies
   * or lineages itself would keep reporting the old rule after the rule moved,
   * which is exactly the defect the trust strip was corrected for.
   */
  useEffect(() => {
    if (!setupVisible) return;
    if (authorModel === "" || criticModel === "") {
      setPreview({ status: "idle" });
      return;
    }
    if (previewIndependence === undefined) {
      setPreview({
        status: "unavailable",
        reason: "This host cannot check a pairing before the workspace exists.",
      });
      return;
    }
    let active = true;
    setPreview({ status: "loading" });
    const timer = window.setTimeout(() => {
      void previewIndependence(
        { company: authorCompany, modelId: authorModel },
        { company: criticCompany, modelId: criticModel },
      )
        .then((result) => {
          if (active) setPreview({ status: "ready", result });
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setPreview({
            status: "unavailable",
            reason: messageOf(reason, "The independence check could not be completed."),
          });
        });
    }, independencePreviewDebounceMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [setupVisible, previewIndependence, authorCompany, authorModel, criticCompany, criticModel]);

  if (error !== null) {
    const openWorkspace = nativeActions.open;
    const createWorkspace = nativeActions.create;
    const createDemoWorkspace = nativeActions.createDemo;
    return (
      <main className="app-shell">
        <section className="panel boot-panel">
          <div className="boot-brand">
            <BrandMark />
            <span className="brand-name">DraftLoop</span>
          </div>
          <p className="eyebrow">First run</p>
          <h1>Set up a review workspace</h1>
          <p>{error}</p>
          {openWorkspace === undefined &&
          createWorkspace === undefined &&
          createDemoWorkspace === undefined ? null : (
            <WorkspaceSetupForm
              draft={draft}
              discovery={discovery}
              preview={preview}
              typingOwnModel={typingOwnModel}
              modelFilters={modelFilters}
              busy={busy}
              onDraftChange={setDraft}
              onModelFilterChange={(side, filter) =>
                setModelFilters((current) => ({
                  ...current,
                  [side]: filter,
                }))
              }
              onTypeOwnModel={(side) =>
                setTypingOwnModel((current) => ({ ...current, [side]: true }))
              }
              {...(createWorkspace === undefined
                ? {}
                : {
                    onCreate: () =>
                      void setup(
                        () => createWorkspace(draft.name.trim(), workspaceModelSelection(draft)),
                        (reason) => workspaceSetupFailureMessage(reason, draft),
                      ),
                  })}
              {...(createDemoWorkspace === undefined
                ? {}
                : { onCreateDemo: () => void setup(() => createDemoWorkspace("draft-loop-demo")) })}
              {...(openWorkspace === undefined ? {} : { onOpen: () => void setup(openWorkspace) })}
            />
          )}
        </section>
      </main>
    );
  }
  if (state === null) {
    return (
      <main className="app-shell">
        <section className="panel boot-panel">
          <div className="boot-brand">
            <BrandMark />
            <span className="brand-name">DraftLoop</span>
          </div>
          <p className="boot-loading" role="status" aria-live="polite">
            Loading local review workspace…
          </p>
        </section>
      </main>
    );
  }

  return (
    <ReviewWorkspace
      state={state}
      onAction={onAction}
      onBulkFindingDecision={onBulkFindingDecision}
      pendingBulkFindingCount={pendingBulkFindingCount}
      errorMessage={importError}
      pendingReviewAction={pendingReviewAction}
      {...(activePort.selectFiles === undefined
        ? {}
        : {
            onSelectFiles: (
              target: "evidence" | "job-description" | "writing-policy" | "writing-policy-override",
            ) => {
              setImportError(null);
              void activePort
                .selectFiles?.(target)
                .then(setState)
                .catch((reason: unknown) => {
                  setImportError(
                    reason instanceof Error ? reason.message : "The files could not be imported.",
                  );
                });
            },
          })}
      {...(activePort.addUrl === undefined
        ? {}
        : {
            onAddUrl: (target: "evidence" | "job-description", url: string) => {
              setImportError(null);
              void activePort
                .addUrl?.(target, url)
                .then(setState)
                .catch((reason: unknown) => {
                  setImportError(
                    reason instanceof Error ? reason.message : "The URL could not be imported.",
                  );
                });
            },
          })}
      {...(activePort.getCredentialStatus === undefined
        ? {}
        : { getCredentialStatus: activePort.getCredentialStatus })}
      {...(activePort.setCredential === undefined
        ? {}
        : {
            onSetCredential: async (provider: "anthropic" | "openai", apiKey: string) => {
              await activePort.setCredential?.(provider, apiKey);
            },
          })}
      {...(activePort.removeCredential === undefined
        ? {}
        : {
            onRemoveCredential: async (provider: "anthropic" | "openai") => {
              await activePort.removeCredential?.(provider);
            },
          })}
      {...(activePort.getProviderAuthModeStatus === undefined
        ? {}
        : { getProviderAuthModeStatus: activePort.getProviderAuthModeStatus })}
      {...(activePort.setProviderAuthMode === undefined
        ? {}
        : {
            onSetProviderAuthMode: async (
              provider: "anthropic" | "openai",
              mode: "api-key" | "user-session",
            ) => {
              if (activePort.setProviderAuthMode === undefined) {
                throw new Error("Provider authentication mode changes are unavailable.");
              }
              return activePort.setProviderAuthMode(provider, mode);
            },
          })}
    />
  );
}

function mount(): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Draft Loop root element is missing.");
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// The renderer entry point is also where the setup form lives, and the form is
// tested by rendering it to static markup outside a browser. Mounting only when
// there is a document keeps that import side-effect free without weakening the
// check that a real renderer has a root to mount into.
if (typeof document !== "undefined") {
  mount();
}
