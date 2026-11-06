import { describe, expect, it } from "vitest";

import {
  collectLiveTurn,
  createScriptedStreamingSpeechToText,
  createScriptedTextToSpeech,
  type LiveTranscriptEvent,
  liveAudioSeconds,
  speechToTextCostUsd,
  textToSpeechCostUsd,
} from "./live-speech.js";

async function* stream(events: readonly LiveTranscriptEvent[]) {
  yield* events;
}

describe("live speech", () => {
  it("joins a turn's finals and shows growing partials", async () => {
    const shown: string[] = [];
    const text = await collectLiveTurn(
      stream([
        { kind: "partial", text: "I led" },
        { kind: "final", text: "I led the forecast work." },
        { kind: "partial", text: "It ran" },
        { kind: "final", text: "It ran hourly." },
        { kind: "end_of_turn" },
        { kind: "final", text: "never read" },
      ]),
      (partial) => shown.push(partial),
    );
    expect(text).toBe("I led the forecast work. It ran hourly.");
    expect(shown).toEqual([
      "I led",
      "I led the forecast work.",
      "I led the forecast work. It ran",
      "I led the forecast work. It ran hourly.",
    ]);
  });

  it("keeps the last partial when the turn ends before a final", async () => {
    expect(await collectLiveTurn(stream([{ kind: "partial", text: "About forty" }]))).toBe(
      "About forty",
    );
  });

  it("prices recognised audio in billing increments and spoken characters", () => {
    expect(liveAudioSeconds(32_000 * 10)).toBe(10);
    expect(speechToTextCostUsd(61, { usdPerMinute: 0.016 })).toBeCloseTo(0.016 * (61 / 60));
    expect(
      speechToTextCostUsd(16, { usdPerMinute: 0.016, billingIncrementSeconds: 15 }),
    ).toBeCloseTo(0.016 * 0.5);
    expect(speechToTextCostUsd(0, { usdPerMinute: 0.016 })).toBe(0);
    expect(textToSpeechCostUsd("é".repeat(1_000), { usdPerMillionCharacters: 30 })).toBeCloseTo(
      0.03,
    );
    expect(textToSpeechCostUsd("free", {})).toBe(0);
  });

  it("plays a scripted turn once the audio ends, and nothing when cancelled", async () => {
    const stt = createScriptedStreamingSpeechToText([
      [{ kind: "final", text: "Hourly updates." }, { kind: "end_of_turn" }],
      [{ kind: "final", text: "unused" }],
    ]);
    const first = stt.open({ language: "en" });
    first.write(new Uint8Array(640));
    const turn = collectLiveTurn(first.events);
    first.end();
    expect(await turn).toBe("Hourly updates.");
    expect(stt.receivedBytes()).toBe(640);

    const second = stt.open({});
    const dropped = collectLiveTurn(second.events);
    second.cancel();
    expect(await dropped).toBe("");
  });

  it("speaks scripted questions and records what it said", async () => {
    const tts = createScriptedTextToSpeech();
    const chunks: Uint8Array[] = [];
    for await (const chunk of tts.synthesize("Who used it?", { language: "en" }))
      chunks.push(chunk);
    expect(new TextDecoder().decode(chunks[0])).toBe("Who used it?");
    expect(tts.spoken).toEqual(["Who used it?"]);
  });
});
