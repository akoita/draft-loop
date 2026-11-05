import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpeechButton, speechProblem, transcribeRecording } from "./speech-button.js";
import {
  createScriptedSpeechToText,
  type SpeechInput,
  type SpeechRecording,
  SpeechUnavailableError,
} from "./speech-to-text.js";

function recordingOf(samples: Float32Array): SpeechRecording & { stopped: number } {
  const recording = {
    stopped: 0,
    stop: async () => {
      recording.stopped += 1;
      return samples;
    },
    cancel: () => {},
  };
  return recording;
}

const speechSaying = (...transcripts: string[]): SpeechInput => ({
  recorder: { start: async () => recordingOf(new Float32Array(16)) },
  engine: createScriptedSpeechToText(transcripts),
});

describe("speech button", () => {
  it("offers to answer by voice when the host gives speech input", () => {
    const html = renderToStaticMarkup(
      <SpeechButton speech={speechSaying("hello")} onTranscript={() => {}} />,
    );
    expect(html).toContain("Answer by voice");
  });

  it("shows nothing until the host says voice input works here", () => {
    const speech = { ...speechSaying("hello"), available: async () => true };
    expect(renderToStaticMarkup(<SpeechButton speech={speech} onTranscript={() => {}} />)).toBe("");
  });

  it("stops the recording and returns the cleaned transcript", async () => {
    const recording = recordingOf(new Float32Array(16));
    const result = await transcribeRecording(
      speechSaying("[BLANK_AUDIO] I led the  migration."),
      recording,
      () => {},
    );
    expect(recording.stopped).toBe(1);
    expect(result).toEqual({ text: "I led the migration." });
  });

  it("reports silence instead of an empty transcript", async () => {
    const result = await transcribeRecording(
      speechSaying("[BLANK_AUDIO]"),
      recordingOf(new Float32Array(16)),
      () => {},
    );
    expect(result).toEqual({
      problem: "No words were heard. Try again closer to the microphone.",
    });
  });

  it("explains refused microphones and missing models in plain words", async () => {
    const refused = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    expect(speechProblem(refused)).toMatch(/refused the microphone/);
    expect(speechProblem(new SpeechUnavailableError("No model here."))).toBe("No model here.");
    const failing: SpeechInput = {
      ...speechSaying(),
      engine: {
        transcribe: async () => {
          throw new Error("worker crashed");
        },
      },
    };
    expect(await transcribeRecording(failing, recordingOf(new Float32Array(1)), () => {})).toEqual({
      problem: "Voice input failed. Type your answer instead, or try again.",
    });
  });
});
