import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import {
  type SpeechInput,
  type SpeechRecording,
  SpeechUnavailableError,
  speechTranscriptText,
} from "./speech-to-text.js";

/**
 * The microphone button beside an answer box (#2201): record, transcribe on this device, and hand
 * the text to the box for the candidate to edit before sending. The audio lives only in memory
 * until the transcript is made, and is never sent or kept.
 */

export interface SpeechButtonProps {
  readonly speech: SpeechInput;
  readonly disabled?: boolean;
  /** Receives the transcript of one recording; never called with empty text. */
  readonly onTranscript: (text: string) => void;
}

type SpeechButtonState =
  | { readonly step: "idle" }
  | { readonly step: "recording"; readonly recording: SpeechRecording }
  | { readonly step: "transcribing"; readonly loaded: number | undefined };

/** What to tell the candidate when recording or transcribing failed. */
export function speechProblem(error: unknown): string {
  if (error instanceof SpeechUnavailableError) return error.message;
  if (error instanceof Error && error.name === "NotAllowedError") {
    return t`The browser refused the microphone. Allow it for this site to answer by voice.`;
  }
  if (error instanceof Error && error.name === "NotFoundError") {
    return t`No microphone was found on this device.`;
  }
  return t`Voice input failed. Type your answer instead, or try again.`;
}

/**
 * Stops a recording and transcribes it: the transcript to put in the box, or a problem to show.
 * The samples go out of reach when this returns.
 */
export async function transcribeRecording(
  speech: SpeechInput,
  recording: SpeechRecording,
  onProgress: (fraction: number) => void,
): Promise<{ readonly text: string } | { readonly problem: string }> {
  try {
    const audio = await recording.stop();
    const text = speechTranscriptText(
      await speech.engine.transcribe(audio, { language: speech.language, onProgress }),
    );
    return text === ""
      ? { problem: t`No words were heard. Try again closer to the microphone.` }
      : { text };
  } catch (error) {
    return { problem: speechProblem(error) };
  }
}

export function SpeechButton({ speech, disabled = false, onTranscript }: SpeechButtonProps) {
  const [available, setAvailable] = useState(speech.available === undefined);
  const [state, setState] = useState<SpeechButtonState>({ step: "idle" });
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const recordingRef = useRef<SpeechRecording | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void speech
      .available?.()
      .then((found) => {
        if (current) setAvailable(found);
      })
      .catch(() => {
        if (current) setAvailable(false);
      });
    return () => {
      current = false;
    };
  }, [speech]);

  // Leaving the screen mid-recording drops the audio and releases the microphone.
  useEffect(() => () => recordingRef.current?.cancel(), []);

  if (!available) return null;

  async function finish(recording: SpeechRecording) {
    recordingRef.current = undefined;
    setState({ step: "transcribing", loaded: undefined });
    const result = await transcribeRecording(speech, recording, (fraction) =>
      setState({ step: "transcribing", loaded: fraction }),
    );
    if ("text" in result) onTranscript(result.text);
    else setProblem(result.problem);
    setState({ step: "idle" });
  }

  async function start() {
    setProblem(undefined);
    try {
      const recording = await speech.recorder.start({
        onLimit: () => {
          if (recordingRef.current === recording) void finish(recording);
        },
      });
      recordingRef.current = recording;
      setState({ step: "recording", recording });
    } catch (error) {
      setProblem(speechProblem(error));
    }
  }

  return (
    <span className="speech-input">
      {state.step === "recording" ? (
        <>
          <span role="status">{t`Recording… speak your answer.`}</span>
          <button
            type="button"
            className="button button-primary"
            aria-pressed="true"
            onClick={() => void finish(state.recording)}
          >{t`Stop and transcribe`}</button>
          <button
            type="button"
            className="button button-outline"
            onClick={() => {
              recordingRef.current = undefined;
              state.recording.cancel();
              setState({ step: "idle" });
            }}
          >{t`Discard recording`}</button>
        </>
      ) : state.step === "transcribing" ? (
        <span role="status">
          {state.loaded === undefined || state.loaded >= 1
            ? t`Turning your words into text on this device…`
            : t`Getting voice input ready (${Math.round(state.loaded * 100)}%)…`}
        </span>
      ) : (
        <button
          type="button"
          className="speech-input-start"
          disabled={disabled}
          onClick={() => void start()}
          aria-label={t`Answer by voice`}
          title={t`Answer by voice`}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
      )}
      {problem === undefined ? null : <span role="alert">{problem}</span>}
    </span>
  );
}
