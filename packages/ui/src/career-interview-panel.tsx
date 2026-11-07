import { t } from "@lingui/core/macro";
import { useEffect, useId, useState } from "react";

import {
  CareerInterviewLiveStage,
  type CareerInterviewLiveVoice,
} from "./career-interview-live.js";
import {
  type CareerInterviewAction,
  type CareerInterviewConflictView,
  type CareerInterviewProblem,
  type CareerInterviewSessionView,
  type CareerInterviewTier,
  type CareerInterviewTopicView,
  careerInterviewActiveTopic,
  careerInterviewOffer,
  careerInterviewProgress,
  careerInterviewRefusal,
  careerInterviewTopicReason,
  careerInterviewTopicTitle,
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
  readonly onStart: () => Promise<CareerInterviewProblem>;
  /** Resolves with a problem to show, or undefined once the session is saved. */
  readonly onAction: (action: CareerInterviewAction) => Promise<CareerInterviewProblem>;
  /** Summary statements that disagree with the record, for the topic waiting confirmation. */
  readonly loadConflicts: (topicKey: string) => Promise<readonly CareerInterviewConflictView[]>;
  /** Voice input for answers, if the host offers it; the transcript lands in the answer box. */
  readonly speech?: SpeechInput | undefined;
  /**
   * Records the candidate's permission to send their answers to Anthropic, when the interview is
   * refused for want of it; resolves with a problem, or undefined. The panel then tries again.
   */
  readonly allowInterviewer?: (() => Promise<string | undefined>) | undefined;
  /** The live voice conversation, if the host offers it; shown when the server does too. */
  readonly live?: CareerInterviewLiveVoice | undefined;
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
  live,
  allowInterviewer,
}: CareerInterviewPanelProps) {
  const id = useId();
  const [pending, setPending] = useState<CareerInterviewPending | undefined>(undefined);
  const [actionProblem, setActionProblem] = useState<CareerInterviewProblem>(undefined);
  const [retry, setRetry] = useState<(() => Promise<boolean>) | undefined>(undefined);
  const busy = pending !== undefined;

  /** Runs one call, showing what it waits for; resolves true when it succeeded. */
  async function run(
    waiting: CareerInterviewPending,
    work: () => Promise<CareerInterviewProblem>,
  ): Promise<boolean> {
    setPending(waiting);
    setActionProblem(undefined);
    const found = await work();
    setActionProblem(found);
    // A refusal for want of consent can be lifted here, then the same call runs again.
    setRetry(() => (found === undefined ? undefined : () => run(waiting, work)));
    setPending(undefined);
    return found === undefined;
  }
  const problemNotice = (
    <CareerInterviewProblemNotice
      problem={actionProblem}
      busy={busy}
      allowInterviewer={allowInterviewer}
      retry={retry}
      onAllowFailed={(message) => setActionProblem(message)}
    />
  );
  const act = (action: CareerInterviewAction) => run(pendingFor(action), () => onAction(action));

  const active = session === undefined ? undefined : careerInterviewActiveTopic(session);
  const proposed = session?.topics.filter((topic) => topic.status === "proposed") ?? [];
  const taken = session?.topics.some((topic) => topic.status !== "proposed") ?? false;
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
          {problemNotice}
        </>
      ) : session.status === "paused" ? (
        <>
          <p>{t`The conversation is paused. Your answers so far are saved; resume when you are ready.`}</p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void run({ kind: "start" }, onStart)}
          >{t`Resume the conversation`}</button>
          <InterviewWaiting pending={pending} />
          {problemNotice}
        </>
      ) : (
        <div className={`interview-layout${taken ? "" : " interview-layout-single"}`}>
          {/* While topics are only suggested, the numbered cards list them; the side list would repeat them. */}
          {!taken ? null : (
            <aside className="interview-sidebar" aria-label={t`Topics in this conversation`}>
              {progress !== undefined && progress.taken > 0 ? (
                <p className="hint">
                  {progress.done} {t`of`} {progress.taken}{" "}
                  {t`topics finished in this conversation.`}
                </p>
              ) : null}
              <ul className="interview-topic-list">
                {session.topics.map((topic) => (
                  <li
                    key={topic.key}
                    className={`interview-topic-item interview-topic-${topic.status}`}
                    aria-current={topic.key === active?.key ? "step" : undefined}
                  >
                    <span>{careerInterviewTopicTitle(topic)}</span>
                    <small>{careerInterviewTopicStatusLabel(topic.status)}</small>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className="interview-main">
            {session.interviewerAvailable === false && active?.status !== "summarised" ? (
              <p className="interview-unavailable" role="status">
                {careerInterviewUnavailableNotice()}
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
              <Conversation
                topic={active}
                pending={pending}
                speech={speech}
                live={session.liveVoiceAvailable === true ? live : undefined}
                onAction={act}
              />
            )}
            {problemNotice}
            <div className="interview-footer">
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => void act({ action: "pause" })}
              >{t`Pause for now`}</button>
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => void act({ action: "close" })}
              >{t`End this conversation`}</button>
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

/**
 * What the last call's refusal says, and for a missing permission to send answers to Anthropic,
 * a button that records it and tries the same call again.
 */
export function CareerInterviewProblemNotice({
  problem,
  busy,
  allowInterviewer,
  retry,
  onAllowFailed,
}: {
  readonly problem: CareerInterviewProblem;
  readonly busy: boolean;
  readonly allowInterviewer: (() => Promise<string | undefined>) | undefined;
  readonly retry: (() => Promise<boolean>) | undefined;
  readonly onAllowFailed: (message: string) => void;
}) {
  const [allowing, setAllowing] = useState(false);
  if (problem === undefined) return null;
  if (typeof problem === "string") return <p role="alert">{problem}</p>;
  const text = careerInterviewRefusal(problem.code, problem.message);
  if (problem.code !== "consent_required" || allowInterviewer === undefined) {
    return <p role="alert">{text}</p>;
  }
  return (
    <div className="interview-consent" role="alert">
      <p>{text}</p>
      <button
        type="button"
        className="button button-primary"
        disabled={busy || allowing}
        onClick={() => {
          setAllowing(true);
          void allowInterviewer().then(async (failed) => {
            setAllowing(false);
            if (failed !== undefined) onAllowFailed(failed);
            else await retry?.();
          });
        }}
      >{t`Allow and continue`}</button>
    </div>
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
      return t`Suggested`;
    case "declined":
      return t`Not now`;
    case "open":
      return t`Talking now`;
    case "summarised":
      return t`Summary to confirm`;
    case "closed":
      return t`Finished`;
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
            <span className="interview-speaker sr-only">{t`Interviewer`}: </span>
            {/* The screen words the offer itself, in its own language (#2418). */}
            {careerInterviewOffer(topics)}
          </li>
        )}
        {pending?.kind === "interviewer" ? <WritingIndicator /> : null}
      </ol>
      <ol className="interview-topics">
        {topics.map((topic, index) => (
          <li key={topic.key}>
            {/* The interviewer's offer numbers the topics in this same order. */}
            <span className="interview-topic-number" aria-hidden="true">
              {index + 1}
            </span>
            {topic.title === undefined ? (
              <p>{careerInterviewTopicReason(topic)}</p>
            ) : (
              <>
                <p className="interview-topic-name">{careerInterviewTopicTitle(topic)}</p>
                <p className="hint">{careerInterviewTopicReason(topic)}</p>
              </>
            )}
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
      </ol>
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

function Turns({
  turns,
  latest = false,
}: {
  readonly turns: CareerInterviewTopicView["turns"];
  /** Whether a closing interviewer turn is the question being answered now, shown larger. */
  readonly latest?: boolean;
}) {
  const current = latest && turns.at(-1)?.role === "interviewer" ? turns.length - 1 : -1;
  return turns.map((turn, index) => {
    const { speaker, text } = careerInterviewTurnText(turn);
    const kind = `interview-turn interview-turn-${turn.role}`;
    return (
      // Turns are append-only, so their position is a stable key.
      // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
      <li key={index} className={index === current ? `${kind} interview-turn-latest` : kind}>
        <span className="interview-speaker sr-only">{speaker}: </span>
        {text}
      </li>
    );
  });
}

/** The topic's header: its name, and the switch between writing and talking when live is offered. */
function TopicHeader({
  topic,
  talking,
  disabled = false,
  onTalking,
}: {
  readonly topic: CareerInterviewTopicView;
  readonly talking: boolean;
  readonly disabled?: boolean;
  readonly onTalking: ((talking: boolean) => void) | undefined;
}) {
  return (
    <header className="interview-topic-header">
      <div className="interview-topic-heading">
        <h3>{careerInterviewTopicTitle(topic)}</h3>
        {topic.title === undefined ? null : (
          <p className="hint">{careerInterviewTopicReason(topic)}</p>
        )}
      </div>
      {onTalking === undefined ? null : (
        <fieldset className="interview-mode">
          <legend className="sr-only">{t`Answer by`}</legend>
          <button
            type="button"
            aria-pressed={!talking}
            disabled={disabled}
            onClick={() => onTalking(false)}
          >{t`Write`}</button>
          <button
            type="button"
            aria-pressed={talking}
            disabled={disabled}
            onClick={() => onTalking(true)}
          >{t`Speak`}</button>
        </fieldset>
      )}
    </header>
  );
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
  live,
  onAction,
}: {
  readonly topic: CareerInterviewTopicView;
  readonly pending: CareerInterviewPending | undefined;
  readonly speech: SpeechInput | undefined;
  readonly live: CareerInterviewLiveVoice | undefined;
  readonly onAction: (action: CareerInterviewAction) => Promise<boolean>;
}) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  const [talking, setTalking] = useState(false);
  const busy = pending !== undefined;
  const send = () => {
    const text = answer.trim();
    if (text === "" || busy) return;
    void onAction({ action: "answer", topic_key: topic.key, text }).then((saved) => {
      if (saved) setAnswer("");
    });
  };
  if (live !== undefined && talking) {
    return (
      <div className="interview-conversation interview-conversation-live">
        <TopicHeader topic={topic} talking onTalking={setTalking} />
        <CareerInterviewLiveStage
          topicKey={topic.key}
          voice={live}
          question={careerInterviewLatestQuestion(topic)}
          onClose={() => setTalking(false)}
        />
      </div>
    );
  }
  return (
    <div className="interview-conversation">
      <TopicHeader
        topic={topic}
        talking={false}
        disabled={busy}
        onTalking={live === undefined ? undefined : setTalking}
      />
      <ol className="interview-turns" aria-label={t`Conversation`}>
        <Turns turns={topic.turns} latest={pending === undefined} />
        {pending?.kind === "interviewer" && pending.answer !== undefined ? (
          <li className="interview-turn interview-turn-candidate interview-turn-sending">
            <span className="interview-speaker sr-only">{t`You`}: </span>
            {pending.answer}
          </li>
        ) : null}
        {pending?.kind === "interviewer" ? <WritingIndicator /> : null}
      </ol>
      <WrittenAnswer
        id={id}
        topic={topic}
        busy={busy}
        answer={answer}
        setAnswer={setAnswer}
        send={send}
        speech={speech}
        onTalkLive={live === undefined ? undefined : () => setTalking(true)}
        onAction={onAction}
      />
    </div>
  );
}

/** The interviewer's last question on a topic, the one the candidate is answering. */
export function careerInterviewLatestQuestion(topic: CareerInterviewTopicView): string | undefined {
  for (let index = topic.turns.length - 1; index >= 0; index -= 1) {
    const turn = topic.turns[index];
    if (turn?.role === "interviewer" && turn.text.trim() !== "") return turn.text;
  }
  return undefined;
}

function WrittenAnswer({
  id,
  topic,
  busy,
  answer,
  setAnswer,
  send,
  speech,
  onTalkLive,
  onAction,
}: {
  readonly id: string;
  readonly topic: CareerInterviewTopicView;
  readonly busy: boolean;
  readonly answer: string;
  readonly setAnswer: (update: (existing: string) => string) => void;
  readonly send: () => void;
  readonly speech: SpeechInput | undefined;
  readonly onTalkLive: (() => void) | undefined;
  readonly onAction: (action: CareerInterviewAction) => Promise<boolean>;
}) {
  return (
    <>
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
        <label htmlFor={`${id}-answer`} className="sr-only">{t`Your answer`}</label>
        <div className="interview-composer-bar">
          <textarea
            id={`${id}-answer`}
            value={answer}
            maxLength={4_000}
            rows={2}
            placeholder={t`Write your answer. Enter sends, Shift+Enter starts a new line.`}
            onChange={(event) => {
              const value = event.target.value;
              setAnswer(() => value);
            }}
            onKeyDown={(event) => {
              if (
                !careerInterviewSendsOnKey({ ...event, isComposing: event.nativeEvent.isComposing })
              )
                return;
              event.preventDefault();
              send();
            }}
          />
          {/* One toolbar row under the text, like a chat composer: dictation, live talk, send. */}
          <div className="interview-composer-tools">
            {speech === undefined ? null : (
              <SpeechButton
                speech={speech}
                disabled={busy}
                onTranscript={(text) => setAnswer((existing) => appendTranscript(existing, text))}
              />
            )}
            {onTalkLive === undefined ? null : (
              <button
                type="button"
                className="interview-tool interview-talk-live"
                disabled={busy}
                onClick={onTalkLive}
                aria-label={t`Talk live`}
                title={t`Talk live`}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              className="interview-tool interview-send"
              disabled={busy || answer.trim() === ""}
              aria-label={t`Send`}
              title={t`Send`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </>
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
      <TopicHeader topic={topic} talking={false} onTalking={undefined} />
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
