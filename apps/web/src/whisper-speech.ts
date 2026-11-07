import {
  type SpeechToTextEngine,
  type SpeechTranscribeOptions,
  SpeechUnavailableError,
} from "@draft-loop/ui/speech-to-text";
import { t } from "@lingui/core/macro";

import type { WhisperModelRef, WhisperReply, WhisperWorkerLike } from "./whisper-protocol.js";

/**
 * The web host's speech to text (#2200): asks the server which pinned model it serves, then runs it
 * in a worker. Nothing is downloaded until the candidate first records, and nothing but the model
 * files crosses the network.
 */

export interface WhisperSpeechOptions {
  readonly fetchManifest?: () => Promise<{ readonly available: boolean } & WhisperModelRef>;
  readonly createWorker?: () => WhisperWorkerLike;
}

const defaultManifest = async () => {
  const response = await fetch("/speech-models/manifest.json");
  if (!response.ok)
    throw new SpeechUnavailableError(t`Voice input is not available on this server.`);
  return (await response.json()) as { available: boolean } & WhisperModelRef;
};

/** Whether the server serves a speech model, read without downloading any of it. */
export async function speechModelAvailable(): Promise<boolean> {
  try {
    return (await defaultManifest()).available;
  } catch {
    return false;
  }
}

const defaultWorker = (): WhisperWorkerLike =>
  new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });

export function createWhisperSpeechToText(options: WhisperSpeechOptions = {}): SpeechToTextEngine {
  const fetchManifest = options.fetchManifest ?? defaultManifest;
  const createWorker = options.createWorker ?? defaultWorker;
  let worker: WhisperWorkerLike | undefined;
  let model: Promise<WhisperModelRef> | undefined;
  let next = 1;
  const waiting = new Map<
    number,
    {
      resolve: (text: string) => void;
      reject: (error: Error) => void;
      options?: SpeechTranscribeOptions;
    }
  >();

  const modelRef = () => {
    model ??= fetchManifest().then((manifest) => {
      if (!manifest.available) {
        throw new SpeechUnavailableError(
          t`This server has no speech model installed, so voice input is off.`,
        );
      }
      return { model: manifest.model, revision: manifest.revision, dtype: manifest.dtype };
    });
    model.catch(() => {
      model = undefined;
    });
    return model;
  };

  const started = () => {
    if (worker !== undefined) return worker;
    const created = createWorker();
    created.addEventListener("message", (event) => {
      const reply: WhisperReply = event.data;
      const pending = waiting.get(reply.id);
      if (pending === undefined) return;
      if (reply.kind === "progress") {
        pending.options?.onProgress?.(reply.fraction);
        return;
      }
      waiting.delete(reply.id);
      if (reply.kind === "done") pending.resolve(reply.text);
      else pending.reject(new Error(`Voice input failed: ${reply.message}`));
    });
    worker = created;
    return created;
  };

  return {
    transcribe: async (audio, transcribeOptions) => {
      const ref = await modelRef();
      const id = next;
      next += 1;
      return new Promise<string>((resolve, reject) => {
        waiting.set(id, {
          resolve,
          reject,
          ...(transcribeOptions === undefined ? {} : { options: transcribeOptions }),
        });
        started().postMessage(
          { kind: "transcribe", id, audio, language: transcribeOptions?.language, model: ref },
          [audio.buffer],
        );
      });
    },
  };
}
