import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  type ApplicationMaterialDraft,
  type ApplicationMaterialGuidance,
  type ApplicationMaterialKind,
  type ApplicationMaterialModel,
  applicationMaterialDisclosure,
  applicationMaterialFileName,
  applicationMaterialGuidanceFor,
  applicationMaterialKindLabels,
  applicationMaterialLengthLabels,
  applicationMaterialMarkdown,
  applicationMaterialModelLabel,
  applicationMaterialProblem,
  applicationMaterialTellReason,
  applicationMaterialToneLabels,
  applicationMaterialVersionLabel,
} from "./application-material-model.js";
import { useRecordId } from "./record-context.js";
import { saveFile } from "./save-file.js";

/**
 * The prepare panel on an application (#2217): the candidate picks a cover letter or interview
 * questions, reads the draft with each citation beside its paragraph, and downloads it as
 * Markdown. Each draft is saved with the application (#2477): the newest opens first, and the
 * candidate can pick an earlier version or delete one. A refusal, such as a server without a Claude route, shows in the panel and leaves
 * the rest of the page working.
 */

export interface ApplicationMaterialViewProps {
  readonly kind: ApplicationMaterialKind;
  /** The version on screen: the newest saved one unless the candidate picked another. */
  readonly draft: ApplicationMaterialDraft | undefined;
  /** This kind's saved versions, newest first; empty on a server that keeps no drafts. */
  readonly versions: readonly ApplicationMaterialDraft[];
  readonly problem: string | undefined;
  readonly busy: boolean;
  /** What the candidate asked the next draft to stress, its tone, length and addressee. */
  readonly guidance: ApplicationMaterialGuidance;
  readonly onGuidance: (guidance: ApplicationMaterialGuidance) => void;
  /** The models the server offers, the default first; fewer than two hides the picker. */
  readonly models: readonly ApplicationMaterialModel[];
  readonly modelId: string | undefined;
  readonly onModel: (modelId: string) => void;
  /** Folded to its heading row, so a feature the candidate does not use takes one line. */
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onKind: (kind: ApplicationMaterialKind) => void;
  readonly onDraft: () => void;
  readonly onDownload: () => void;
  readonly onSelect: (id: string) => void;
  readonly onDelete: () => void;
}

const kinds = () => Object.keys(applicationMaterialKindLabels()) as ApplicationMaterialKind[];

export function ApplicationMaterialView(props: ApplicationMaterialViewProps) {
  const { kind, draft, problem, busy, versions, guidance } = props;
  const change = (field: keyof ApplicationMaterialGuidance, value: string) => {
    const { [field]: _dropped, ...rest } = guidance;
    props.onGuidance(value === "" ? rest : { ...rest, [field]: value });
  };
  return (
    <section
      className="panel host-panel application-material"
      aria-labelledby="material-heading"
      data-collapsed={props.collapsed}
    >
      <div className="application-material-head">
        <h2 id="material-heading">
          <button
            type="button"
            className="application-material-toggle"
            aria-expanded={!props.collapsed}
            aria-controls="material-body"
            onClick={props.onToggle}
          >
            <svg
              className="panel-toggle-chevron"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="m4.5 6.5 3.5 3.5 3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t`Prepare`}
          </button>
        </h2>
        <span className="application-material-hint">{t`Optional · cover letter or interview questions`}</span>
      </div>
      <div id="material-body" className="application-material-body" hidden={props.collapsed}>
        <fieldset className="view-toggle" disabled={busy}>
          <legend className="sr-only">{t`Draft for this application`}</legend>
          {kinds().map((option) => (
            <button
              key={option}
              type="button"
              className="view-toggle-option"
              aria-pressed={kind === option}
              onClick={() => props.onKind(option)}
            >
              {applicationMaterialKindLabels()[option]}
            </button>
          ))}
        </fieldset>
        <p className="application-material-lead">{t`A cover letter or interview questions for this application, when you need them. Your CV does not depend on them.`}</p>
        {draft === undefined ? (
          <p className="application-material-note">{applicationMaterialDisclosure()}</p>
        ) : null}
        <details className="application-material-guidance">
          <summary>{t`Guide this draft (optional)`}</summary>
          <label>
            {t`What to stress`}
            <textarea
              className="input"
              rows={2}
              maxLength={400}
              disabled={busy}
              value={guidance.emphasis ?? ""}
              placeholder={t`For example: my move into team leadership`}
              onChange={(event) => change("emphasis", event.currentTarget.value)}
            />
          </label>
          <div className="application-material-guidance-row">
            <label>
              {t`Tone`}
              <select
                className="input"
                disabled={busy}
                value={guidance.tone ?? ""}
                onChange={(event) => change("tone", event.currentTarget.value)}
              >
                <option value="">{t`Default`}</option>
                {Object.entries(applicationMaterialToneLabels()).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t`Length`}
              <select
                className="input"
                disabled={busy}
                value={guidance.length ?? ""}
                onChange={(event) => change("length", event.currentTarget.value)}
              >
                <option value="">{t`Default`}</option>
                {Object.entries(applicationMaterialLengthLabels()).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {kind === "cover-letter" ? (
              <label>
                {t`Address it to`}
                <input
                  className="input"
                  maxLength={120}
                  disabled={busy}
                  value={guidance.addressee ?? ""}
                  placeholder={t`For example: the hiring team`}
                  onChange={(event) => change("addressee", event.currentTarget.value)}
                />
              </label>
            ) : null}
          </div>
          {props.models.length > 1 ? (
            <label>
              {t`Model`}
              <select
                className="input"
                disabled={busy}
                value={props.modelId ?? props.models.find((model) => model.default)?.model_id}
                onChange={(event) => props.onModel(event.currentTarget.value)}
              >
                {props.models.map((model) => (
                  <option key={model.model_id} value={model.model_id}>
                    {applicationMaterialModelLabel(model)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="application-material-note">{t`Guidance shapes the writing only. Every claim still comes from your career record.`}</p>
        </details>
        <div className="application-material-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={props.onDraft}
          >
            {busy ? t`Drafting…` : draft === undefined ? t`Draft` : t`Draft again`}
          </button>
        </div>
        {problem === undefined ? null : <p role="alert">{problem}</p>}
        {draft === undefined ? null : (
          <>
            {versions.length > 1 && draft.id !== undefined ? (
              <label className="application-material-versions">
                {t`Version`}
                <select
                  className="input"
                  value={draft.id}
                  disabled={busy}
                  onChange={(event) => props.onSelect(event.currentTarget.value)}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {applicationMaterialVersionLabel(version)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ol className="material-items">
              {draft.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a draft's items have no id and never reorder.
                <li key={index} className="material-item">
                  <div>
                    {item.question === "" ? null : <h3>{item.question}</h3>}
                    <p>{item.text}</p>
                  </div>
                  <aside aria-label={t`Sources`}>
                    <ul>
                      {item.citations.map((citation) => (
                        <li key={citation.fact_id}>{citation.text}</li>
                      ))}
                    </ul>
                  </aside>
                </li>
              ))}
            </ol>
            {draft.tells === undefined ? null : (
              <section className="application-material-tells" aria-labelledby="material-tells">
                <h3 id="material-tells">{t`Writing check`}</h3>
                {draft.tells.length === 0 ? (
                  <p>{t`No common machine-writing habit found.`}</p>
                ) : (
                  <ul>
                    {draft.tells.map((tell, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: tells are recomputed with the draft and never reorder.
                      <li key={index}>
                        {tell.sentence === undefined ? null : <q>{tell.sentence}</q>}{" "}
                        {applicationMaterialTellReason(tell)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="application-material-note">{t`A check for habits readers notice in model-written text, not an AI detector. Rewrite in your own words before you send it.`}</p>
              </section>
            )}
            <p className="application-material-note">
              {t`Drafted by`} {draft.model.model}
              {t`. Check every sentence against its sources before you use it.`}
            </p>
            <div className="application-material-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={props.onDownload}
              >{t`Download Markdown`}</button>
              {draft.id === undefined ? null : (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={props.onDelete}
                >{t`Delete this version`}</button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export interface ApplicationMaterialSectionProps {
  readonly client: ApiClient;
  readonly applicationId: string;
}

export function ApplicationMaterialSection({
  client,
  applicationId,
}: ApplicationMaterialSectionProps) {
  const workspaceId = useRecordId();
  const [kind, setKind] = useState<ApplicationMaterialKind>("cover-letter");
  const [versions, setVersions] = useState<readonly ApplicationMaterialDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [unsaved, setUnsaved] = useState<ApplicationMaterialDraft | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [guidance, setGuidance] = useState<ApplicationMaterialGuidance>({});
  const [models, setModels] = useState<readonly ApplicationMaterialModel[]>([]);
  const [modelId, setModelId] = useState<ApplicationMaterialModel["model_id"] | undefined>();
  const [collapsed, setCollapsed] = useState(readPrepareCollapsed);
  const draft = unsaved ?? versions.find((version) => version.id === selectedId) ?? versions[0];

  // The models the server offers; a server without the route leaves the picker hidden.
  useEffect(() => {
    if (collapsed || models.length > 0) return;
    let current = true;
    client.call("GET /v1/application-material/models", {}).then(
      (listed) => {
        if (current) setModels(listed.models);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, collapsed, models.length]);

  // The saved versions of the chosen kind, loaded once the panel is open. A server that keeps
  // no drafts answers 404, and the panel then shows only what it drafts in this visit.
  useEffect(() => {
    if (collapsed) return;
    let current = true;
    client
      .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material", {
        path: { workspaceId, applicationId },
        query: { kind },
      })
      .then(
        (listed) => {
          if (current) setVersions(listed.drafts);
        },
        () => {
          if (current) setVersions([]);
        },
      );
    return () => {
      current = false;
    };
  }, [client, workspaceId, applicationId, kind, collapsed]);

  return (
    <ApplicationMaterialView
      kind={kind}
      draft={draft}
      versions={versions}
      problem={problem}
      guidance={guidance}
      onGuidance={setGuidance}
      models={models}
      modelId={modelId}
      onModel={(next) => setModelId(models.find((model) => model.model_id === next)?.model_id)}
      busy={busy}
      collapsed={collapsed}
      onToggle={() => {
        const next = !collapsed;
        setCollapsed(next);
        savePrepareCollapsed(next);
      }}
      onKind={(next) => {
        setKind(next);
        setVersions([]);
        setSelectedId(undefined);
        setUnsaved(undefined);
        setProblem(undefined);
      }}
      onDraft={async () => {
        setBusy(true);
        setProblem(undefined);
        try {
          const drafted = await client.call(
            "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/material",
            {
              path: { workspaceId, applicationId },
              body: {
                kind,
                ...guidanceBody(kind, guidance),
                ...(modelId === undefined ? {} : { model: modelId }),
              },
            },
          );
          if (drafted.id === undefined) {
            setUnsaved(drafted);
          } else {
            setUnsaved(undefined);
            setVersions((saved) => [drafted, ...saved]);
            setSelectedId(drafted.id);
          }
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        } finally {
          setBusy(false);
        }
      }}
      onDownload={() => {
        if (draft === undefined) return;
        saveFile(
          new Blob([applicationMaterialMarkdown(draft)], { type: "text/markdown" }),
          applicationMaterialFileName(draft.kind),
        );
      }}
      onSelect={(id) => {
        setUnsaved(undefined);
        setSelectedId(id);
      }}
      onDelete={async () => {
        const id = draft?.id;
        if (id === undefined) return;
        if (!globalThis.confirm?.(t`Delete this version for good?`)) return;
        setBusy(true);
        setProblem(undefined);
        try {
          await client.call(
            "DELETE /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}",
            { path: { workspaceId, applicationId, materialId: id } },
          );
          setVersions((saved) => saved.filter((version) => version.id !== id));
          setSelectedId(undefined);
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/** Whether the candidate opened the panel, remembered per browser; it starts folded. */
const prepareOpenKey = "draft-loop.prepare-panel.open";

function readPrepareCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(prepareOpenKey) !== "true";
  } catch {
    return true;
  }
}

function savePrepareCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(prepareOpenKey, collapsed ? "false" : "true");
  } catch {
    // Storage may be blocked; the panel then starts folded each time.
  }
}

function guidanceBody(kind: ApplicationMaterialKind, guidance: ApplicationMaterialGuidance) {
  const chosen = applicationMaterialGuidanceFor(kind, guidance);
  return chosen === undefined ? {} : { guidance: chosen };
}
