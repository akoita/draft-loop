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
} from "./career-interview-model.js";

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
}

export function CareerInterviewPanel({
  session,
  proposal,
  problem,
  knowledgeBases,
  onStart,
  onAction,
  loadConflicts,
}: CareerInterviewPanelProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [actionProblem, setActionProblem] = useState<string | undefined>(undefined);

  async function run(work: () => Promise<string | undefined>) {
    setBusy(true);
    setActionProblem(await work());
    setBusy(false);
  }

  const active = session === undefined ? undefined : careerInterviewActiveTopic(session);
  const proposed = session?.topics.filter((topic) => topic.status === "proposed") ?? [];
  const progress = session === undefined ? undefined : careerInterviewProgress(session);

  return (
    <section className="panel host-panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Career interview</h2>
      <p className="hint">
        Talk through parts of your career your record does not tell yet. You confirm every summary
        before it becomes evidence, and you can stop at any time.
      </p>
      {problem === undefined ? null : <p role="alert">{problem}</p>}
      {actionProblem === undefined ? null : <p role="alert">{actionProblem}</p>}
      {session === undefined || session.status === "closed" ? (
        <button type="button" disabled={busy} onClick={() => void run(onStart)}>
          Start a conversation
        </button>
      ) : (
        <>
          {progress !== undefined && progress.taken > 0 ? (
            <p className="hint">
              {progress.done} of {progress.taken} topics finished in this conversation.
            </p>
          ) : null}
          {active === undefined ? (
            <Proposal
              proposal={proposal}
              topics={proposed}
              busy={busy}
              onAction={(action) => run(() => onAction(action))}
            />
          ) : active.status === "summarised" ? (
            <SummaryReview
              topic={active}
              busy={busy}
              knowledgeBases={knowledgeBases}
              loadConflicts={loadConflicts}
              onAction={(action) => run(() => onAction(action))}
            />
          ) : (
            <Conversation
              topic={active}
              busy={busy}
              onAction={(action) => run(() => onAction(action))}
            />
          )}
          <p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onAction({ action: "pause" }))}
            >
              Pause for now
            </button>
          </p>
          {session.model === undefined ? null : (
            <p className="hint">
              Questions written by {session.model.model} ({session.model.provider}).
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Proposal({
  proposal,
  topics,
  busy,
  onAction,
}: {
  readonly proposal: string | undefined;
  readonly topics: readonly CareerInterviewTopicView[];
  readonly busy: boolean;
  readonly onAction: (action: CareerInterviewAction) => Promise<void>;
}) {
  const id = useId();
  const [subject, setSubject] = useState("");
  return (
    <div>
      {proposal === undefined ? null : <p>{proposal}</p>}
      <ul className="interview-topics">
        {topics.map((topic) => (
          <li key={topic.key}>
            <p>{topic.reason}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAction({ action: "accept", topic_key: topic.key })}
            >
              Talk about this
            </button>{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAction({ action: "decline", topic_key: topic.key })}
            >
              Not now
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (subject.trim() === "") return;
          void onAction({ action: "own_subject", subject: subject.trim() });
          setSubject("");
        }}
      >
        <label htmlFor={`${id}-subject`}>Or something else you would like to talk about</label>
        <input
          id={`${id}-subject`}
          value={subject}
          maxLength={300}
          onChange={(event) => setSubject(event.target.value)}
        />
        <button type="submit" disabled={busy || subject.trim() === ""}>
          Talk about this instead
        </button>
      </form>
    </div>
  );
}

function Conversation({
  topic,
  busy,
  onAction,
}: {
  readonly topic: CareerInterviewTopicView;
  readonly busy: boolean;
  readonly onAction: (action: CareerInterviewAction) => Promise<void>;
}) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  return (
    <div>
      <h3>{topic.reason}</h3>
      <ol className="interview-turns" aria-label="Conversation">
        {topic.turns.map((turn, index) => {
          const { speaker, text } = careerInterviewTurnText(turn);
          return (
            // Turns are append-only, so their position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
            <li key={index} className={`turn turn-${turn.role}`}>
              <strong>{speaker}:</strong> {text}
            </li>
          );
        })}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (answer.trim() === "") return;
          void onAction({ action: "answer", topic_key: topic.key, text: answer.trim() });
          setAnswer("");
        }}
      >
        <label htmlFor={`${id}-answer`}>Your answer</label>
        <textarea
          id={`${id}-answer`}
          value={answer}
          maxLength={4_000}
          rows={4}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <button type="submit" disabled={busy || answer.trim() === ""}>
          Send
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAction({ action: "answer", topic_key: topic.key, mark: "skipped" })}
        >
          Skip this question
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAction({ action: "answer", topic_key: topic.key, mark: "unknown" })}
        >
          I don't remember
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAction({ action: "set_aside", topic_key: topic.key })}
        >
          Set this topic aside
        </button>
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
  readonly onAction: (action: CareerInterviewAction) => Promise<void>;
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
    >
      <h3>{topic.reason}</h3>
      <label htmlFor={`${id}-summary`}>Summary of what you said</label>
      <textarea
        id={`${id}-summary`}
        value={summary}
        rows={5}
        maxLength={4_000}
        onChange={(event) => setSummary(event.target.value)}
      />
      {conflicts.length === 0 ? null : (
        <ul aria-label="Differences from your record">
          {conflicts.map((conflict) => (
            <li key={`${conflict.summaryValue}-${conflict.factValue}`}>
              The summary says {conflict.summaryValue}; your record says {conflict.factValue}. Both
              are kept; edit the summary if one is wrong.
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${id}-base`}>Save to</label>
      <select id={`${id}-base`} value={base} onChange={(event) => setBase(event.target.value)}>
        {knowledgeBases.map((knowledgeBase) => (
          <option key={knowledgeBase.id} value={knowledgeBase.id}>
            {knowledgeBase.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-tier`}>Who may read it</label>
      <select
        id={`${id}-tier`}
        value={tier}
        onChange={(event) => setTier(event.target.value as CareerInterviewTier)}
      >
        <option value="normal">Models may use it in drafts</option>
        <option value="sensitive">Sensitive: only with your consent</option>
        <option value="never-share">Never share with a model</option>
      </select>
      <p>
        <button type="submit" disabled={busy || base === "" || summary.trim() === ""}>
          Confirm as evidence
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAction({ action: "set_aside", topic_key: topic.key })}
        >
          Set aside
        </button>
      </p>
    </form>
  );
}
