import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import type { ApiClient } from "./api-client.js";
import type { ApplicationMaterialDraft } from "./application-material-model.js";
import {
  type InterviewDetailsForm,
  type InterviewGuidePart,
  type InterviewGuideRequest,
  interviewDetailsOf,
  interviewFormatLabels,
  interviewGuideDepthLabels,
  interviewGuideDepthOf,
  interviewGuideDisclosure,
  interviewGuidePartLabels,
  interviewGuidePartOf,
  interviewGuideSections,
  interviewGuideUnsourcedNote,
  interviewStageLabels,
  interviewStages,
  interviewTopicLabels,
  interviewTopics,
  suggestedInterviewGuideDepth,
} from "./interview-guide-model.js";

/**
 * The interview preparation guide in the Prepare panel (#2621): a form for the interview's
 * details and depth, and the guide read as folded sections with a table of contents. Drafting
 * may research first: the panel waits for the research to end, then drafts from its brief.
 */

export interface InterviewGuideFormProps {
  readonly form: InterviewDetailsForm;
  readonly onForm: (form: InterviewDetailsForm) => void;
  readonly research: boolean;
  readonly onResearch: (research: boolean) => void;
  readonly busy: boolean;
  /** Shown before the first guide. */
  readonly firstGuide: boolean;
}

export function InterviewGuideForm(props: InterviewGuideFormProps) {
  const { form, busy } = props;
  const set = (change: Partial<InterviewDetailsForm>) => props.onForm({ ...form, ...change });
  const depth = interviewGuideDepthOf(form);
  const minutes = Number.parseInt(form.lengthMinutes, 10);
  const suggested = suggestedInterviewGuideDepth(
    form.stage,
    Number.isFinite(minutes) ? minutes : undefined,
  );
  const depths = interviewGuideDepthLabels();
  return (
    <fieldset className="interview-guide-form" disabled={busy}>
      <legend>{t`Your interview`}</legend>
      {props.firstGuide ? (
        <p className="application-material-note">{interviewGuideDisclosure()}</p>
      ) : null}
      <div className="application-material-guidance-row">
        <label>
          {t`Kind of interview`}
          <select
            className="input"
            value={form.stage}
            onChange={(event) =>
              set({ stage: event.currentTarget.value as InterviewDetailsForm["stage"] })
            }
          >
            {interviewStages.map((stage) => (
              <option key={stage} value={stage}>
                {interviewStageLabels()[stage]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t`Length in minutes`}
          <input
            className="input"
            type="number"
            min={5}
            max={480}
            value={form.lengthMinutes}
            onChange={(event) => set({ lengthMinutes: event.currentTarget.value })}
          />
        </label>
        <label>
          {t`When`}
          <input
            className="input"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(event) => set({ scheduledAt: event.currentTarget.value })}
          />
        </label>
        <label>
          {t`Format`}
          <select
            className="input"
            value={form.format ?? ""}
            onChange={(event) =>
              set({ format: event.currentTarget.value as InterviewDetailsForm["format"] })
            }
          >
            <option value="">{t`Not known`}</option>
            {Object.entries(interviewFormatLabels()).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t`Who you will meet, by role`}
        <input
          className="input"
          maxLength={120}
          value={form.interviewerRole}
          placeholder={t`For example: recruiter, or engineering manager`}
          onChange={(event) => set({ interviewerRole: event.currentTarget.value })}
        />
      </label>
      <fieldset className="interview-guide-depth">
        <legend>{t`How deep`}</legend>
        {(["essential", "extensive"] as const).map((option) => (
          <label key={option} className="interview-guide-choice">
            <input
              type="radio"
              name="interview-guide-depth"
              checked={depth === option}
              onChange={() => set({ depth: option })}
            />
            <span>
              <strong>{depths[option].name}</strong>
              {option === suggested ? ` · ${t`suggested`}` : ""}
              <br />
              <span className="application-material-note">{depths[option].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="interview-guide-topics">
        <legend>{t`Topics to cover (optional)`}</legend>
        {interviewTopics.map((topic) => (
          <label key={topic} className="interview-guide-choice">
            <input
              type="checkbox"
              checked={form.topics.includes(topic)}
              onChange={(event) =>
                set({
                  topics: event.currentTarget.checked
                    ? [...form.topics, topic]
                    : form.topics.filter((picked) => picked !== topic),
                })
              }
            />
            {interviewTopicLabels()[topic]}
          </label>
        ))}
        <label>
          {t`Other topics, one per line`}
          <textarea
            className="input"
            rows={2}
            value={form.otherTopics}
            onChange={(event) => set({ otherTopics: event.currentTarget.value })}
          />
        </label>
        {form.topics.includes("salary") ? (
          <p className="application-material-note">{t`A pay range is given only from a dated source research finds; otherwise the guide says what to check.`}</p>
        ) : null}
      </fieldset>
      <details className="application-material-guidance">
        <summary>{t`Notes and what never to say (optional)`}</summary>
        <label>
          {t`Notes for the guide`}
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            value={form.notes}
            placeholder={t`For example: they asked me to prepare a short case`}
            onChange={(event) => set({ notes: event.currentTarget.value })}
          />
        </label>
        <label>
          {t`Never say, one per line`}
          <textarea
            className="input"
            rows={3}
            value={form.neverSay}
            onChange={(event) => set({ neverSay: event.currentTarget.value })}
          />
        </label>
        <p className="application-material-note">{t`Your never-say list stays on the server: it is listed back in the guide, and any sentence close to it is left out.`}</p>
      </details>
      <label className="interview-guide-choice">
        <input
          type="checkbox"
          checked={props.research}
          onChange={(event) => props.onResearch(event.currentTarget.checked)}
        />
        {t`Research the employer, the role and the field first when the saved research is older than two weeks or misses a topic`}
      </label>
    </fieldset>
  );
}

export interface InterviewGuideReaderProps {
  readonly draft: ApplicationMaterialDraft;
  readonly busy: boolean;
  readonly edits?: readonly string[] | undefined;
  readonly onEditText?: ((index: number, text: string) => void) | undefined;
  /** Writes one part of an extensive guide again; absent for an essential or unsaved guide. */
  readonly onPart?: ((part: InterviewGuidePart) => void) | undefined;
}

export function InterviewGuideReader(props: InterviewGuideReaderProps) {
  const { draft, busy } = props;
  const sections = interviewGuideSections(draft);
  const unsourced = interviewGuideUnsourcedNote(draft);
  const offered = new Set<InterviewGuidePart>();
  return (
    <div className="interview-guide">
      <nav aria-label={t`Guide contents`}>
        <ol className="interview-guide-contents">
          {sections.map((section) => (
            <li key={section.section}>
              <a href={`#guide-${section.section}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      {unsourced === undefined ? null : (
        <p className="application-material-note" role="note">
          {unsourced}
        </p>
      )}
      {sections.map((section, position) => {
        const part = interviewGuidePartOf(section.section);
        // Each part's button is offered once, under the first of its sections.
        const offer = part !== undefined && props.onPart !== undefined && !offered.has(part);
        if (offer && part !== undefined) offered.add(part);
        return (
          <details
            key={section.section}
            id={`guide-${section.section}`}
            className="interview-guide-section"
            open={position === 0}
          >
            <summary>{section.title}</summary>
            <ol className="material-items">
              {section.items.map(({ index, item }) => (
                <li key={index} className="material-item">
                  <div>
                    {item.question === "" ? null : <h3>{item.question}</h3>}
                    {props.edits === undefined ? (
                      <p>{item.text}</p>
                    ) : (
                      <textarea
                        className="input"
                        rows={4}
                        maxLength={4000}
                        aria-label={t`Item ${index + 1}`}
                        value={props.edits[index] ?? ""}
                        disabled={busy}
                        onChange={(event) => props.onEditText?.(index, event.currentTarget.value)}
                      />
                    )}
                    {item.trap === undefined ? null : (
                      <p className="interview-guide-trap">
                        <strong>{t`Avoid:`}</strong> {item.trap}
                      </p>
                    )}
                    {item.edited === true && props.edits === undefined ? (
                      <p className="application-material-edited">{t`Edited by you`}</p>
                    ) : null}
                  </div>
                  {item.citations.length === 0 && item.company_citations === undefined ? null : (
                    <aside aria-label={t`Sources`}>
                      <ul>
                        {item.citations.map((citation) => (
                          <li key={citation.fact_id}>{citation.text}</li>
                        ))}
                      </ul>
                      {item.company_citations === undefined ? null : (
                        <>
                          <p className="application-material-source-kind">{t`From research`}</p>
                          <ul>
                            {item.company_citations.map((citation) => (
                              <li key={citation.finding_id}>{citation.text}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </aside>
                  )}
                </li>
              ))}
            </ol>
            {offer && part !== undefined ? (
              <div className="application-material-actions">
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy || props.edits !== undefined}
                  onClick={() => props.onPart?.(part)}
                >
                  {interviewGuidePartLabels()[part]}
                </button>
              </div>
            ) : null}
          </details>
        );
      })}
      {draft.dropped_sentences === undefined ? null : (
        <section className="application-material-tells" aria-labelledby="guide-dropped">
          <h3 id="guide-dropped">{t`Left out`}</h3>
          <p>{t`No fact in your record or finding in the research supports these sentences, or they came close to something you never say, so they are not in the guide.`}</p>
          <ul>
            {draft.dropped_sentences.map((sentence) => (
              <li key={sentence}>
                <q>{sentence}</q>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** How often the panel asks whether the guide's research has ended. */
const researchPollMs = 4_000;

export interface InterviewGuideDrafting {
  /** True while research runs before the guide is drafted. */
  readonly researching: boolean;
  /**
   * Drafts a guide, researching first when asked; resolves with the guide, or undefined when
   * the research failed and the candidate should draft again.
   */
  readonly draft: (options: {
    readonly form: InterviewDetailsForm;
    readonly research: boolean;
    readonly modelId?: string | undefined;
    readonly parts?: readonly InterviewGuidePart[];
    readonly basedOn?: string;
  }) => Promise<ApplicationMaterialDraft | undefined>;
}

/** Drafting a guide, with the wait for research in between when the server queues it. */
export function useInterviewGuideDrafting(
  client: ApiClient,
  workspaceId: string,
  applicationId: string,
): InterviewGuideDrafting {
  const [researching, setResearching] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const post = (body: InterviewGuideRequest) =>
    client.call("POST /v1/workspaces/{workspaceId}/applications/{applicationId}/interview-guide", {
      path: { workspaceId, applicationId },
      body,
    });
  const waitForResearch = async (): Promise<boolean> => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, researchPollMs));
      if (!mounted.current) return false;
      const state = await client
        .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/research", {
          path: { workspaceId, applicationId },
        })
        .catch(() => undefined);
      if (state?.status === "pending") continue;
      return state?.status === "done";
    }
  };
  return {
    researching,
    draft: async (options) => {
      const body = {
        details: interviewDetailsOf(options.form),
        ...(options.modelId === undefined
          ? {}
          : { model: options.modelId as NonNullable<InterviewGuideRequest["model"]> }),
        ...(options.parts === undefined ? {} : { parts: [...options.parts] }),
        ...(options.basedOn === undefined ? {} : { based_on: options.basedOn }),
      };
      const first = await post({ ...body, research: options.research ? "approved" : "skip" });
      if (!("status" in first)) return first;
      setResearching(true);
      try {
        // A failed run still lets the guide be drafted from what exists, with unsourced topics.
        await waitForResearch();
      } finally {
        if (mounted.current) setResearching(false);
      }
      if (!mounted.current) return undefined;
      const drafted = await post({ ...body, research: "skip" });
      return "status" in drafted ? undefined : drafted;
    },
  };
}
