import { plural, t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import type { CoverLetterKitCapabilities } from "./cover-letter-kit-capabilities.js";
import type { CoverLetterKitView, OwnCoverLetterView } from "./cover-letter-kit-contract.js";
import {
  kitCitedTexts,
  kitRequirementNumbers,
  letterChanged,
  letterParagraphs,
  letterText,
  letterWordCount,
  ownLetterProblem,
} from "./cover-letter-kit-model.js";
import {
  defaultExportTemplate,
  type ExportTemplate,
  exportTemplateLabels,
  exportTemplates,
} from "./export-template.js";
import { formatDate, formatDateTime, formatList } from "./locale-format.js";

/**
 * The writing kit screen on the Cover letter tab (#3279): the kit on the left, the person's own
 * letter on the right (stacked on a phone). The kit holds notes, never sentences; the letter is
 * theirs, saved as a new version and downloaded as Word or PDF with no confirm step, since no
 * model wrote it.
 */

/** What the "Check my letter" panel (#3280) is given in the slot under the editor. */
export interface CoverLetterCheckSlotContext {
  readonly workspaceId: string;
  readonly applicationId: string;
  /** The letter as the editor holds it now, saved or not. */
  readonly text: string;
  /** The saved letter's id while the editor matches it; undefined with unsaved changes. */
  readonly letterId: string | undefined;
}

/**
 * Renders the "Check my letter" panel under the editor. Wiring #3280 is one line:
 * `checkPanel={(letter) => <CoverLetterCheckPanel {...letter} />}`. Nothing shows without it.
 */
export type CoverLetterCheckSlot = (context: CoverLetterCheckSlotContext) => ReactNode;

export interface CoverLetterKitPanelProps {
  readonly kit: CoverLetterKitView | undefined;
  /** False until the saved kit and letter are read, so the screen does not offer a new kit. */
  readonly loaded: boolean;
  readonly text: string;
  readonly savedLetter: OwnCoverLetterView | undefined;
  readonly busy: boolean;
  /** What the screen is doing, such as preparing the kit; undefined when idle. */
  readonly working?: "prepare" | "save" | "download" | undefined;
  readonly problem: string | undefined;
  readonly template: ExportTemplate;
  readonly onPrepare: () => void;
  readonly onText: (text: string) => void;
  readonly onSave: () => void;
  readonly onTemplate: (template: ExportTemplate) => void;
  readonly onDownload: (format: "docx" | "pdf") => void;
  /** The slot under the editor for the "Check my letter" panel (#3280). */
  readonly checkPanel?: ReactNode;
}

export function CoverLetterKitPanel(props: CoverLetterKitPanelProps) {
  const { kit, busy } = props;
  const heading = useId();
  if (kit === undefined) {
    return (
      <section className="cover-letter-kit cover-letter-kit-empty" aria-labelledby={heading}>
        <h3 id={heading}>{t`Your writing kit`}</h3>
        <p>{t`The kit picks the job's three main requirements and the facts from your career record that prove them. It adds ways to open, a four-paragraph outline, dated facts about the employer and phrases to avoid. It holds notes, not sentences: you write the letter.`}</p>
        <div className="cover-letter-kit-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !props.loaded}
            onClick={props.onPrepare}
          >
            {props.working === "prepare" ? t`Preparing…` : t`Prepare my writing kit`}
          </button>
        </div>
        {props.problem === undefined ? null : <p role="alert">{props.problem}</p>}
      </section>
    );
  }
  return (
    <div className="cover-letter-kit">
      <CoverLetterKitMaterial
        kit={kit}
        busy={busy}
        preparing={props.working === "prepare"}
        onPrepare={props.onPrepare}
      />
      <OwnLetterEditor {...props} />
    </div>
  );
}

function CoverLetterKitMaterial({
  kit,
  busy,
  preparing,
  onPrepare,
}: {
  readonly kit: CoverLetterKitView;
  readonly busy: boolean;
  readonly preparing: boolean;
  readonly onPrepare: () => void;
}) {
  const heading = useId();
  const uses = (cited: Parameters<typeof kitCitedTexts>[1]) => {
    const texts = kitCitedTexts(kit, cited);
    return texts.length === 0 ? null : (
      <p className="cover-letter-kit-uses">
        {t`Uses:`} {texts.join(" · ")}
      </p>
    );
  };
  return (
    <section className="cover-letter-kit-material" aria-labelledby={heading}>
      <div className="cover-letter-kit-head">
        <h3 id={heading}>{t`Your writing kit`}</h3>
        <button
          type="button"
          className="button button-outline button-small"
          disabled={busy}
          onClick={onPrepare}
        >
          {preparing ? t`Preparing…` : t`Prepare a new kit`}
        </button>
      </div>
      <p className="cover-letter-kit-note">
        {t`Notes to write from, not sentences to copy. Prepared by ${kit.model} on ${formatDate(kit.createdAt) ?? kit.createdAt}.`}
      </p>
      <h4>{t`Requirements to answer`}</h4>
      <ol className="cover-letter-kit-list">
        {kit.requirements.map((requirement) => (
          <li key={requirement.requirementId}>
            <p className="cover-letter-kit-requirement">{requirement.text}</p>
            <ul aria-label={t`Facts from your career record`}>
              {requirement.facts.map((fact) => (
                <li key={fact.factId}>{fact.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <h4>{t`Ways to open`}</h4>
      <ul className="cover-letter-kit-list">
        {kit.angles.map((angle) => (
          <li key={angle.note}>
            <p>{angle.note}</p>
            {uses(angle)}
          </li>
        ))}
      </ul>
      <h4>{t`Paragraph by paragraph`}</h4>
      <ol className="cover-letter-kit-list">
        {kit.outline.map((part) => {
          const numbers = kitRequirementNumbers(kit, part.requirementIds);
          return (
            <li key={part.paragraph}>
              <p>{part.purpose}</p>
              {numbers.length === 0 ? null : (
                <p className="cover-letter-kit-uses">
                  {t`Answers requirement ${formatList(numbers.map(String))}`}
                </p>
              )}
              {uses(part)}
            </li>
          );
        })}
      </ol>
      {kit.employerFacts.length === 0 ? null : (
        <>
          <h4>{t`About the employer`}</h4>
          <ul className="cover-letter-kit-list">
            {kit.employerFacts.map((fact) => (
              <li key={fact.findingId}>
                <p>{fact.text}</p>
                <p className="cover-letter-kit-uses">
                  {t`Published ${formatDate(fact.publishedOn) ?? fact.publishedOn}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {kit.avoid.length === 0 ? null : (
        <>
          <h4>{t`Phrases to avoid`}</h4>
          <ul className="cover-letter-kit-avoid">
            {kit.avoid.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OwnLetterEditor(props: CoverLetterKitPanelProps) {
  const { busy, text, savedLetter } = props;
  const heading = useId();
  const field = useId();
  const hint = useId();
  const changed = letterChanged(text, savedLetter?.paragraphs);
  const problem = ownLetterProblem(text);
  const words = letterWordCount(text);
  const status = changed
    ? savedLetter === undefined
      ? t`Not saved yet`
      : t`Unsaved changes`
    : savedLetter === undefined
      ? ""
      : t`Saved ${formatDateTime(savedLetter.createdAt) ?? savedLetter.createdAt}`;
  return (
    <section className="cover-letter-kit-editor" aria-labelledby={heading}>
      <h3 id={heading}>{t`Your letter`}</h3>
      <textarea
        id={field}
        aria-labelledby={heading}
        className="input cover-letter-kit-text"
        rows={18}
        value={text}
        disabled={busy}
        aria-describedby={hint}
        placeholder={t`Write your letter here, in your own words.`}
        onChange={(event) => props.onText(event.currentTarget.value)}
      />
      <p id={hint} className="cover-letter-kit-note">
        {t`Leave a blank line between paragraphs. Each save keeps a new version.`}
      </p>
      <p className="cover-letter-kit-status" role="status">
        {plural(words, { one: "# word", other: "# words" })}
        {status === "" ? null : ` · ${status}`}
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
      {changed && text.trim() !== "" && problem !== undefined ? (
        <p className="cover-letter-kit-note" role="note">
          {problem}
        </p>
      ) : null}
      {props.problem === undefined ? null : <p role="alert">{props.problem}</p>}
      <div className="cover-letter-kit-check">{props.checkPanel}</div>
    </section>
  );
}

export interface CoverLetterKitScreenProps {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly capabilities: CoverLetterKitCapabilities;
  /** The slot under the editor for the "Check my letter" panel (#3280). */
  readonly checkPanel?: CoverLetterCheckSlot;
  /** Turns a refusal into the sentence the screen shows; the error's message when left out. */
  readonly describeProblem?: (error: unknown) => string;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : t`Something went wrong.`;
}

/** The kit screen with its state: it reads the newest kit and letter, then saves new versions. */
export function CoverLetterKitScreen(props: CoverLetterKitScreenProps) {
  const { workspaceId, applicationId, capabilities } = props;
  // Kept in a ref, so a host passing a new function each render does not read the kit again.
  const describeRef = useRef(props.describeProblem ?? messageOf);
  describeRef.current = props.describeProblem ?? messageOf;
  const describe = (error: unknown) => describeRef.current(error);
  const [kit, setKit] = useState<CoverLetterKitView | undefined>(undefined);
  const [letter, setLetter] = useState<OwnCoverLetterView | undefined>(undefined);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<CoverLetterKitPanelProps["working"]>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [template, setTemplate] = useState<ExportTemplate>(defaultExportTemplate);

  useEffect(() => {
    let current = true;
    setLoaded(false);
    capabilities.load({ workspaceId, applicationId }).then(
      (saved) => {
        if (!current) return;
        setKit(saved.kit ?? undefined);
        setLetter(saved.letter ?? undefined);
        setText(saved.letter === null ? "" : letterText(saved.letter.paragraphs));
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
  }, [capabilities, workspaceId, applicationId]);

  const run = async (
    step: NonNullable<CoverLetterKitPanelProps["working"]>,
    work: () => Promise<void>,
  ) => {
    setWorking(step);
    setProblem(undefined);
    try {
      await work();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setWorking(undefined);
    }
  };

  /** Saves the editor's text when it changed, and answers the saved letter. */
  const save = async (): Promise<OwnCoverLetterView | undefined> => {
    if (!letterChanged(text, letter?.paragraphs)) return letter;
    const basedOn = letter?.id ?? kit?.id;
    if (basedOn === undefined) return undefined;
    const saved = await capabilities.saveLetter({
      workspaceId,
      applicationId,
      basedOn,
      paragraphs: letterParagraphs(text),
    });
    setLetter(saved);
    return saved;
  };

  const changed = letterChanged(text, letter?.paragraphs);
  return (
    <CoverLetterKitPanel
      kit={kit}
      loaded={loaded}
      text={text}
      savedLetter={letter}
      busy={working !== undefined}
      working={working}
      problem={problem}
      template={template}
      onTemplate={setTemplate}
      onText={setText}
      onPrepare={() =>
        run("prepare", async () => {
          setKit(await capabilities.prepare({ workspaceId, applicationId }));
        })
      }
      onSave={() =>
        run("save", async () => {
          await save();
        })
      }
      onDownload={(format) =>
        run("download", async () => {
          // The person's own letter downloads at once: no AI-draft confirm applies (#3277).
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
