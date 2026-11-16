import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  createGoogleStreamingSpeechToText,
  createGoogleTextToSpeech,
  type GoogleDuplex,
  type GoogleSpeechClients,
  looksUnfinished,
} from "./google-speech.js";

class FakeDuplex extends EventEmitter {
  readonly written: unknown[] = [];
  ended = false;
  destroyed = false;
  write(message: unknown): boolean {
    // A real stream refuses writes after its end (ERR_STREAM_WRITE_AFTER_END).
    if (this.ended) throw new Error("write after end");
    this.written.push(message);
    return true;
  }
  end(): void {
    if (this.ended) throw new Error("end after end");
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function clients(streams: {
  recognize?: FakeDuplex;
  synthesize?: FakeDuplex;
}): GoogleSpeechClients {
  return {
    streamingRecognize: () => streams.recognize as unknown as GoogleDuplex,
    streamingSynthesize: () => streams.synthesize as unknown as GoogleDuplex,
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("Google speech", () => {
  it("streams Chirp 3 in the EU and ends the turn after silence", async () => {
    const stream = new FakeDuplex();
    const timers: (() => void)[] = [];
    const stt = createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: stream }),
      setTimer: (callback) => timers.push(callback),
      clearTimer: () => undefined,
    });
    expect(stt.identity).toEqual({ company: "google", model: "chirp_3", region: "eu" });

    const recognition = stt.open({ language: "fr" });
    const events = drain(recognition.events);
    recognition.write(new Uint8Array([1, 2]));
    expect(stream.written[0]).toMatchObject({
      recognizer: "projects/fixture-project/locations/eu/recognizers/_",
      streamingConfig: { config: { model: "chirp_3", languageCodes: ["fr-FR"] } },
    });
    expect(stream.written[1]).toEqual({ audio: new Uint8Array([1, 2]) });

    stream.emit("data", { speechEventType: "SPEECH_ACTIVITY_BEGIN" });
    stream.emit("data", { results: [{ alternatives: [{ transcript: "Des mises" }] }] });
    stream.emit("data", {
      results: [{ alternatives: [{ transcript: "Des mises à jour horaires." }], isFinal: true }],
    });
    stream.emit("data", { speechEventType: "SPEECH_ACTIVITY_END" });
    timers[0]?.();
    expect(stream.ended).toBe(true);
    // Microphone frames still on their way, and a late Done speaking, are dropped quietly.
    recognition.write(new Uint8Array([3]));
    recognition.end();
    expect(stream.written).toHaveLength(2);
    stream.emit("data", {
      results: [{ alternatives: [{ transcript: "Et quarante événements." }], isFinal: true }],
    });
    stream.emit("end");

    expect(await events).toEqual([
      { kind: "partial", text: "Des mises" },
      { kind: "final", text: "Des mises à jour horaires." },
      { kind: "final", text: "Et quarante événements." },
      { kind: "end_of_turn" },
    ]);
  });

  it("waits longer when the last words look unfinished", async () => {
    const stream = new FakeDuplex();
    const timers: { callback: () => void; ms: number }[] = [];
    const stt = createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: stream }),
      endOfTurnPause: { normalMs: 2_500, unfinishedMs: 5_000 },
      setTimer: (callback, ms) => timers.push({ callback, ms }),
      clearTimer: () => undefined,
    });
    const recognition = stt.open({ language: "en" });
    const events = drain(recognition.events);
    stream.emit("data", { speechEventType: "SPEECH_ACTIVITY_BEGIN" });
    stream.emit("data", { speechEventType: "SPEECH_ACTIVITY_END" });
    // The final lands after the pause began; it is judged when the normal pause runs out.
    stream.emit("data", {
      results: [{ alternatives: [{ transcript: "I led the migration, but" }], isFinal: true }],
    });
    expect(timers.map((timer) => timer.ms)).toEqual([2_500]);
    timers[0]?.callback();
    expect(stream.ended).toBe(false);
    expect(timers.map((timer) => timer.ms)).toEqual([2_500, 2_500]);
    timers[1]?.callback();
    expect(stream.ended).toBe(true);
    stream.emit("end");
    expect(await events).toContainEqual({ kind: "end_of_turn" });
  });

  it("refuses a pause whose unfinished wait is shorter than the normal one", () => {
    expect(() =>
      createGoogleStreamingSpeechToText({
        projectId: "fixture-project",
        clients: clients({}),
        endOfTurnPause: { normalMs: 3_000, unfinishedMs: 2_000 },
      }),
    ).toThrow(RangeError);
  });

  it("tells a finished sentence from one cut off", () => {
    expect(looksUnfinished("We shipped it in March.", "en")).toBe(false);
    expect(looksUnfinished("Did it work?", "en")).toBe(false);
    expect(looksUnfinished("", "en")).toBe(false);
    expect(looksUnfinished("We shipped it in March", "en")).toBe(true);
    expect(looksUnfinished("We shipped it and...", "en")).toBe(true);
    expect(looksUnfinished("We shipped it because.", "en")).toBe(true);
    expect(looksUnfinished("On a livré en mars parce que.", "fr")).toBe(true);
    expect(looksUnfinished("J'ai géré l'équipe, mais", "fr")).toBe(true);
    expect(looksUnfinished("On a livré en mars.", "fr")).toBe(false);
    // An unknown language checks both lists.
    expect(looksUnfinished("Nous avons livré et.")).toBe(true);
    expect(looksUnfinished("We shipped and.")).toBe(true);
  });

  it("lets the language be detected and drops a cancelled turn", async () => {
    const stream = new FakeDuplex();
    const stt = createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: stream }),
    });
    const recognition = stt.open({});
    expect(stream.written[0]).toMatchObject({
      streamingConfig: { config: { languageCodes: ["auto"] } },
    });
    const events = drain(recognition.events);
    recognition.cancel();
    expect(await events).toEqual([]);
    expect(stream.destroyed).toBe(true);
  });

  it("hints the record's names to recognition, and sends no adaptation without any", () => {
    const stream = new FakeDuplex();
    const stt = createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: stream }),
    });
    stt.open({ phrases: ["Example Bank"] });
    expect(stream.written[0]).toMatchObject({
      streamingConfig: {
        config: {
          adaptation: {
            phraseSets: [{ inlinePhraseSet: { phrases: [{ value: "Example Bank", boost: 10 }] } }],
          },
        },
      },
    });
    const bare = new FakeDuplex();
    createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: bare }),
    }).open({ phrases: [] });
    expect(JSON.stringify(bare.written[0])).not.toContain("adaptation");
  });

  it("passes a stream error to the reader", async () => {
    const stream = new FakeDuplex();
    const stt = createGoogleStreamingSpeechToText({
      projectId: "fixture-project",
      clients: clients({ recognize: stream }),
    });
    const events = drain(stt.open({}).events);
    stream.emit("error", new Error("unavailable"));
    await expect(events).rejects.toThrow("unavailable");
  });

  it("refuses a missing project", () => {
    expect(() =>
      createGoogleStreamingSpeechToText({ projectId: " ", clients: clients({}) }),
    ).toThrow(RangeError);
  });

  it("speaks a question with a Chirp 3 HD voice as Ogg Opus", async () => {
    const stream = new FakeDuplex();
    const tts = createGoogleTextToSpeech({ clients: clients({ synthesize: stream }) });
    const chunks = drain(tts.synthesize("Qui l'utilisait ?", { language: "fr" }));
    expect(stream.written).toEqual([
      {
        streamingConfig: {
          voice: { languageCode: "fr-FR", name: "fr-FR-Chirp3-HD-Charon" },
          streamingAudioConfig: { audioEncoding: "OGG_OPUS", sampleRateHertz: 24_000 },
        },
      },
      { input: { text: "Qui l'utilisait ?" } },
    ]);
    stream.emit("data", { audioContent: new Uint8Array([9]) });
    stream.emit("data", { audioContent: new Uint8Array([]) });
    stream.emit("end");
    expect(await chunks).toEqual([new Uint8Array([9])]);
    expect(tts.mediaType).toBe("audio/ogg; codecs=opus");
  });
});
