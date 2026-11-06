import { t } from "@lingui/core/macro";
import { useEffect, useId, useState } from "react";

import {
  type CareerInterviewAction,
  type CareerInterviewConflictView,
  type CareerInterviewSessionView,
  type CareerInterviewTier,
  type CareerInterviewTopicView,
  careerInterviewActiveTopic,
  careerInterviewProgress,
  careerInterviewTurnText,
  careerInterviewUnavailableNotice,
} from "./career-interview-model.js";
import { SpeechButton } from "./speech-button.js";
import { appendTranscript, type SpeechInput } from "./speech-to-text.js";

/**
 * The guided career interview on the Career evidence page (#1030, #2189): DraftLoop offers topics
 * from the career record, the candidate talks one through with a coach-style interviewer, and each
 * summary they confirm becomes evidence. A host that serves the interview provides it as a panel.
 */

export interface CareerInterviewKnowledgeBase {
  readonly id: string;
  readonly name: string;
}

export interface CareerInterviewPanelProps {
  /** The current session and its opening offer; undefined until one is started or resumed. */
  readonly session: CareerInterviewSessionView | undefined;
  readonly proposal: string | undefined;
  /** Why the interview could not be read or the last action failed, if so. */
  readonly problem?: string | undefined;
  /** Where a confirmed summary can go; the first is preselected. */
  readonly knowledgeBases: readonly CareerInterviewKnowledgeBase[];
  /** Starts or resumes a session; resolves with a problem to show, or undefined. */
  readonly onStart: () => Promise<string | undefined>;
  /** Resolves with a problem to show, or undefined once the session is saved. */
  readonly onAction: (action: CareerInterviewAction) => Promise<string | undefined>;
  /** Summary statements that disagree with the record, for the topic waiting confirmation. */
  readonly loadConflicts: (topicKey: string) => Promise<readonly CareerInterviewConflictView[]>;
  /** Voice input for answers, if the host offers it; the transcript lands in the answer box. */
  readonly speech?: SpeechInput | undefined;
}

export function CareerInterviewPanel({
  session,
  proposal,
  problem,
  knowledgeBases,
  onStart,
  onAction,
  loadConflicts,
  speech,
}: CareerInterviewPanelProps) {
  const id = useId();
  const [pending, setPending] = useState<CareerInterviewPending | undefined>(undefined);
  const [actionProblem, setActionProblem] = useState<string | undefined>(undefined);
  const busy = pending !== undefined;

  /** Runs one call, showing what it waits for; resolves true when it succeeded. */
  async function run(waiting: CareerInterviewPending, work: () => Promise<string | undefined>) {
    setPending(waiting);
    setActionProblem(undefined);
    const found = await work();
    setActionProblem(found);
    setPending(undefined);
    return found === undefined;
  }
  const act = (action: CareerInterviewAction) => run(pendingFor(action), () => onAction(action));

  const active = session === undefined ? undefined : careerInterviewActiveTopic(session);
  const proposed = session?.topics.filter((topic) => topic.status === "proposed") ?? [];
  const progress = session === undefined ? undefined : careerInterviewProgress(session);

  return (
    <section className="panel host-panel career-interview" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{t`Career interview`}</h2>
      <p className="hint">{t`Talk through parts of your career your record does not tell yet. You confirm every summary before it becomes evidence, and you can stop at any time.`}</p>
      {problem === undefined ? null : <p role="alert">{problem}</p>}
      {session === undefined || session.status === "closed" ? (
        <>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void run({ kind: "start" }, onStart)}
          >{t`Start a conversation`}</button>
          <InterviewWaiting pending={pending} />
          {actionProblem === undefined ? null : <p role="alert">{actionProblem}</p>}
        </>
      ) : (
        <div className="interview-layout">
          <aside className="interview-sidebar" aria-label={t`Topics in this conversation`}>
            {progress !== undefined && progress.taken > 0 ? (
              <p className="hint">
                {progress.done} {t`of`} {progress.taken} {t`topics finished in this conversation.`}
              </p>
            ) : null}
            <ul className="interview-topic-list">
              {session.topics.map((topic) => (
                <li
                  key={topic.key}
                  className={`interview-topic-item interview-topic-${topic.status}`}
                  aria-current={topic.key === active?.key ? "step" : undefined}
                >
                  <span>{topic.reason}</span>
                  <small>{careerInterviewTopicStatusLabel(topic.status)}</small>
                </li>
              ))}
            </ul>
          </aside>
          <div className="interview-main">
            {session.interviewerAvailable === false && active?.status !== "summarised" ? (
              <p className="interview-unavailable" role="status">
                {careerInterviewUnavailableNotice}
              </p>
            ) : active === undefined ? (
              <Proposal proposal={proposal} topics={proposed} pending={pending} onAction={act} />
            ) : active.status === "summarised" ? (
              <SummaryReview
                topic={active}
                busy={busy}
                knowledgeBases={knowledgeBases}
                loadConflicts={loadConflicts}
                onAction={act}
              />
            ) : (
              <Conversation topic={active} pending={pending} speech={speech} onAction={act} />
            )}
            {actionProblem === undefined ? null : <p role="alert">{actionProblem}</p>}
            <div className="interview-footer">
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => void act({ action: "pause" })}
              >{t`Pause for now`}</button>
              {session.model === undefined ? null : (
                <p className="hint">
                  {t`Questions written by`} {session.model.model} ({session.model.provider}).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** What the panel is waiting for, so the screen can say so while the server works. */
type CareerInterviewPending =
  | { readonly kind: "start" }
  | { readonly kind: "interviewer"; readonly answer?: string | undefined }
  | { readonly kind: "saving" };

function pendingFor(action: CareerInterviewAction): CareerInterviewPending {
  switch (action.action) {
    case "accept":
    case "own_subject":
      return { kind: "interviewer" };
    case "answer":
      return { kind: "interviewer", answer: "text" in action ? action.text : undefined };
    default:
      return { kind: "saving" };
  }
}

/** A topic's state in the side list, in the candidate's words. */
export function careerInterviewTopicStatusLabel(
  status: CareerInterviewTopicView["status"],
): string {
  switch (status) {
    case "proposed":
      return "Suggested";
    case "declined":
      return "Not now";
    case "open":
      return "Talking now";
    case "summarised":
      return "Summary to confirm";
    case "closed":
      return "Finished";
  }
}

function InterviewWaiting({ pending }: { readonly pending: CareerInterviewPending | undefined }) {
  if (pending === undefined || pending.kind === "interviewer") return null;
  return (
    <p className="hint interview-waiting" role="status">
      {pending.kind === "start" ? t`Looking through your record…` : t`Saving…`}
    </p>
  );
}

function WritingIndicator() {
  return (
    <li className="interview-turn interview-turn-interviewer interview-writing" role="status">
      <span className="interview-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>{" "}
      {t`The interviewer is writing…`}
    </li>
  );
}

function Proposal({
  proposal,
  topics,
  pending,
  onAction,
}: {
  readonly proposal: string | undefined;
  readonly topics: readonly CareerInterviewTopicView[];
  readonly pending: CareerInterviewPending | undefined;
  readonly onAction: (action: CareerInterviewAction) => Promise<boolean>;
}) {
  const id = useId();
  const [subject, setSubject] = useState("");
  const busy = pending !== undefined;
  return (
    <div className="interview-proposal">
      <ol className="interview-turns" aria-label={t`Conversation`}>
        {proposal === undefined ? null : (
          <li className="interview-turn interview-turn-interviewer">
            <span className="interview-speaker">{t`Interviewer`}</span>
            {proposal}
          </li>
        )}
        {pending?.kind === "interviewer" ? <WritingIndicator /> : null}
      </ol>
      <ul className="interview-topics">
        {topics.map((topic) => (
          <li key={topic.key}>
            <p>{topic.reason}</p>
            <div className="interview-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void onAction({ action: "accept", topic_key: topic.key })}
              >{t`Talk about this`}</button>
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => void onAction({ action: "decline", topic_key: topic.key })}
              >{t`Not now`}</button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="interview-subject"
        onSubmit={(event) => {
          event.preventDefault();
          const chosen = subject.trim();
          if (chosen === "") return;
          void onAction({ action: "own_subject", subject: chosen }).then((saved) => {
            if (saved) setSubject("");
          });
        }}
      >
        <label htmlFor={`${id}-subject`}>{t`Or something else you would like to talk about`}</label>
        <div className="interview-subject-row">
          <input
            id={`${id}-subject`}
            value={subject}
            maxLength={300}
            onChange={(event) => setSubject(event.target.value)}
          />
          <button
            type="submit"
            className="button button-outline"
            disabled={busy || subject.trim() === ""}
          >{t`Talk about this instead`}</button>
        </div>
      </form>
    </div>
  );
}

function Turns({ turns }: { readonly turns: CareerInterviewTopicView["turns"] }) {
  return turns.map((turn, index) => {
    const { speaker, text } = careerInterviewTurnText(turn);
    return (
      // Turns are append-only, so their position is a stable key.
      // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
      <li key={index} className={`interview-turn interview-turn-${turn.role}`}>
        <span className="interview-speaker">{speaker}</span>
        {text}
      </li>
    );
  });
}

/** Enter sends the answer; Shift+Enter, or Enter while composing a character, adds to it. */
export function careerInterviewSendsOnKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}): boolean {
  return event.key === "Enter" && !event.shiftKey && event.isComposing !== true;
}

function Conversation({
  topic,
  pending,
  speech,
  onAction,
}: {
  readonly topic: CareerInterviewTopicView;
  readonly pending: CareerInterviewPending | undefined;
  readonly speech: SpeechInput | undefined;
  readonly onAction: (action: CareerInterviewAction) => Promise<boolean>;
}) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  const busy = pending !== undefined;
  const send = () => {
    const text = answer.trim();
    if (text === "" || busy) return;
    void onAction({ action: "answer", topic_key: topic.key, text }).then((saved) => {
      if (saved) setAnswer("");
    });
  };
  return (
    <div className="interview-conversation">
      <h3>{topic.reason}</h3>
      <ol className="interview-turns" aria-label={t`Conversation`}>
        <Turns turns={topic.turns} />
        {pending?.kind === "interviewer" && pending.answer !== undefined ? (
          <li className="interview-turn interview-turn-candidate interview-turn-sending">
            <span className="interview-speaker">{t`You`}</span>
            {pending.answer}
          </li>
        ) : null}
        {pending?.kind === "interviewer" ? <WritingIndicator /> : null}
      </ol>
      <fieldset className="interview-chips">
        <legend className="sr-only">{t`Quick replies`}</legend>
        <button
          type="button"
          className="button button-quiet interview-chip"
          disabled={busy}
          onClick={() => void onAction({ action: "answer", topic_key: topic.key, mark: "skipped" })}
        >{t`Skip this question`}</button>
        <button
          type="button"
          className="button button-quiet interview-chip"
          disabled={busy}
          onClick={() => void onAction({ action: "answer", topic_key: topic.key, mark: "unknown" })}
        >{t`I don't remember`}</button>
        <button
          type="button"
          className="button button-quiet interview-chip"
          disabled={busy}
          onClick={() => void onAction({ action: "set_aside", topic_key: topic.key })}
        >{t`Set this topic aside`}</button>
      </fieldset>
      <form
        className="interview-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={`${id}-answer`}>{t`Your answer`}</label>
        <textarea
          id={`${id}-answer`}
          value={answer}
          maxLength={4_000}
          rows={3}
          placeholder={t`Write your answer. Enter sends, Shift+Enter starts a new line.`}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (
              !careerInterviewSendsOnKey({ ...event, isComposing: event.nativeEvent.isComposing })
            )
              return;
            event.preventDefault();
            send();
          }}
        />
        <div className="interview-actions">
          {speech === undefined ? null : (
            <SpeechButton
              speech={speech}
              disabled={busy}
              onTranscript={(text) => setAnswer((existing) => appendTranscript(existing, text))}
            />
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || answer.trim() === ""}
          >{t`Send`}</button>
        </div>
      </form>
    </div>
  );
}

function SummaryReview({
  topic,
  busy,
  knowledgeBases,
  loadConflicts,
  onAction,
}: {
  readonly topic: CareerInterviewTopicView;
  readonly busy: boolean;
  readonly knowledgeBases: readonly CareerInterviewKnowledgeBase[];
  readonly loadConflicts: (topicKey: string) => Promise<readonly CareerInterviewConflictView[]>;
  readonly onAction: (action: CareerInterviewAction) => Promise<boolean>;
}) {
  const id = useId();
  const [summary, setSummary] = useState(topic.summary ?? "");
  const [base, setBase] = useState(knowledgeBases[0]?.id ?? "");
  const [tier, setTier] = useState<CareerInterviewTier>("normal");
  const [conflicts, setConflicts] = useState<readonly CareerInterviewConflictView[]>([]);

  useEffect(() => {
    let current = true;
    void loadConflicts(topic.key).then((found) => {
      if (current) setConflicts(found);
    });
    return () => {
      current = false;
    };
  }, [loadConflicts, topic.key]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({
          action: "confirm",
          topic_key: topic.key,
          knowledge_base_id: base,
          tier,
          ...(summary.trim() === "" || summary.trim() === topic.summary
            ? {}
            : { summary: summary.trim() }),
        });
      }}
      className="interview-conversation"
    >
      <h3>{topic.reason}</h3>
      <ol className="interview-turns" aria-label={t`Conversation`}>
        <Turns turns={topic.turns} />
      </ol>
      <div className="interview-summary-card">
        <label htmlFor={`${id}-summary`}>{t`Summary of what you said`}</label>
        <textarea
          id={`${id}-summary`}
          value={summary}
          rows={5}
          maxLength={4_000}
          onChange={(event) => setSummary(event.target.value)}
        />
        {conflicts.length === 0 ? null : (
          <ul aria-label={t`Differences from your record`}>
            {conflicts.map((conflict) => (
              <li key={`${conflict.summaryValue}-${conflict.factValue}`}>
                {t`The summary says`} {conflict.summaryValue}
                {t`; your record says`} {conflict.factValue}
                {t`. Both are kept; edit the summary if one is wrong.`}
              </li>
            ))}
          </ul>
        )}
        <label htmlFor={`${id}-base`}>{t`Save to`}</label>
        <select id={`${id}-base`} value={base} onChange={(event) => setBase(event.target.value)}>
          {knowledgeBases.map((knowledgeBase) => (
            <option key={knowledgeBase.id} value={knowledgeBase.id}>
              {knowledgeBase.name}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-tier`}>{t`Who may read it`}</label>
        <select
          id={`${id}-tier`}
          value={tier}
          onChange={(event) => setTier(event.target.value as CareerInterviewTier)}
        >
          <option value="normal">{t`Models may use it in drafts`}</option>
          <option value="sensitive">{t`Sensitive: only with your consent`}</option>
          <option value="never-share">{t`Never share with a model`}</option>
        </select>
        <div className="interview-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || base === "" || summary.trim() === ""}
          >{t`Confirm as evidence`}</button>
          <button
            type="button"
            className="button button-outline"
            disabled={busy}
            onClick={() => void onAction({ action: "set_aside", topic_key: topic.key })}
          >{t`Set aside`}</button>
        </div>
      </div>
    </form>
  );
}
