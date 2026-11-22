import { t } from "@lingui/core/macro";
import { type FormEvent, useEffect, useId, useState } from "react";

import {
  assistantTurn,
  type HelpLanguage,
  type HelpSupport,
  type HelpTurn,
  maximumHelpQuestionLength,
  memberTurn,
  offersPerson,
  transcriptOf,
} from "./help-ask-model.js";

export interface HelpAskProps {
  readonly support: HelpSupport;
  readonly language: HelpLanguage;
  /** Opens a guide section below, for a source link. */
  readonly onShowSection: (sectionId: string) => void;
}

type Handoff = "idle" | "confirm" | "sending" | "sent";

/**
 * Ask a question in your own words (#2883): the support assistant answers from the guide and the
 * member's account, names its sources, and asks whether that solved it. When it did not, or the
 * assistant says a person is needed, the member may send the conversation to the team, after
 * reading what is sent. Hidden while the host's assistant is off: search does the same then.
 */
export function HelpAsk({ support, language, onShowSection }: HelpAskProps) {
  const id = useId();
  const [conversation, setConversation] = useState<string | null | undefined>(undefined);
  const [turns, setTurns] = useState<readonly HelpTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [solved, setSolved] = useState<"yes" | "no" | null>(null);
  const [handoff, setHandoff] = useState<Handoff>("idle");

  useEffect(() => {
    let current = true;
    support.start().then(
      ({ conversationId, assistantAvailable }) => {
        if (current) setConversation(assistantAvailable ? conversationId : null);
      },
      () => {
        if (current) setConversation(null);
      },
    );
    return () => {
      current = false;
    };
  }, [support]);

  if (conversation === undefined || conversation === null) return null;
  const conversationId = conversation;

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = question.trim();
    if (asked === "" || busy) return;
    const history = transcriptOf(turns);
    const withQuestion = [...turns, memberTurn(asked)];
    setTurns(withQuestion);
    setQuestion("");
    setBusy(true);
    setProblem(undefined);
    setSolved(null);
    try {
      const reply = await support.ask({ conversationId, question: asked, language, history });
      setTurns([
        ...withQuestion,
        assistantTurn(reply, {
          fallbackText: t`I can't answer that myself right now. These guide sections match your question:`,
          noMatchText: t`I can't answer that myself right now, and no guide section matches.`,
          sectionsText: t`Meanwhile, these guide sections may help:`,
          limitText: {
            member_rate: t`You're asking faster than I can keep up. Wait a minute, then ask again.`,
            member_limit: t`You've reached today's questions for the assistant. It answers again tomorrow.`,
            cost_cap: t`The assistant is resting until tomorrow.`,
            question_too_long: t`That question is too long for me. Try it in fewer words.`,
          },
        }),
      ]);
    } catch {
      setProblem(t`Your question could not be sent. Try again in a moment.`);
    } finally {
      setBusy(false);
    }
  }

  async function sendToPerson() {
    if (support.handoff === undefined) return;
    setHandoff("sending");
    setProblem(undefined);
    try {
      await support.handoff({ conversationId, transcript: transcriptOf(turns) });
      setHandoff("sent");
    } catch {
      setHandoff("confirm");
      setProblem(t`The conversation could not be sent. Try again, or use Send feedback.`);
    }
  }

  const answered = turns.at(-1)?.role === "assistant";
  const personOffered =
    support.handoff !== undefined &&
    answered &&
    handoff === "idle" &&
    (solved === "no" || offersPerson(turns));

  return (
    <section className="help-ask" aria-labelledby={`${id}-ask`}>
      <h3 id={`${id}-ask`}>{t`Ask a question`}</h3>
      <p className="help-ask-notice">
        {t`An AI assistant answers from this guide and your account. It can make mistakes.`}
      </p>
      {turns.length === 0 ? null : (
        <ol className="help-ask-turns">
          {turns.map((turn, index) => (
            <li
              // Turns are only ever appended, so their position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
              key={index}
              className={`help-ask-turn help-ask-turn-${turn.role}`}
            >
              <span className="sr-only">{turn.role === "member" ? t`You asked:` : t`Answer:`}</span>
              <p>{turn.text}</p>
              {turn.sources.length === 0 ? null : (
                <p className="help-ask-sources">
                  <span>{turn.fallback ? null : t`From the guide:`}</span>{" "}
                  {turn.sources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className="help-ask-source"
                      onClick={() => onShowSection(source.id)}
                    >
                      {source.title}
                    </button>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="help-search-status" role="status">
        {busy ? t`Looking for an answer…` : (problem ?? null)}
      </p>
      {answered && !busy && solved === null && handoff === "idle" ? (
        <div className="help-ask-solved">
          <span>{t`Did this solve it?`}</span>
          <button type="button" className="button button-toolbar" onClick={() => setSolved("yes")}>
            {t`Yes`}
          </button>
          <button type="button" className="button button-toolbar" onClick={() => setSolved("no")}>
            {t`No`}
          </button>
        </div>
      ) : null}
      {solved === "yes" ? <p className="help-ask-thanks">{t`Glad it helped.`}</p> : null}
      {personOffered ? (
        <button
          type="button"
          className="button button-toolbar"
          onClick={() => setHandoff("confirm")}
        >
          {t`Talk to a person`}
        </button>
      ) : null}
      {handoff === "confirm" || handoff === "sending" ? (
        <div className="help-ask-handoff">
          <p>
            {t`This sends the conversation above to the people who run Redakloop, who will read it and get back to you. It is kept for 90 days.`}
          </p>
          <div className="help-ask-actions">
            <button
              type="button"
              className="button"
              disabled={handoff === "sending"}
              onClick={() => void sendToPerson()}
            >
              {t`Send the conversation`}
            </button>
            <button
              type="button"
              className="button button-toolbar"
              disabled={handoff === "sending"}
              onClick={() => setHandoff("idle")}
            >
              {t`Cancel`}
            </button>
          </div>
        </div>
      ) : null}
      {handoff === "sent" ? (
        <p className="help-ask-thanks" role="status">
          {t`Sent. The people who run Redakloop will read it and get back to you.`}
        </p>
      ) : null}
      <form className="help-ask-form" onSubmit={(event) => void ask(event)}>
        <label className="help-search" htmlFor={`${id}-question`}>
          <span>{turns.length === 0 ? t`Your question` : t`Ask another question`}</span>
          <textarea
            id={`${id}-question`}
            rows={2}
            maxLength={maximumHelpQuestionLength}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <button type="submit" className="button" disabled={busy || question.trim() === ""}>
          {t`Ask`}
        </button>
      </form>
    </section>
  );
}
