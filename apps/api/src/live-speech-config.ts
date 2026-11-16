import {
  createGoogleSpeechClients,
  createGoogleStreamingSpeechToText,
  createGoogleTextToSpeech,
  defaultEndOfTurnPause,
  type EndOfTurnPause,
  googleChirp3HdPricing,
  googleChirp3Pricing,
} from "@draft-loop/model-gateway";

import type { LiveInterviewSpeech } from "./career-interview-live.js";
import { ApiConfigError } from "./config.js";

/** The deployment's live speech choice, read before anything opens. */
export type LiveSpeechConfig =
  | { readonly mode: "off" }
  | {
      readonly mode: "google";
      readonly projectId: string;
      /** A service account key for speech alone; unset, Application Default Credentials. */
      readonly keyFile?: string;
      /** The silence that ends a spoken answer, normally and when it sounds cut off. */
      readonly turnPause: EndOfTurnPause;
    };

/**
 * Reads `DRAFT_LOOP_LIVE_SPEECH` (#2361). Unset or `off`, the live voice conversation is not
 * offered. `google` streams through Google Cloud speech in the EU and needs
 * `DRAFT_LOOP_SPEECH_PROJECT_ID`, the project its recogniser bills to. A self-hosted server sets
 * `DRAFT_LOOP_SPEECH_KEY_FILE` to its service account key; the hosted service signs in as the API.
 */
export function readLiveSpeechConfig(env: NodeJS.ProcessEnv): LiveSpeechConfig {
  const mode = (env.DRAFT_LOOP_LIVE_SPEECH ?? "off").trim();
  if (mode === "" || mode === "off") return { mode: "off" };
  if (mode !== "google") {
    throw new ApiConfigError("DRAFT_LOOP_LIVE_SPEECH must be off or google.");
  }
  const projectId = (env.DRAFT_LOOP_SPEECH_PROJECT_ID ?? "").trim();
  if (projectId === "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_LIVE_SPEECH=google needs DRAFT_LOOP_SPEECH_PROJECT_ID, the Google Cloud project.",
    );
  }
  const keyFile = (env.DRAFT_LOOP_SPEECH_KEY_FILE ?? "").trim();
  const turnPause = readTurnPause(env.DRAFT_LOOP_LIVE_TURN_PAUSE_MS);
  return keyFile === ""
    ? { mode: "google", projectId, turnPause }
    : { mode: "google", projectId, keyFile, turnPause };
}

const turnPauseLimitMs = 15_000;

/**
 * Reads `DRAFT_LOOP_LIVE_TURN_PAUSE_MS` as `normal,unfinished` milliseconds, such as `2500,5000`:
 * the silence that ends an answer, and the longer wait when its last words sound cut off.
 */
function readTurnPause(value: string | undefined): EndOfTurnPause {
  const text = (value ?? "").trim();
  if (text === "") return defaultEndOfTurnPause;
  const parts = text.split(",").map((part) => part.trim());
  const [normalMs, unfinishedMs] = parts.map(Number);
  const valid =
    parts.length === 2 &&
    parts.every((part) => /^\d+$/u.test(part)) &&
    normalMs !== undefined &&
    unfinishedMs !== undefined &&
    normalMs > 0 &&
    unfinishedMs >= normalMs &&
    unfinishedMs <= turnPauseLimitMs;
  if (!valid) {
    throw new ApiConfigError(
      `DRAFT_LOOP_LIVE_TURN_PAUSE_MS must be two whole milliseconds, normal then unfinished, such as 2500,5000, with 0 < normal <= unfinished <= ${turnPauseLimitMs}.`,
    );
  }
  return { normalMs, unfinishedMs };
}

/** Builds the live speech the config names; clients sign in through Application Default Credentials. */
export function liveSpeechFrom(config: LiveSpeechConfig): LiveInterviewSpeech | undefined {
  if (config.mode === "off") return undefined;
  const clients = createGoogleSpeechClients({ keyFilename: config.keyFile });
  return {
    stt: createGoogleStreamingSpeechToText({
      projectId: config.projectId,
      clients,
      endOfTurnPause: config.turnPause,
    }),
    tts: createGoogleTextToSpeech({ clients }),
    sttPricing: googleChirp3Pricing,
    ttsPricing: googleChirp3HdPricing,
  };
}
