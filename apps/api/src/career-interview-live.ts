import {
  collectLiveTurn,
  type LiveRecognition,
  type LiveSpeechLanguage,
  liveAudioSeconds,
  maximumLiveTurnSeconds,
  type SpeechPricing,
  type StreamingSpeechToText,
  speechToTextCostUsd,
  type TextToSpeech,
  textToSpeechCostUsd,
} from "@draft-loop/application/live-speech";

/**
 * The live career interview's conversation loop (#2361): the candidate's audio streams to
 * speech-to-text; at the end of each turn their words go to the interviewer through the same
 * service as a typed answer, so the method-guide check runs on the question before it is spoken;
 * the question streams back as audio. The socket carries words and audio, the logs only counts.
 */

/** The deployment's live speech: one recogniser and one voice, with their list prices. */
export interface LiveInterviewSpeech {
  readonly stt: StreamingSpeechToText;
  readonly tts: TextToSpeech;
  readonly sttPricing: SpeechPricing;
  readonly ttsPricing: SpeechPricing;
  /** The most audio one live conversation may stream, so a forgotten tab costs little. */
  readonly maximumSessionSeconds?: number;
}

/** The WebSocket as the loop uses it; `ws` sockets satisfy it. */
export interface LiveSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

/** What one interviewer turn returned: its question, and whether the topic is still talked through. */
export interface LiveInterviewTurn {
  /** The session view to show, as the actions route returns it. */
  readonly view: unknown;
  readonly question: string | undefined;
  readonly open: boolean;
}

export interface LiveInterviewOptions {
  readonly socket: LiveSocket;
  readonly speech: LiveInterviewSpeech;
  readonly language?: LiveSpeechLanguage | undefined;
  /** Names from the record the recogniser should expect (#2414). */
  readonly phrases?: readonly string[] | undefined;
  /** Sends one answer to the interviewer, exactly as the actions route does. */
  readonly answer: (text: string) => Promise<LiveInterviewTurn>;
  /** Maps a failure to the refusal the candidate sees; rethrows what it does not know. */
  readonly refusal: (error: unknown) => { readonly code: string; readonly message: string };
  /** Content-free counts for the logs when the conversation ends. */
  readonly onEnd?: (usage: LiveInterviewUsage) => void;
  /** Content-free timings of each answered turn, for the logs (#2409). */
  readonly onTurn?: (timing: LiveTurnTiming) => void;
  /** The clock the timings read; `performance.now` when left out. */
  readonly now?: () => number;
}

/** How long each step of one turn took, in milliseconds; never words or audio. */
export interface LiveTurnTiming {
  readonly turn: number;
  /** From "Done speaking", when pressed, to the recognised words; otherwise absent. */
  readonly heardMs?: number;
  /** The interviewer's call, including the method-guide check and saving the turn. */
  readonly interviewerMs: number;
  /** From the recognised words to the first audio of the acknowledgement or question. */
  readonly firstAudioMs?: number;
  /** From the interviewer's question to its first audio. */
  readonly questionAudioMs?: number;
  /** From the recognised words to the question's last audio. */
  readonly totalMs: number;
}

/**
 * A short spoken acknowledgement played while the interviewer writes (#2409), so the candidate
 * hears at once that they were heard. It varies by turn so it does not sound like a loop.
 */
const acknowledgements: Record<LiveSpeechLanguage, readonly string[]> = {
  fr: ["D'accord.", "Merci.", "Je vois."],
  en: ["All right.", "Thank you.", "I see."],
};

export function acknowledgementFor(turn: number, language: LiveSpeechLanguage | undefined): string {
  const phrases = acknowledgements[language ?? "en"];
  return phrases[turn % phrases.length] ?? "";
}

/**
 * Splits a question into what is spoken first and the rest (#2409): the first sentence is
 * synthesised alone, so it plays while the rest is synthesised. A short opener stays with the
 * sentence after it, so no clip is a single word.
 */
export function spokenParts(text: string): string[] {
  const trimmed = text.trim();
  const boundary = /[.!?\u2026](?:["'\u00bb\u201d)]*)\s+/gu;
  for (const match of trimmed.matchAll(boundary)) {
    const end = match.index + match[0].length;
    if (end < 24) continue;
    const rest = trimmed.slice(end).trim();
    return rest === "" ? [trimmed] : [trimmed.slice(0, end).trim(), rest];
  }
  return trimmed === "" ? [] : [trimmed];
}

export interface LiveInterviewUsage {
  readonly turns: number;
  readonly audioSeconds: number;
  readonly spokenCharacters: number;
  readonly costUsd: number;
  readonly outcome: "finished" | "stopped" | "limit" | "failed";
}

const defaultMaximumSessionSeconds = 30 * 60;

function bytesOf(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data) && data.every((part) => part instanceof Uint8Array)) {
    return Buffer.concat(data as Uint8Array[]);
  }
  return undefined;
}

function controlOf(data: unknown): { readonly type?: unknown } | undefined {
  const bytes = bytesOf(data);
  const text = typeof data === "string" ? data : bytes && new TextDecoder().decode(bytes);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Runs one live conversation on one topic until it closes, the candidate stops, or a limit. */
export async function runLiveInterview(options: LiveInterviewOptions): Promise<LiveInterviewUsage> {
  const { socket, speech } = options;
  const maximumSeconds = speech.maximumSessionSeconds ?? defaultMaximumSessionSeconds;
  const send = (message: object) => socket.send(JSON.stringify(message));
  const now = options.now ?? (() => performance.now());
  let recognition: LiveRecognition | undefined;
  let turnBytes = 0;
  let totalBytes = 0;
  let spokenCharacters = 0;
  let speechCostUsd = 0;
  let turns = 0;
  let stopped = false;
  let limited = false;
  let stopWaiting: (() => void) | undefined;
  // Google closes a recognition stream that gets no audio for a few seconds, and the browser
  // sends none while a question plays. So each turn's stream opens on its first frame; frames
  // that arrive before it is open wait here.
  let waiting: Uint8Array[] | undefined;
  let audioArrived: (() => void) | undefined;
  let endRequested = false;
  let endPressedAt: number | undefined;

  /** Speaks one clip; `more` tells the browser another clip of this turn follows. Returns when its first audio went out. */
  const speak = async (
    text: string,
    clip: { readonly more: boolean; readonly kind?: "acknowledgement" },
  ): Promise<number | undefined> => {
    spokenCharacters += [...text].length;
    speechCostUsd += textToSpeechCostUsd(text, speech.ttsPricing);
    send({
      type: "audio_start",
      media_type: speech.tts.mediaType,
      ...(clip.kind === undefined ? {} : { kind: clip.kind }),
    });
    let first: number | undefined;
    try {
      for await (const chunk of speech.tts.synthesize(text, { language: options.language })) {
        if (stopped) break;
        first ??= now();
        socket.send(chunk);
      }
    } finally {
      send({ type: "audio_end", ...(clip.more ? { more: true } : {}) });
    }
    return first;
  };

  const stop = () => {
    stopped = true;
    recognition?.cancel();
    stopWaiting?.();
  };
  socket.on("close", stop);
  socket.on("message", (data, isBinary) => {
    if (stopped) return;
    if (isBinary) {
      const bytes = bytesOf(data);
      if (bytes === undefined) return;
      if (recognition === undefined) {
        if (waiting === undefined) return;
        waiting.push(bytes);
        audioArrived?.();
        return;
      }
      turnBytes += bytes.byteLength;
      totalBytes += bytes.byteLength;
      if (liveAudioSeconds(totalBytes) > maximumSeconds) {
        limited = true;
        stop();
        return;
      }
      recognition.write(bytes);
      if (liveAudioSeconds(turnBytes) >= maximumLiveTurnSeconds) recognition.end();
      return;
    }
    const control = controlOf(data);
    if (control?.type === "end_turn") {
      endPressedAt ??= now();
      if (recognition !== undefined) recognition.end();
      else if (waiting !== undefined && waiting.length > 0) endRequested = true;
    } else if (control?.type === "stop") stop();
  });

  const usage = (outcome: LiveInterviewUsage["outcome"]): LiveInterviewUsage => {
    const audioSeconds = liveAudioSeconds(totalBytes);
    return {
      turns,
      audioSeconds,
      spokenCharacters,
      costUsd: speechToTextCostUsd(audioSeconds, speech.sttPricing) + speechCostUsd,
      outcome,
    };
  };

  let outcome: LiveInterviewUsage["outcome"] = "finished";
  try {
    send({ type: "ready", heard_by: speech.stt.identity, spoken_by: speech.tts.identity });
    while (!stopped) {
      turnBytes = 0;
      waiting = [];
      endRequested = false;
      endPressedAt = undefined;
      await new Promise<void>((resolve) => {
        audioArrived = resolve;
        stopWaiting = resolve;
      });
      audioArrived = undefined;
      if (stopped) break;
      const early = waiting;
      waiting = undefined;
      const opened = speech.stt.open({ language: options.language, phrases: options.phrases });
      recognition = opened;
      const ended = collectLiveTurn(opened.events, (text) => send({ type: "partial", text }));
      for (const bytes of early) {
        turnBytes += bytes.byteLength;
        totalBytes += bytes.byteLength;
        opened.write(bytes);
      }
      if (liveAudioSeconds(totalBytes) > maximumSeconds) {
        limited = true;
        stop();
      } else if (endRequested || liveAudioSeconds(turnBytes) >= maximumLiveTurnSeconds) {
        opened.end();
      }
      const text = await Promise.race([
        ended,
        new Promise<string>((resolve) => {
          stopWaiting = () => resolve("");
        }),
      ]);
      recognition = undefined;
      if (stopped) break;
      if (text === "") continue;
      const heardAt = now();
      const pressedAt = endPressedAt;
      send({ type: "answer", text });
      // The interviewer starts writing at once; the acknowledgement plays meanwhile.
      const writing = options.answer(text);
      writing.catch(() => {});
      let firstAudioAt: number | undefined;
      try {
        firstAudioAt = await speak(acknowledgementFor(turns, options.language), {
          more: true,
          kind: "acknowledgement",
        });
      } catch {
        // A failed acknowledgement only loses the courtesy; the question still comes.
      }
      const turn = await writing;
      const answeredAt = now();
      turns += 1;
      send({ type: "session", view: turn.view });
      // A closed topic ends the conversation; the socket's close stops the acknowledgement.
      if (!turn.open || turn.question === undefined) break;
      send({ type: "question", text: turn.question });
      const parts = spokenParts(turn.question);
      let questionAudioAt: number | undefined;
      for (const [index, part] of parts.entries()) {
        if (stopped) break;
        const first = await speak(part, { more: index < parts.length - 1 });
        questionAudioAt ??= first;
      }
      if (parts.length === 0) send({ type: "audio_end" });
      firstAudioAt ??= questionAudioAt;
      const spokenAt = now();
      options.onTurn?.({
        turn: turns,
        ...(pressedAt === undefined ? {} : { heardMs: Math.round(heardAt - pressedAt) }),
        interviewerMs: Math.round(answeredAt - heardAt),
        ...(firstAudioAt === undefined ? {} : { firstAudioMs: Math.round(firstAudioAt - heardAt) }),
        ...(questionAudioAt === undefined
          ? {}
          : { questionAudioMs: Math.round(questionAudioAt - answeredAt) }),
        totalMs: Math.round(spokenAt - heardAt),
      });
    }
    outcome = limited ? "limit" : stopped ? "stopped" : "finished";
    if (limited) {
      send({
        type: "error",
        code: "live_limit_reached",
        message: "This live conversation reached its time limit. Start it again to go on.",
      });
    }
  } catch (error) {
    outcome = "failed";
    const refused = options.refusal(error);
    send({ type: "error", ...refused });
  } finally {
    recognition?.cancel();
  }
  const result = usage(outcome);
  options.onEnd?.(result);
  if (!stopped || limited) socket.close(outcome === "failed" ? 1011 : 1000, outcome);
  return result;
}
