import {
  defaultExportTemplate,
  type ExportTemplate,
  exportTemplateLabels,
  exportTemplates,
} from "@draft-loop/ui/export-template";
import { openApplicationPanelEvent } from "@draft-loop/ui/host-panels";
import { t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useState } from "react";

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
  applicationMaterialReviewNote,
  applicationMaterialTellReason,
  applicationMaterialToneLabels,
  applicationMaterialVersionLabel,
} from "./application-material-model.js";
import { useRecordId } from "./record-context.js";
import { ResearchBriefSection } from "./research-brief.js";
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
  /** The candidate's writing samples as edited, or undefined on a server that keeps none. */
  readonly samples: readonly string[] | undefined;
  readonly samplesSaved: boolean;
  readonly onSamples: (samples: readonly string[]) => void;
  readonly onSaveSamples: () => void;
  /** Folded to its heading row, so a feature the candidate does not use takes one line. */
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onKind: (kind: ApplicationMaterialKind) => void;
  readonly onDraft: () => void;
  readonly onDownload: () => void;
  readonly onSelect: (id: string) => void;
  readonly onDelete: () => void;
  /** The CV template a saved draft downloads with; absent where documents are not offered. */
  readonly template?: ExportTemplate;
  readonly onTemplate?: (template: ExportTemplate) => void;
  readonly onDocument?: (format: "docx" | "pdf") => void;
  /** The texts being edited, one per item, or undefined when the draft is not being edited. */
  readonly edits?: readonly string[] | undefined;
  readonly onEdit?: () => void;
  readonly onEditText?: (index: number, text: string) => void;
  readonly onSaveEdit?: () => void;
  readonly onCancelEdit?: () => void;
  /** True while a critic from another company checks the newest cover letter (#2526). */
  readonly reviewing?: boolean;
  /** How the critic's check ended, once it did. */
  readonly reviewNote?: string | undefined;
  /** Research about the employer (#2545), shown before the drafts when the server offers it. */
  readonly research?: ReactNode;
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
        {props.research}
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
          {props.samples === undefined ? null : (
            <fieldset className="application-material-samples" disabled={busy}>
              <legend>{t`Your writing samples`}</legend>
              <p className="application-material-note">{t`Paste up to three texts you wrote, such as an old letter or a long email. Drafts copy how you write, never what the samples say.`}</p>
              {[0, 1, 2].map((index) => (
                <textarea
                  key={index}
                  className="input"
                  rows={3}
                  maxLength={4000}
                  aria-label={t`Writing sample ${index + 1}`}
                  value={props.samples?.[index] ?? ""}
                  onChange={(event) => {
                    const next = [0, 1, 2].map((slot) =>
                      slot === index ? event.currentTarget.value : (props.samples?.[slot] ?? ""),
                    );
                    props.onSamples(next);
                  }}
                />
              ))}
              <div className="application-material-actions">
                <button
                  type="button"
                  className="button button-outline"
                  onClick={props.onSaveSamples}
                >
                  {props.samplesSaved ? t`Samples saved` : t`Save samples`}
                </button>
              </div>
            </fieldset>
          )}
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
        {props.reviewing === true ? (
          <p className="application-material-note" role="status">
            {t`A critic from another company is checking this letter for sentences that read as machine-written. A revised version opens here if it finds any.`}
          </p>
        ) : props.reviewNote === undefined ? null : (
          <p className="application-material-note" role="status">
            {props.reviewNote}
          </p>
        )}
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
                    {props.edits === undefined ? (
                      <p>{item.text}</p>
                    ) : (
                      <textarea
                        className="input"
                        rows={5}
                        maxLength={4000}
                        aria-label={t`Item ${index + 1}`}
                        value={props.edits[index] ?? ""}
                        disabled={busy}
                        onChange={(event) => props.onEditText?.(index, event.currentTarget.value)}
                      />
                    )}
                    {item.edited === true && props.edits === undefined ? (
                      <p className="application-material-edited">{t`Edited by you`}</p>
                    ) : null}
                    {item.unsupported_numbers === undefined || props.edits !== undefined ? null : (
                      <p className="application-material-note" role="note">
                        {t`Check these numbers: none of the sources states ${item.unsupported_numbers.join(", ")}.`}
                      </p>
                    )}
                  </div>
                  <aside aria-label={t`Sources`}>
                    <ul>
                      {item.citations.map((citation) => (
                        <li key={citation.fact_id}>{citation.text}</li>
                      ))}
                    </ul>
                    {item.company_citations === undefined ? null : (
                      <>
                        <p className="application-material-source-kind">{t`About the company`}</p>
                        <ul>
                          {item.company_citations.map((citation) => (
                            <li key={citation.finding_id}>{citation.text}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </aside>
                </li>
              ))}
            </ol>
            {draft.dropped_sentences === undefined ? null : (
              <section className="application-material-tells" aria-labelledby="material-dropped">
                <h3 id="material-dropped">{t`Left out`}</h3>
                <p>{t`No fact in your career record supports these sentences, so they are not in the letter.`}</p>
                <ul>
                  {draft.dropped_sentences.map((sentence) => (
                    <li key={sentence}>
                      <q>{sentence}</q>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {draft.critic_findings === undefined ? null : (
              <section className="application-material-tells" aria-labelledby="material-critic">
                <h3 id="material-critic">{t`What the critic flagged`}</h3>
                <p>{t`These sentences of the first draft read as machine-written; this version rewrites them.`}</p>
                <ul>
                  {draft.critic_findings.map((finding) => (
                    <li key={`${finding.paragraph}:${finding.sentence}`}>
                      <q>{finding.sentence}</q> {finding.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
            {props.edits === undefined ? null : (
              <div className="application-material-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy || props.edits.some((text) => text.trim() === "")}
                  onClick={props.onSaveEdit}
                >{t`Save as a new version`}</button>
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={props.onCancelEdit}
                >{t`Cancel`}</button>
              </div>
            )}
            <div className="application-material-actions">
              {draft.id === undefined ||
              props.edits !== undefined ||
              props.onEdit === undefined ? null : (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={props.onEdit}
                >{t`Edit`}</button>
              )}
              {draft.id === undefined || props.onDocument === undefined ? null : (
                <>
                  <label className="application-material-template">
                    {t`Template`}
                    <select
                      className="input"
                      value={props.template ?? defaultExportTemplate}
                      disabled={busy}
                      onChange={(event) =>
                        props.onTemplate?.(event.currentTarget.value as ExportTemplate)
                      }
                    >
                      {exportTemplates.map((template) => (
                        <option key={template} value={template}>
                          {exportTemplateLabels()[template]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => props.onDocument?.("docx")}
                  >{t`Download Word`}</button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => props.onDocument?.("pdf")}
                  >{t`Download PDF`}</button>
                </>
              )}
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
  const [samples, setSamples] = useState<readonly string[] | undefined>(undefined);
  const [samplesSaved, setSamplesSaved] = useState(true);
  const [edits, setEdits] = useState<readonly string[] | undefined>(undefined);
  const [template, setTemplate] = useState<ExportTemplate>(defaultExportTemplate);
  const [modelId, setModelId] = useState<ApplicationMaterialModel["model_id"] | undefined>();
  const [collapsed, setCollapsed] = useState(readPrepareCollapsed);

  // The review's "Cover letter or interview" button opens the panel and brings it into view
  // (#2578); the panel stays where it is, under the draft.
  useEffect(() => {
    const open = () => {
      setCollapsed(false);
      savePrepareCollapsed(false);
      requestAnimationFrame(() => {
        const heading = document.getElementById("material-heading");
        heading?.scrollIntoView({ behavior: "smooth", block: "start" });
        heading?.querySelector("button")?.focus({ preventScroll: true });
      });
    };
    globalThis.addEventListener(openApplicationPanelEvent, open);
    return () => globalThis.removeEventListener(openApplicationPanelEvent, open);
  }, []);
  const [reviewing, setReviewing] = useState<string | undefined>(undefined);
  const [reviewNote, setReviewNote] = useState<string | undefined>(undefined);
  const draft = unsaved ?? versions.find((version) => version.id === selectedId) ?? versions[0];

  // The candidate's writing samples; a server that keeps none leaves the fields hidden.
  useEffect(() => {
    if (collapsed || samples !== undefined) return;
    let current = true;
    client.call("GET /v1/workspaces/{workspaceId}/writing-samples", { path: { workspaceId } }).then(
      (stored) => {
        if (current) setSamples(stored.samples);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, workspaceId, collapsed, samples]);

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

  // The critic pass on a cover letter just drafted (#2526): polled until it ends, then the
  // revised version, if any, is loaded and opened.
  useEffect(() => {
    if (reviewing === undefined) return;
    let current = true;
    const poll = async () => {
      const review = await client
        .call(
          "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}/review",
          { path: { workspaceId, applicationId, materialId: reviewing } },
        )
        .catch(() => undefined);
      if (!current) return;
      if (review?.status === "pending") {
        timer = setTimeout(poll, reviewPollMs);
        return;
      }
      setReviewing(undefined);
      setReviewNote(review === undefined ? undefined : applicationMaterialReviewNote(review));
      if (review?.revision_id === undefined) return;
      const listed = await client
        .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material", {
          path: { workspaceId, applicationId },
          query: { kind: "cover-letter" },
        })
        .catch(() => undefined);
      if (!current || listed === undefined) return;
      setVersions(listed.drafts);
      setSelectedId(review.revision_id);
    };
    let timer = setTimeout(poll, reviewPollMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, workspaceId, applicationId, reviewing]);

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
      research={
        collapsed ? undefined : (
          <ResearchBriefSection client={client} applicationId={applicationId} />
        )
      }
      draft={draft}
      versions={versions}
      problem={problem}
      reviewing={reviewing !== undefined && kind === "cover-letter"}
      reviewNote={kind === "cover-letter" ? reviewNote : undefined}
      guidance={guidance}
      onGuidance={setGuidance}
      models={models}
      modelId={modelId}
      samples={samples}
      samplesSaved={samplesSaved}
      onSamples={(next) => {
        setSamples(next);
        setSamplesSaved(false);
      }}
      onSaveSamples={async () => {
        setProblem(undefined);
        try {
          const stored = await client.call("PUT /v1/workspaces/{workspaceId}/writing-samples", {
            path: { workspaceId },
            body: { samples: (samples ?? []).map((sample) => sample.trim()).filter(Boolean) },
          });
          setSamples(stored.samples);
          setSamplesSaved(true);
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        }
      }}
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
        setEdits(undefined);
      }}
      template={template}
      onTemplate={setTemplate}
      onDocument={async (format) => {
        const id = draft?.id;
        if (id === undefined || draft === undefined) return;
        setBusy(true);
        setProblem(undefined);
        try {
          const bytes = await client.call(
            "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}/document",
            { path: { workspaceId, applicationId, materialId: id }, query: { format, template } },
          );
          saveFile(bytes as Blob, applicationMaterialFileName(draft.kind, format));
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        } finally {
          setBusy(false);
        }
      }}
      edits={edits}
      onEdit={() => setEdits(draft?.items.map((item) => item.text))}
      onEditText={(index, text) =>
        setEdits((current) => current?.map((value, slot) => (slot === index ? text : value)))
      }
      onCancelEdit={() => setEdits(undefined)}
      onSaveEdit={async () => {
        const id = draft?.id;
        if (id === undefined || edits === undefined) return;
        setBusy(true);
        setProblem(undefined);
        try {
          const version = await client.call(
            "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/material/{materialId}/versions",
            {
              path: { workspaceId, applicationId, materialId: id },
              body: { items: edits.map((text) => ({ text })) },
            },
          );
          setVersions((saved) => [version, ...saved]);
          setSelectedId(version.id);
          setEdits(undefined);
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        } finally {
          setBusy(false);
        }
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
            setReviewNote(undefined);
            setReviewing(drafted.review?.status === "pending" ? drafted.id : undefined);
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
        setEdits(undefined);
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

/** How often the panel asks whether the critic's check has ended. */
const reviewPollMs = 3_000;

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
