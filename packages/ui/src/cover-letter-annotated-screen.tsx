import { t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { AnnotatedDraftView } from "./cover-letter-annotated-contract.js";
import {
  annotatedDraftText,
  annotatedParagraphRole,
  annotatedPrompt,
  annotatedSegments,
  annotatedWhy,
  answeredRequirement,
  genericPhraseSpans,
  initialRewrites,
  ownWordsShare,
  rewriteParagraphs,
} from "./cover-letter-annotated-model.js";
import type {
  AnnotatedDraftCapabilities,
  CoverLetterKitCapabilities,
} from "./cover-letter-kit-capabilities.js";
import type { CoverLetterKitView, OwnCoverLetterView } from "./cover-letter-kit-contract.js";
import { letterChanged, letterText, ownLetterProblem } from "./cover-letter-kit-model.js";
import type { CoverLetterCheckSlot } from "./cover-letter-kit-screen.js";
import {
  defaultExportTemplate,
  type ExportTemplate,
  exportTemplateLabels,
  exportTemplates,
} from "./export-template.js";
import { formatDate, formatDateTime, formatList } from "./locale-format.js";

/**
 * The annotated draft on the Cover letter tab (#3281): a letter a model drafted, paragraph by
 * paragraph, each with a note on why it is there, which fact backs it and a prompt to say it the
 * person's way, with generic phrases underlined. The person writes their own version in a second
 * column (stacked under each paragraph on a phone). Only that column is saved, as their own
 * letter, and downloaded with no confirm step. The notes need no model call.
 *
 * It asks for no "I accept the risk" choice (#3277): the drafted letter is a reference that is
 * never saved as the person's or downloaded from here, and the meter shows how much of their
 * version is in their own words.
 */

export interface CoverLetterAnnotatedPanelProps {
  readonly draft: AnnotatedDraftView | undefined;
  /** The writing kit, when there is one, to name the requirement each paragraph answers. */
  readonly kit: CoverLetterKitView | undefined;
  /** False until the saved draft and letter are read, so the screen does not offer a draft. */
  readonly loaded: boolean;
  /** The person's version, one box per drafted paragraph. */
  readonly rewrites: readonly string[];
  readonly savedLetter: OwnCoverLetterView | undefined;
  readonly busy: boolean;
  readonly working?: "prepare" | "save" | "download" | undefined;
  readonly problem: string | undefined;
  readonly template: ExportTemplate;
  readonly onPrepare: () => void;
  readonly onRewrite: (index: number, text: string) => void;
  readonly onSave: () => void;
  readonly onTemplate: (template: ExportTemplate) => void;
  readonly onDownload: (format: "docx" | "pdf") => void;
  /** The "Check my letter" panel (#3280) under the person's version. */
  readonly checkPanel?: ReactNode;
}

export function CoverLetterAnnotatedPanel(props: CoverLetterAnnotatedPanelProps) {
  const { draft, busy } = props;
  const heading = useId();
  if (draft === undefined) {
    return (
      <section className="cover-letter-annotated cover-letter-kit-empty" aria-labelledby={heading}>
        <h3 id={heading}>{t`Annotated draft`}</h3>
        <p>{t`The AI drafts a letter from your career record. Each paragraph gets a note: why it is there, which fact backs it, and a prompt to say it your way. You write your version beside it. Only your version is saved and downloaded.`}</p>
        <div className="cover-letter-kit-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !props.loaded}
            onClick={props.onPrepare}
          >
            {props.working === "prepare" ? t`Drafting…` : t`Prepare the annotated draft`}
          </button>
        </div>
        {props.problem === undefined ? null : <p role="alert">{props.problem}</p>}
      </section>
    );
  }
  const own = rewriteParagraphs(props.rewrites);
  const ownText = letterText(own);
  const meter = ownWordsShare(ownText, annotatedDraftText(draft));
  const changed = letterChanged(ownText, props.savedLetter?.paragraphs);
  const problem = ownLetterProblem(ownText);
  const status = changed
    ? props.savedLetter === undefined
      ? t`Not saved yet`
      : t`Unsaved changes`
    : props.savedLetter === undefined
      ? ""
      : t`Saved ${formatDateTime(props.savedLetter.createdAt) ?? props.savedLetter.createdAt}`;
  return (
    <section className="cover-letter-annotated" aria-labelledby={heading}>
      <div className="cover-letter-kit-head">
        <h3 id={heading}>{t`Annotated draft`}</h3>
        <button
          type="button"
          className="button button-outline button-small"
          disabled={busy}
          onClick={props.onPrepare}
        >
          {props.working === "prepare" ? t`Drafting…` : t`Prepare a new draft`}
        </button>
      </div>
      <p className="cover-letter-kit-note">
        {t`Drafted by ${draft.model} on ${formatDate(draft.createdAt) ?? draft.createdAt}. Read each paragraph, then write it your way in the box beside it. Only your version is saved and downloaded. Underlined phrases are generic: leave them out of yours.`}
      </p>
      <ol className="cover-letter-annotated-rows">
        {draft.paragraphs.map((paragraph, index) => (
          <AnnotatedRow
            // The draft's paragraphs never move, so the position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed paragraph order
            key={index}
            index={index}
            draft={draft}
            kit={props.kit}
            rewrite={props.rewrites[index] ?? ""}
            busy={busy}
            onRewrite={(text) => props.onRewrite(index, text)}
            paragraph={paragraph}
          />
        ))}
      </ol>
      <div className="cover-letter-annotated-footer">
        <OwnWordsMeter share={meter} />
        <p className="cover-letter-kit-status" role="status">
          {status}
        </p>
        <div className="cover-letter-kit-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !changed || problem !== undefined}
            onClick={props.onSave}
          >
            {props.working === "save" ? t`Saving…` : t`Save my letter`}
          </button>
          <label className="cover-letter-kit-template">
            {t`Template`}
            <select
              className="input"
              value={props.template}
              disabled={busy}
              onChange={(event) => props.onTemplate(event.currentTarget.value as ExportTemplate)}
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
            disabled={busy || problem !== undefined}
            onClick={() => props.onDownload("docx")}
          >{t`Download Word`}</button>
          <button
            type="button"
            className="button button-outline"
            disabled={busy || problem !== undefined}
            onClick={() => props.onDownload("pdf")}
          >{t`Download PDF`}</button>
        </div>
        {changed && ownText !== "" && problem !== undefined ? (
          <p className="cover-letter-kit-note" role="note">
            {problem}
          </p>
        ) : null}
        {props.problem === undefined ? null : <p role="alert">{props.problem}</p>}
        <div className="cover-letter-kit-check">{props.checkPanel}</div>
      </div>
    </section>
  );
}

function AnnotatedRow({
  index,
  draft,
  kit,
  paragraph,
  rewrite,
  busy,
  onRewrite,
}: {
  readonly index: number;
  readonly draft: AnnotatedDraftView;
  readonly kit: CoverLetterKitView | undefined;
  readonly paragraph: AnnotatedDraftView["paragraphs"][number];
  readonly rewrite: string;
  readonly busy: boolean;
  readonly onRewrite: (text: string) => void;
}) {
  const field = useId();
  const prompt = useId();
  const number = index + 1;
  const role = annotatedParagraphRole(paragraph, index, draft.paragraphs.length);
  const requirement = answeredRequirement(paragraph, kit);
  const facts = [
    ...paragraph.facts.map((fact) => fact.text),
    ...paragraph.employerFacts.map((fact) => fact.text),
  ];
  const generic = genericPhraseSpans(paragraph.text).map((span) => span.phrase);
  const genericInYours = genericPhraseSpans(rewrite).map((span) => span.phrase);
  return (
    <li className="cover-letter-annotated-row">
      <div className="cover-letter-annotated-model">
        <h4>{t`Draft, paragraph ${number}`}</h4>
        <p className="cover-letter-annotated-text">
          {annotatedSegments(paragraph.text).map((segment, at) =>
            segment.generic ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments of a fixed text
              <mark key={at} className="cover-letter-annotated-generic">
                {segment.text}
              </mark>
            ) : (
              segment.text
            ),
          )}
        </p>
        <dl className="cover-letter-annotated-note">
          <dt>{t`Why it is there`}</dt>
          <dd>{annotatedWhy(role, requirement)}</dd>
          <dt>{t`Which fact backs it`}</dt>
          <dd>
            {facts.length === 0 ? t`No fact cited: add nothing new here.` : facts.join(" · ")}
          </dd>
          <dt>{t`Say this your way`}</dt>
          <dd id={prompt}>{annotatedPrompt(role)}</dd>
          {generic.length === 0 ? null : (
            <>
              <dt>{t`Generic phrases`}</dt>
              <dd>{formatList(generic.map((phrase) => `“${phrase}”`))}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="cover-letter-annotated-mine">
        <label htmlFor={field}>{t`Your paragraph ${number}`}</label>
        <textarea
          id={field}
          className="input cover-letter-annotated-input"
          rows={6}
          value={rewrite}
          disabled={busy}
          aria-describedby={prompt}
          placeholder={t`Write this paragraph your way.`}
          onChange={(event) => onRewrite(event.currentTarget.value)}
        />
        {genericInYours.length === 0 ? null : (
          <p className="cover-letter-kit-note" role="note">
            {t`Generic in yours: ${formatList(genericInYours.map((phrase) => `“${phrase}”`))}`}
          </p>
        )}
      </div>
    </li>
  );
}

function OwnWordsMeter({ share }: { readonly share: ReturnType<typeof ownWordsShare> }) {
  const label = useId();
  if (share === undefined) {
    return (
      <p className="cover-letter-kit-note">{t`Write your version in the boxes. A meter here shows how much of it is in your own words.`}</p>
    );
  }
  const percent = Math.round(share.share * 100);
  return (
    <div className="cover-letter-annotated-meter">
      <span id={label}>{t`In your own words: ${percent}%`}</span>
      <meter
        aria-labelledby={label}
        min={0}
        max={1}
        low={0.5}
        high={0.8}
        optimum={1}
        value={share.share}
      />
      <span className="cover-letter-kit-note">
        {t`${share.ownWords} of ${share.words} words. Five words in a row taken from the draft count as copied.`}
      </span>
    </div>
  );
}

export interface CoverLetterAnnotatedScreenProps {
  readonly workspaceId: string;
  readonly applicationId: string;
  /** The writing kit's commands, for the kit, the saved letter, saving and downloading. */
  readonly capabilities: CoverLetterKitCapabilities;
  /** The drafted letter's commands. */
  readonly draft: AnnotatedDraftCapabilities;
  readonly checkPanel?: CoverLetterCheckSlot;
  readonly describeProblem?: (error: unknown) => string;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : t`Something went wrong.`;
}

/** The annotated draft with its state: it reads the newest draft, kit and letter, then saves. */
export function CoverLetterAnnotatedScreen(props: CoverLetterAnnotatedScreenProps) {
  const { workspaceId, applicationId, capabilities, draft: drafts } = props;
  const describeRef = useRef(props.describeProblem ?? messageOf);
  describeRef.current = props.describeProblem ?? messageOf;
  const [draft, setDraft] = useState<AnnotatedDraftView | undefined>(undefined);
  const [kit, setKit] = useState<CoverLetterKitView | undefined>(undefined);
  const [letter, setLetter] = useState<OwnCoverLetterView | undefined>(undefined);
  const [rewrites, setRewrites] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<CoverLetterAnnotatedPanelProps["working"]>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [template, setTemplate] = useState<ExportTemplate>(defaultExportTemplate);

  useEffect(() => {
    let current = true;
    setLoaded(false);
    const scope = { workspaceId, applicationId };
    Promise.all([capabilities.load(scope), drafts.load(scope)]).then(
      ([saved, drafted]) => {
        if (!current) return;
        setKit(saved.kit ?? undefined);
        setLetter(saved.letter ?? undefined);
        setDraft(drafted ?? undefined);
        setRewrites(initialRewrites(drafted?.paragraphs.length ?? 0, saved.letter?.paragraphs));
        setLoaded(true);
      },
      (error: unknown) => {
        if (!current) return;
        setProblem(describeRef.current(error));
        setLoaded(true);
      },
    );
    return () => {
      current = false;
    };
  }, [capabilities, drafts, workspaceId, applicationId]);

  const run = async (
    step: NonNullable<CoverLetterAnnotatedPanelProps["working"]>,
    work: () => Promise<void>,
  ) => {
    setWorking(step);
    setProblem(undefined);
    try {
      await work();
    } catch (error) {
      setProblem(describeRef.current(error));
    } finally {
      setWorking(undefined);
    }
  };

  const paragraphs = rewriteParagraphs(rewrites);
  /** Saves the person's column when it changed, and answers the saved letter. */
  const save = async (): Promise<OwnCoverLetterView | undefined> => {
    if (!letterChanged(letterText(paragraphs), letter?.paragraphs)) return letter;
    const basedOn = letter?.id ?? draft?.id;
    if (basedOn === undefined) return undefined;
    const saved = await capabilities.saveLetter({
      workspaceId,
      applicationId,
      basedOn,
      paragraphs,
    });
    setLetter(saved);
    return saved;
  };

  const text = letterText(paragraphs);
  const changed = letterChanged(text, letter?.paragraphs);
  return (
    <CoverLetterAnnotatedPanel
      draft={draft}
      kit={kit}
      loaded={loaded}
      rewrites={rewrites}
      savedLetter={letter}
      busy={working !== undefined}
      working={working}
      problem={problem}
      template={template}
      onTemplate={setTemplate}
      onRewrite={(index, value) =>
        setRewrites((current) => current.map((entry, at) => (at === index ? value : entry)))
      }
      onPrepare={() =>
        run("prepare", async () => {
          const drafted = await drafts.prepare({ workspaceId, applicationId });
          setDraft(drafted);
          // The person's version stays; it is laid out again beside the new paragraphs.
          setRewrites((current) =>
            initialRewrites(drafted.paragraphs.length, rewriteParagraphs(current)),
          );
        })
      }
      onSave={() =>
        run("save", async () => {
          await save();
        })
      }
      onDownload={(format) =>
        run("download", async () => {
          // Only the person's own version leaves the app, so no AI-draft confirm applies (#3277).
          const saved = await save();
          if (saved === undefined) return;
          await capabilities.downloadLetter({
            workspaceId,
            applicationId,
            letterId: saved.id,
            format,
            template,
          });
        })
      }
      checkPanel={props.checkPanel?.({
        workspaceId,
        applicationId,
        text,
        letterId: changed ? undefined : letter?.id,
      })}
    />
  );
}
