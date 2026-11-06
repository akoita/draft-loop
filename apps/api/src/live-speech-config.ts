import {
  createGoogleSpeechClients,
  createGoogleStreamingSpeechToText,
  createGoogleTextToSpeech,
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
  return keyFile === "" ? { mode: "google", projectId } : { mode: "google", projectId, keyFile };
}

/** Builds the live speech the config names; clients sign in through Application Default Credentials. */
export function liveSpeechFrom(config: LiveSpeechConfig): LiveInterviewSpeech | undefined {
  if (config.mode === "off") return undefined;
  const clients = createGoogleSpeechClients({ keyFilename: config.keyFile });
  return {
    stt: createGoogleStreamingSpeechToText({ projectId: config.projectId, clients }),
    tts: createGoogleTextToSpeech({ clients }),
    sttPricing: googleChirp3Pricing,
    ttsPricing: googleChirp3HdPricing,
  };
}
