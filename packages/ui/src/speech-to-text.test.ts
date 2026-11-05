import { describe, expect, it } from "vitest";

import {
  appendTranscript,
  createScriptedSpeechToText,
  downmixToMono,
  speechTranscriptText,
} from "./speech-to-text.js";

describe("speech to text words", () => {
  it("drops non-speech markers and extra spaces", () => {
    expect(speechTranscriptText("  [BLANK_AUDIO] I rebuilt   the reports. (music) ")).toBe(
      "I rebuilt the reports.",
    );
    expect(speechTranscriptText("[BLANK_AUDIO]")).toBe("");
  });

  it("adds a transcript after the typed answer, within the limit", () => {
    expect(appendTranscript("", " I mentored two analysts. ")).toBe("I mentored two analysts.");
    expect(appendTranscript("First part.", "Second part.")).toBe("First part. Second part.");
    expect(appendTranscript("Kept as typed.", "[BLANK_AUDIO]")).toBe("Kept as typed.");
    expect(appendTranscript("abc", "defgh", 6)).toBe("abc de");
  });

  it("averages channels into one", () => {
    const left = Float32Array.from([1, 0]);
    const right = Float32Array.from([0, 1]);
    expect(Array.from(downmixToMono([left, right]))).toEqual([0.5, 0.5]);
    expect(downmixToMono([left])).toBe(left);
    expect(downmixToMono([])).toHaveLength(0);
  });

  it("scripts transcripts for tests", async () => {
    const engine = createScriptedSpeechToText(["One.", "Two."]);
    const progress: number[] = [];
    expect(
      await engine.transcribe(new Float32Array(1), { onProgress: (p) => progress.push(p) }),
    ).toBe("One.");
    expect(await engine.transcribe(new Float32Array(1))).toBe("Two.");
    expect(progress).toEqual([1]);
  });
});
