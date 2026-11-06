import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { careerInterviewRefusal } from "./career-interview-model.js";

/**
 * The live voice conversation on one interview topic (#2362): the candidate talks, sees their
 * words appear as they speak, and hears the next question. The host owns the microphone, the
 * socket and the playback; the session it saves after each turn reaches the panel as usual.
 */

/** Where the live conversation stands, as the candidate sees it. */
export type CareerInterviewLiveState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended";

export interface CareerInterviewLiveEvents {
  readonly onState: (state: CareerInterviewLiveState) => void;
  /** The candidate's words heard so far in this turn. */
  readonly onHeard: (text: string) => void;
  readonly onRefusal: (code: string, message: string) => void;
}

/** One running live conversation. */
export interface CareerInterviewLiveCall {
  /** Sends what was said so far as the answer, without waiting for a pause. */
  readonly endTurn: () => void;
  /** Stops the question being spoken and listens again. */
  readonly skipQuestion: () => void;
  /** Ends the conversation and releases the microphone. */
  readonly stop: () => void;
}

/** The host's live voice, when its server offers it. */
export interface CareerInterviewLiveVoice {
  /** Who hears the candidate's voice, as the consent notice names them. */
  readonly listener: string;
  readonly start: (topicKey: string, events: CareerInterviewLiveEvents) => CareerInterviewLiveCall;
  /** Records the candidate's permission for the listener; resolves with a problem, or undefined. */
  readonly allow: () => Promise<string | undefined>;
}

/** What the live bar says for each state. */
export function careerInterviewLiveStateLabel(state: CareerInterviewLiveState): string {
  switch (state) {
    case "connecting":
      return t`Connecting…`;
    case "listening":
      return t`Listening. Pause when you are done, or press Done speaking.`;
    case "thinking":
      return t`The interviewer is thinking…`;
    case "speaking":
      return t`The interviewer is speaking.`;
    case "ended":
      return t`The live conversation ended.`;
  }
}

/** The words for a live refusal, with the live-only codes the typed screen never sees. */
export function careerInterviewLiveRefusal(code: string, message: string, listener: string) {
  switch (code) {
    case "consent_required":
      return t`Talking live sends your voice to ${listener} to turn it into words and to speak the questions. Allow it below, or keep writing your answers.`;
    case "live_limit_reached":
      return t`This live conversation reached its time limit. Start it again to go on.`;
    case "live_failed":
      return t`The live conversation stopped. Try again, or keep writing your answers.`;
    default:
      return careerInterviewRefusal(code, message);
  }
}

export interface CareerInterviewLiveBarProps {
  readonly topicKey: string;
  readonly voice: CareerInterviewLiveVoice;
  /** Back to the written conversation. */
  readonly onClose: () => void;
}

/** The live conversation's controls, shown instead of the answer box while it runs. */
export function CareerInterviewLiveBar({ topicKey, voice, onClose }: CareerInterviewLiveBarProps) {
  const [state, setState] = useState<CareerInterviewLiveState>("connecting");
  const [heard, setHeard] = useState("");
  const [refusal, setRefusal] = useState<{ code: string; message: string } | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [allowing, setAllowing] = useState(false);
  const call = useRef<CareerInterviewLiveCall | undefined>(undefined);

  useEffect(() => {
    // `attempt` restarts the conversation after the candidate allows it.
    void attempt;
    setState("connecting");
    setHeard("");
    setRefusal(undefined);
    const running = voice.start(topicKey, {
      onState: (next) => {
        setState(next);
        if (next === "thinking" || next === "connecting") setHeard("");
      },
      onHeard: setHeard,
      onRefusal: (code, message) => setRefusal({ code, message }),
    });
    call.current = running;
    return () => {
      running.stop();
      call.current = undefined;
    };
  }, [voice, topicKey, attempt]);

  const live = state !== "ended" && refusal === undefined;
  return (
    <div className={`interview-live interview-live-${state}`}>
      <div className="interview-live-status" role="status" aria-live="polite">
        <span className="interview-live-orb" aria-hidden="true" />
        <span>{careerInterviewLiveStateLabel(state)}</span>
      </div>
      {heard === "" ? null : (
        <p className="interview-turn interview-turn-candidate interview-turn-sending">
          <span className="interview-speaker">{t`You`}</span>
          {heard}
        </p>
      )}
      {refusal === undefined ? null : (
        <p role="alert">
          {careerInterviewLiveRefusal(refusal.code, refusal.message, voice.listener)}
        </p>
      )}
      <div className="interview-actions">
        {refusal?.code === "consent_required" ? (
          <button
            type="button"
            className="button button-primary"
            disabled={allowing}
            onClick={() => {
              setAllowing(true);
              void voice.allow().then((problem) => {
                setAllowing(false);
                if (problem === undefined) setAttempt((count) => count + 1);
                else setRefusal({ code: "allow_failed", message: problem });
              });
            }}
          >{t`Allow ${voice.listener} to hear my voice`}</button>
        ) : null}
        {live && state === "listening" ? (
          <button
            type="button"
            className="button button-primary"
            disabled={heard === ""}
            onClick={() => call.current?.endTurn()}
          >{t`Done speaking`}</button>
        ) : null}
        {live && state === "speaking" ? (
          <button
            type="button"
            className="button button-outline"
            onClick={() => call.current?.skipQuestion()}
          >{t`Answer now`}</button>
        ) : null}
        <button
          type="button"
          className="button button-outline"
          onClick={() => {
            call.current?.stop();
            onClose();
          }}
        >
          {live ? t`End live conversation` : t`Back to writing`}
        </button>
      </div>
    </div>
  );
}
