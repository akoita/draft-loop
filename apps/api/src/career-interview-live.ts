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
  /** Sends one answer to the interviewer, exactly as the actions route does. */
  readonly answer: (text: string) => Promise<LiveInterviewTurn>;
  /** Maps a failure to the refusal the candidate sees; rethrows what it does not know. */
  readonly refusal: (error: unknown) => { readonly code: string; readonly message: string };
  /** Content-free counts for the logs when the conversation ends. */
  readonly onEnd?: (usage: LiveInterviewUsage) => void;
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
      await new Promise<void>((resolve) => {
        audioArrived = resolve;
        stopWaiting = resolve;
      });
      audioArrived = undefined;
      if (stopped) break;
      const early = waiting;
      waiting = undefined;
      const opened = speech.stt.open({ language: options.language });
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
      send({ type: "answer", text });
      const turn = await options.answer(text);
      turns += 1;
      send({ type: "session", view: turn.view });
      if (!turn.open || turn.question === undefined) break;
      send({ type: "question", text: turn.question });
      spokenCharacters += [...turn.question].length;
      speechCostUsd += textToSpeechCostUsd(turn.question, speech.ttsPricing);
      send({ type: "audio_start", media_type: speech.tts.mediaType });
      for await (const chunk of speech.tts.synthesize(turn.question, {
        language: options.language,
      })) {
        if (stopped) break;
        socket.send(chunk);
      }
      send({ type: "audio_end" });
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
