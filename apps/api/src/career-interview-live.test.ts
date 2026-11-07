import { EventEmitter } from "node:events";

import {
  createScriptedStreamingSpeechToText,
  createScriptedTextToSpeech,
} from "@draft-loop/application/live-speech";
import { describe, expect, it } from "vitest";

import {
  acknowledgementFor,
  type LiveSocket,
  type LiveTurnTiming,
  runLiveInterview,
  spokenParts,
} from "./career-interview-live.js";

class FakeSocket extends EventEmitter implements LiveSocket {
  readonly sent: (string | Uint8Array)[] = [];
  closed: { code?: number; reason?: string } | undefined;
  send(data: string | Uint8Array): void {
    this.sent.push(data);
    const message = typeof data === "string" ? JSON.parse(data) : undefined;
    // The browser ends each turn once the server is ready to listen again.
    if (message?.type === "ready" || (message?.type === "audio_end" && message.more !== true)) {
      setTimeout(() => {
        this.emit("message", new Uint8Array(32_000), true);
        this.emit("message", JSON.stringify({ type: "end_turn" }), false);
      }, 0);
    }
  }
  close(code?: number, reason?: string): void {
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
  }
  messages(): { type: string; [key: string]: unknown }[] {
    return this.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item));
  }
}

const pricing = {
  sttPricing: { usdPerMinute: 0.016 },
  ttsPricing: { usdPerMillionCharacters: 30 },
};

describe("live career interview", () => {
  it("hears a turn, answers through the interviewer and speaks the checked question", async () => {
    const socket = new FakeSocket();
    const tts = createScriptedTextToSpeech();
    const answers: string[] = [];
    const usage = await runLiveInterview({
      socket,
      language: "en",
      speech: {
        stt: createScriptedStreamingSpeechToText([
          [
            { kind: "partial", text: "Hourly" },
            { kind: "final", text: "Hourly updates." },
            { kind: "end_of_turn" },
          ],
          [{ kind: "final", text: "About forty events." }, { kind: "end_of_turn" }],
        ]),
        tts,
        ...pricing,
      },
      answer: async (text) => {
        answers.push(text);
        return answers.length === 1
          ? { view: { step: 1 }, question: "Who used the hourly forecast?", open: true }
          : { view: { step: 2 }, question: undefined, open: false };
      },
      refusal: () => ({ code: "x", message: "x" }),
    });

    expect(answers).toEqual(["Hourly updates.", "About forty events."]);
    expect(tts.spoken).toEqual(["All right.", "Who used the hourly forecast?", "Thank you."]);
    expect(socket.messages().map((message) => message.type)).toEqual([
      "ready",
      "partial",
      "partial",
      "answer",
      "audio_start",
      "audio_end",
      "session",
      "question",
      "audio_start",
      "audio_end",
      "partial",
      "answer",
      "audio_start",
      "audio_end",
      "session",
    ]);
    const clips = socket.messages().filter((message) => message.type.startsWith("audio_"));
    expect(clips[0]).toMatchObject({ kind: "acknowledgement" });
    expect(clips[1]).toEqual({ type: "audio_end", more: true });
    expect(clips[3]).toEqual({ type: "audio_end" });
    expect(socket.sent.some((item) => item instanceof Uint8Array)).toBe(true);
    expect(usage).toMatchObject({ turns: 2, audioSeconds: 2, outcome: "finished" });
    expect(usage.costUsd).toBeGreaterThan(0);
    expect(socket.closed).toEqual({ code: 1000, reason: "finished" });
  });

  it("stops at the session's audio limit", async () => {
    const socket = new FakeSocket();
    const usage = await runLiveInterview({
      socket,
      speech: {
        stt: createScriptedStreamingSpeechToText([]),
        tts: createScriptedTextToSpeech(),
        maximumSessionSeconds: 0.5,
        ...pricing,
      },
      answer: async () => ({ view: {}, question: undefined, open: false }),
      refusal: () => ({ code: "x", message: "x" }),
    });
    expect(usage.outcome).toBe("limit");
    expect(socket.messages().at(-1)).toMatchObject({ type: "error", code: "live_limit_reached" });
  });

  it("sends the refusal when the interviewer refuses", async () => {
    const socket = new FakeSocket();
    const usage = await runLiveInterview({
      socket,
      speech: {
        stt: createScriptedStreamingSpeechToText([
          [{ kind: "final", text: "Yes." }, { kind: "end_of_turn" }],
        ]),
        tts: createScriptedTextToSpeech(),
        ...pricing,
      },
      answer: async () => {
        throw new Error("consent");
      },
      refusal: () => ({ code: "consent_required", message: "Allow it first." }),
    });
    expect(usage.outcome).toBe("failed");
    expect(socket.messages().at(-1)).toEqual({
      type: "error",
      code: "consent_required",
      message: "Allow it first.",
    });
    expect(socket.closed?.code).toBe(1011);
  });

  it("ends quietly when the candidate stops", async () => {
    const socket = new FakeSocket();
    socket.send = function (data) {
      this.sent.push(data);
      if (typeof data === "string" && JSON.parse(data).type === "ready") {
        queueMicrotask(() => this.emit("message", JSON.stringify({ type: "stop" }), false));
      }
    };
    const usage = await runLiveInterview({
      socket,
      speech: {
        stt: createScriptedStreamingSpeechToText([]),
        tts: createScriptedTextToSpeech(),
        ...pricing,
      },
      answer: async () => ({ view: {}, question: undefined, open: false }),
      refusal: () => ({ code: "x", message: "x" }),
    });
    expect(usage.outcome).toBe("stopped");
    expect(socket.closed).toBeUndefined();
  });

  it("opens each turn's recognition only once the candidate's audio arrives", async () => {
    const socket = new FakeSocket();
    socket.send = function (data) {
      this.sent.push(data);
      // The question plays with the microphone muted: no audio for a while, then a stop.
      if (typeof data === "string" && JSON.parse(data).type === "ready") {
        setTimeout(() => this.emit("message", JSON.stringify({ type: "stop" }), false), 5);
      }
    };
    const scripted = createScriptedStreamingSpeechToText([]);
    let opened = 0;
    const usage = await runLiveInterview({
      socket,
      speech: {
        stt: {
          ...scripted,
          open: (request) => {
            opened += 1;
            return scripted.open(request);
          },
        },
        tts: createScriptedTextToSpeech(),
        ...pricing,
      },
      answer: async () => ({ view: {}, question: undefined, open: false }),
      refusal: () => ({ code: "x", message: "x" }),
    });
    expect(usage.outcome).toBe("stopped");
    expect(opened).toBe(0);
  });

  it("speaks a long question sentence by sentence and logs each step's timing (#2409)", async () => {
    const socket = new FakeSocket();
    const tts = createScriptedTextToSpeech();
    const timings: LiveTurnTiming[] = [];
    let clock = 0;
    let answered = 0;
    await runLiveInterview({
      socket,
      language: "fr",
      now: () => clock,
      speech: {
        stt: createScriptedStreamingSpeechToText([
          [{ kind: "final", text: "Des prévisions." }, { kind: "end_of_turn" }],
          [{ kind: "final", text: "Quarante." }, { kind: "end_of_turn" }],
        ]),
        tts,
        ...pricing,
      },
      answer: async () => {
        answered += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        clock += 1_200;
        return answered === 1
          ? {
              view: {},
              question: "Merci pour ces précisions. Qui utilisait la prévision horaire ?",
              open: true,
            }
          : { view: {}, question: undefined, open: false };
      },
      refusal: () => ({ code: "x", message: "x" }),
      onTurn: (timing) => timings.push(timing),
    });

    expect(tts.spoken).toEqual([
      "D'accord.",
      "Merci pour ces précisions.",
      "Qui utilisait la prévision horaire ?",
      "Merci.",
    ]);
    const ends = socket.messages().filter((message) => message.type === "audio_end");
    expect(ends.slice(0, 3)).toEqual([
      { type: "audio_end", more: true },
      { type: "audio_end", more: true },
      { type: "audio_end" },
    ]);
    expect(timings).toEqual([
      {
        turn: 1,
        heardMs: 0,
        interviewerMs: 1_200,
        firstAudioMs: 0,
        questionAudioMs: 0,
        totalMs: 1_200,
      },
    ]);
  });

  it("splits only after a full first sentence and varies the acknowledgement", () => {
    expect(spokenParts("Bien. Et ensuite, qu'avez-vous changé ?")).toEqual([
      "Bien. Et ensuite, qu'avez-vous changé ?",
    ]);
    expect(spokenParts("That makes sense to me. What changed next? And why?")).toEqual([
      "That makes sense to me.",
      "What changed next? And why?",
    ]);
    expect(spokenParts("  ")).toEqual([]);
    expect(acknowledgementFor(0, undefined)).toBe("All right.");
    expect(acknowledgementFor(4, "fr")).toBe("Merci.");
  });
});
