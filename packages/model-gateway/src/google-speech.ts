import { v2 as speechV2 } from "@google-cloud/speech";
import { v1 as textToSpeechV1 } from "@google-cloud/text-to-speech";

/**
 * Google Cloud speech in the EU (#2360): Chirp 3 streaming recognition and Chirp 3 HD voices for
 * the live career interview, on the `eu` endpoints. On the hosted service the clients sign in as
 * the API's service account through Application Default Credentials, so no key exists; a
 * self-hosted server names its own key file for speech alone.
 *
 * The types below are structurally the `StreamingSpeechToText` and `TextToSpeech` ports of
 * `@draft-loop/application/live-speech`, which this package cannot import.
 */

export interface GoogleSpeechIdentity {
  readonly company: "google";
  readonly model: string;
  readonly region: "eu";
}

export type GoogleLiveTranscriptEvent =
  | { readonly kind: "partial"; readonly text: string }
  | { readonly kind: "final"; readonly text: string }
  | { readonly kind: "end_of_turn" };

export interface GoogleLiveRecognition {
  write(pcm: Uint8Array): void;
  end(): void;
  cancel(): void;
  readonly events: AsyncIterable<GoogleLiveTranscriptEvent>;
}

type Language = "fr" | "en";

/** Chirp 3's list prices: US$0.016 a minute of streamed audio, US$30 a million HD characters. */
export const googleChirp3Pricing = { usdPerMinute: 0.016, billingIncrementSeconds: 1 } as const;
export const googleChirp3HdPricing = { usdPerMillionCharacters: 30 } as const;

export const googleSpeechModel = "chirp_3";
export const googleVoiceModel = "chirp3-hd";
const location = "eu";
const speechEndpoint = "eu-speech.googleapis.com";
const textToSpeechEndpoint = "eu-texttospeech.googleapis.com";

// Google ends a stream after five minutes. One recognition is one answer, at most two minutes,
// so a recognition never reaches that limit.

/** The duplex stream a gax streaming call returns, as far as these adapters use it. */
export interface GoogleDuplex {
  write(message: unknown): boolean;
  end(): void;
  cancel?: () => void;
  destroy(error?: Error): void;
  on(event: "data", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "end", listener: () => void): this;
}

export interface GoogleSpeechClients {
  readonly streamingRecognize: () => GoogleDuplex;
  readonly streamingSynthesize: () => GoogleDuplex;
}

/**
 * The real clients on the EU endpoints, signed in through Application Default Credentials, or
 * with a service account key file a self-hosted server names for speech alone.
 */
export function createGoogleSpeechClients(
  options: { readonly keyFilename?: string | undefined } = {},
): GoogleSpeechClients {
  const credentials = options.keyFilename === undefined ? {} : { keyFilename: options.keyFilename };
  const speech = new speechV2.SpeechClient({ apiEndpoint: speechEndpoint, ...credentials });
  const voice = new textToSpeechV1.TextToSpeechClient({
    apiEndpoint: textToSpeechEndpoint,
    ...credentials,
  });
  return {
    streamingRecognize: () => speech._streamingRecognize() as unknown as GoogleDuplex,
    streamingSynthesize: () => voice.streamingSynthesize() as unknown as GoogleDuplex,
  };
}

const languageCodes: Readonly<Record<Language, string>> = { fr: "fr-FR", en: "en-US" };

interface RecognitionResponse {
  readonly results?: readonly {
    readonly alternatives?: readonly { readonly transcript?: string | null }[] | null;
    readonly isFinal?: boolean | null;
  }[];
  readonly speechEventType?: string | number | null;
}

/** An async queue the stream's callbacks push into and the caller reads from. */
function eventQueue<T>() {
  const items: T[] = [];
  let done = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(item: T) {
      if (done) return;
      items.push(item);
      notify();
    },
    close(error?: Error) {
      if (done) return;
      done = true;
      failure = error;
      notify();
    },
    async *read(): AsyncGenerator<T> {
      while (true) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (done) {
          if (failure !== undefined) throw failure;
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

export interface GoogleStreamingSpeechToTextOptions {
  readonly projectId: string;
  readonly clients: GoogleSpeechClients;
  /** Silence after speech that ends the candidate's turn; the default suits a thoughtful answer. */
  readonly endOfTurnSilenceMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

/** Chirp 3 streaming recognition in the EU, with partial words and a silence-based end of turn. */
export function createGoogleStreamingSpeechToText(options: GoogleStreamingSpeechToTextOptions): {
  readonly identity: GoogleSpeechIdentity;
  open(request: { readonly language?: Language | undefined }): GoogleLiveRecognition;
} {
  if (options.projectId.trim() === "") throw new RangeError("A Google Cloud project is required.");
  const silenceMs = options.endOfTurnSilenceMs ?? 1_500;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const recognizer = `projects/${options.projectId}/locations/${location}/recognizers/_`;

  return {
    identity: { company: "google", model: googleSpeechModel, region: location },
    open: (request) => {
      const queue = eventQueue<GoogleLiveTranscriptEvent>();
      const stream = options.clients.streamingRecognize();
      let silence: unknown;
      let finished = false;
      // Once the audio is ended, Google may still send its last finals, but the stream refuses
      // more writes; microphone frames that arrive in between are dropped.
      let audioEnded = false;
      const endAudio = () => {
        if (finished || audioEnded) return;
        audioEnded = true;
        stream.end();
      };
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        if (silence !== undefined) clearTimer(silence);
        if (error === undefined) queue.push({ kind: "end_of_turn" });
        queue.close(error);
      };

      stream.on("data", (message) => {
        const response = message as RecognitionResponse;
        const event = String(response.speechEventType ?? "");
        if (event === "SPEECH_ACTIVITY_BEGIN" || event === "2") {
          if (silence !== undefined) clearTimer(silence);
          silence = undefined;
        } else if (event === "SPEECH_ACTIVITY_END" || event === "3") {
          // Ending the audio lets Google send its last finals; the stream's end closes the turn.
          silence = setTimer(endAudio, silenceMs);
        }
        for (const result of response.results ?? []) {
          const text = result.alternatives?.[0]?.transcript?.trim() ?? "";
          if (text === "") continue;
          queue.push({ kind: result.isFinal === true ? "final" : "partial", text });
        }
      });
      stream.on("error", (error) => finish(error));
      stream.on("end", () => finish());

      stream.write({
        recognizer,
        streamingConfig: {
          config: {
            explicitDecodingConfig: {
              encoding: "LINEAR16",
              sampleRateHertz: 16_000,
              audioChannelCount: 1,
            },
            model: googleSpeechModel,
            languageCodes:
              request.language === undefined ? ["auto"] : [languageCodes[request.language]],
            features: { enableAutomaticPunctuation: true },
          },
          streamingFeatures: { interimResults: true, enableVoiceActivityEvents: true },
        },
      });

      return {
        write: (pcm) => {
          if (!finished && !audioEnded) stream.write({ audio: pcm });
        },
        end: endAudio,
        cancel: () => {
          if (finished) return;
          finished = true;
          if (silence !== undefined) clearTimer(silence);
          stream.cancel?.();
          stream.destroy();
          queue.close();
        },
        events: queue.read(),
      };
    },
  };
}

export interface GoogleTextToSpeechOptions {
  readonly clients: GoogleSpeechClients;
  /** A Chirp 3 HD voice name without its locale, such as `Charon`. */
  readonly voice?: string;
}

interface SynthesizeResponse {
  readonly audioContent?: Uint8Array | string | null;
}

/** Chirp 3 HD voices in the EU, streamed as Ogg Opus the browser plays as it arrives. */
export function createGoogleTextToSpeech(options: GoogleTextToSpeechOptions): {
  readonly identity: GoogleSpeechIdentity;
  readonly mediaType: string;
  synthesize(
    text: string,
    request: { readonly language?: Language | undefined },
  ): AsyncIterable<Uint8Array>;
} {
  const voice = options.voice ?? "Charon";
  return {
    identity: { company: "google", model: googleVoiceModel, region: location },
    mediaType: "audio/ogg; codecs=opus",
    synthesize: (text, request) => {
      const queue = eventQueue<Uint8Array>();
      const stream = options.clients.streamingSynthesize();
      const languageCode = languageCodes[request.language ?? "en"];
      stream.on("data", (message) => {
        const audio = (message as SynthesizeResponse).audioContent;
        if (audio === undefined || audio === null || audio.length === 0) return;
        queue.push(typeof audio === "string" ? Buffer.from(audio, "base64") : audio);
      });
      stream.on("error", (error) => queue.close(error));
      stream.on("end", () => queue.close());
      stream.write({
        streamingConfig: {
          voice: { languageCode, name: `${languageCode}-Chirp3-HD-${voice}` },
          streamingAudioConfig: { audioEncoding: "OGG_OPUS", sampleRateHertz: 24_000 },
        },
      });
      stream.write({ input: { text } });
      stream.end();
      return queue.read();
    },
  };
}
