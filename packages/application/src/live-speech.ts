/**
 * Live speech for the career interview (#2359): the server-side ports a live voice conversation
 * streams through, and what each minute or character costs. Speech-to-text takes the candidate's
 * audio as it arrives and tells when they finished a turn; text-to-speech speaks one checked
 * question. Adapters own the provider SDKs; nothing here calls a provider.
 */

/** Which company and model heard or spoke, kept with the session like the interviewer's model. */
export interface SpeechProviderIdentity {
  readonly company: string;
  readonly model: string;
  /** Where the audio was processed, such as `eu`; undefined when the provider does not say. */
  readonly region?: string | undefined;
}

export type LiveSpeechLanguage = "fr" | "en";

/** Audio a live recognition accepts: 16-bit little-endian mono PCM at 16 kHz. */
export const liveSpeechSampleRate = 16_000;
const bytesPerSecond = liveSpeechSampleRate * 2;

/** The longest single answer a live turn accepts, as for push-to-talk. */
export const maximumLiveTurnSeconds = 120;

export type LiveTranscriptEvent =
  /** Words so far in the current utterance; a later partial or final replaces them. */
  | { readonly kind: "partial"; readonly text: string }
  /** Words the recogniser will not revise. */
  | { readonly kind: "final"; readonly text: string }
  /** The candidate finished speaking this turn. */
  | { readonly kind: "end_of_turn" };

/** One open recognition: write audio as it arrives, read events, end when the turn is over. */
export interface LiveRecognition {
  write(pcm: Uint8Array): void;
  /** No more audio; the events end after the last final. */
  end(): void;
  /** Stops at once and drops what was not recognised. */
  cancel(): void;
  readonly events: AsyncIterable<LiveTranscriptEvent>;
}

export interface StreamingSpeechToText {
  readonly identity: SpeechProviderIdentity;
  open(options: { readonly language?: LiveSpeechLanguage | undefined }): LiveRecognition;
}

export interface TextToSpeech {
  readonly identity: SpeechProviderIdentity;
  /** Encoded audio chunks (the adapter names the format) for one question. */
  synthesize(
    text: string,
    options: { readonly language?: LiveSpeechLanguage | undefined },
  ): AsyncIterable<Uint8Array>;
  /** The media type of the chunks, such as `audio/ogg; codecs=opus`. */
  readonly mediaType: string;
}

/** A provider's list price for speech, in US dollars. */
export interface SpeechPricing {
  /** Speech-to-text: price per minute of audio sent. */
  readonly usdPerMinute?: number | undefined;
  /** Speech-to-text: audio is billed in whole increments of this many seconds. */
  readonly billingIncrementSeconds?: number | undefined;
  /** Text-to-speech: price per million characters spoken. */
  readonly usdPerMillionCharacters?: number | undefined;
}

/** How many seconds of audio a PCM byte count holds. */
export function liveAudioSeconds(bytes: number): number {
  return bytes / bytesPerSecond;
}

/** What one turn's recognised audio costs, rounded up to the provider's billing increment. */
export function speechToTextCostUsd(audioSeconds: number, pricing: SpeechPricing): number {
  if (pricing.usdPerMinute === undefined || audioSeconds <= 0) return 0;
  const increment = pricing.billingIncrementSeconds ?? 1;
  const billed = Math.ceil(audioSeconds / increment) * increment;
  return (billed / 60) * pricing.usdPerMinute;
}

/** What speaking a text costs; characters are counted as the candidate would read them. */
export function textToSpeechCostUsd(text: string, pricing: SpeechPricing): number {
  if (pricing.usdPerMillionCharacters === undefined) return 0;
  return ([...text].length / 1_000_000) * pricing.usdPerMillionCharacters;
}

/**
 * Reads one turn's events to its end: the final words joined in order, or the last partial when
 * the turn ended before the recogniser finalised it. Partials are only shown, never kept.
 */
export async function collectLiveTurn(
  events: AsyncIterable<LiveTranscriptEvent>,
  onPartial?: (text: string) => void,
): Promise<string> {
  const finals: string[] = [];
  let pending = "";
  for await (const event of events) {
    if (event.kind === "partial") {
      pending = event.text;
      onPartial?.([...finals, pending].join(" ").trim());
    } else if (event.kind === "final") {
      finals.push(event.text.trim());
      pending = "";
      onPartial?.(finals.join(" ").trim());
    } else {
      break;
    }
  }
  return [...finals, pending]
    .filter((part) => part !== "")
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A recogniser that answers each recognition with scripted events, for tests and walks. */
export function createScriptedStreamingSpeechToText(
  turns: readonly (readonly LiveTranscriptEvent[])[],
  identity: SpeechProviderIdentity = { company: "scripted", model: "scripted-stt" },
): StreamingSpeechToText & { readonly receivedBytes: () => number } {
  let call = 0;
  let received = 0;
  return {
    identity,
    receivedBytes: () => received,
    open: () => {
      const script = turns[call] ?? [{ kind: "end_of_turn" }];
      call += 1;
      let ended = false;
      let cancelled = false;
      let wake: (() => void) | undefined;
      return {
        write: (pcm) => {
          if (!ended && !cancelled) received += pcm.byteLength;
        },
        end: () => {
          ended = true;
          wake?.();
        },
        cancel: () => {
          cancelled = true;
          wake?.();
        },
        events: (async function* () {
          // The script plays once the caller ends the audio, as a recogniser finalises at the end.
          while (!ended && !cancelled) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          if (cancelled) return;
          yield* script;
        })(),
      };
    },
  };
}

/** A voice that answers each text with one chunk of its UTF-8 bytes, for tests and walks. */
export function createScriptedTextToSpeech(
  identity: SpeechProviderIdentity = { company: "scripted", model: "scripted-tts" },
): TextToSpeech & { readonly spoken: readonly string[] } {
  const spoken: string[] = [];
  return {
    identity,
    mediaType: "text/plain",
    spoken,
    synthesize: async function* (text) {
      spoken.push(text);
      yield new TextEncoder().encode(text);
    },
  };
}
