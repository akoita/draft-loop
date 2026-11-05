/**
 * Speech to text for the shared screens (#1030, #2200): the port a host provides, and the words
 * around it. The web host runs Whisper in the browser, so audio never leaves the device; the
 * screens only ever receive text, which the candidate edits before anything is sent.
 */

export type SpeechLanguage = "fr" | "en";

/** Whisper's input: mono samples at 16 kHz, as the host's recorder produces them. */
export const speechSampleRate = 16_000;

/** The longest recording a screen accepts, so one answer stays a few paragraphs. */
export const maximumSpeechSeconds = 120;

export interface SpeechTranscribeOptions {
  /** The language spoken; undefined lets the model detect it. */
  readonly language?: SpeechLanguage | undefined;
  /** How much of the model has downloaded, from 0 to 1, the first time only. */
  readonly onProgress?: ((fraction: number) => void) | undefined;
}

/** Turns one recording into text. It never sends audio anywhere. */
export interface SpeechToTextEngine {
  transcribe(audio: Float32Array, options?: SpeechTranscribeOptions): Promise<string>;
}

/** Why speech input cannot be used here, in words for the candidate. */
export class SpeechUnavailableError extends Error {
  override readonly name = "SpeechUnavailableError";
}

// Whisper writes these for silence or noise; they are never the candidate's words.
const nonSpeech =
  /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]|\((?:music|silence|noise|inaudible)\)/giu;

/** The transcript as the candidate should see it: no non-speech markers, single spaces. */
export function speechTranscriptText(raw: string): string {
  return raw.replace(nonSpeech, " ").replace(/\s+/gu, " ").trim();
}

/** Adds a transcript after what the candidate already wrote, within the answer's limit. */
export function appendTranscript(existing: string, transcript: string, limit = 4_000): string {
  const words = speechTranscriptText(transcript);
  if (words === "") return existing;
  const joined = existing.trim() === "" ? words : `${existing.trimEnd()} ${words}`;
  return joined.slice(0, limit);
}

/** Averages a recording's channels into one, the shape Whisper reads. */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const [first] = channels;
  if (first === undefined) return new Float32Array(0);
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (let index = 0; index < mono.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mono[index] = sum / channels.length;
  }
  return mono;
}

/** An engine that answers with fixed transcripts, for tests and previews. */
export function createScriptedSpeechToText(transcripts: readonly string[]): SpeechToTextEngine {
  let call = 0;
  return {
    transcribe: async (_audio, options) => {
      options?.onProgress?.(1);
      const text = transcripts[call] ?? "";
      call += 1;
      return text;
    },
  };
}

/** One recording under way: stop it to get its samples, or cancel it to drop them. */
export interface SpeechRecording {
  /** Mono samples at {@link speechSampleRate}; the audio exists only in this array. */
  stop(): Promise<Float32Array>;
  cancel(): void;
}

export interface SpeechRecordOptions {
  /** Called once the recording reaches its length limit; the screen then stops it. */
  readonly onLimit: () => void;
}

/** The host's microphone. Starting asks the browser's permission the first time. */
export interface SpeechRecorder {
  start(options: SpeechRecordOptions): Promise<SpeechRecording>;
}

/** What a host gives a screen to take an answer by voice. */
export interface SpeechInput {
  readonly recorder: SpeechRecorder;
  readonly engine: SpeechToTextEngine;
  /** Whether voice input works here, such as whether the server has a model; true if absent. */
  readonly available?: () => Promise<boolean>;
  readonly language?: SpeechLanguage | undefined;
}
