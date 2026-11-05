import { SpeechUnavailableError } from "@draft-loop/ui/speech-to-text";
import { describe, expect, it } from "vitest";

import type { WhisperReply, WhisperRequest, WhisperWorkerLike } from "./whisper-protocol.js";
import { createWhisperSpeechToText } from "./whisper-speech.js";

const manifest = { available: true, model: "whisper-base", revision: "abc", dtype: "q8" };

function fakeWorker(answer: (request: WhisperRequest) => WhisperReply[]) {
  const listeners: ((event: MessageEvent<WhisperReply>) => void)[] = [];
  const seen: WhisperRequest[] = [];
  const worker: WhisperWorkerLike = {
    postMessage: (message) => {
      seen.push(message);
      queueMicrotask(() => {
        for (const reply of answer(message)) {
          for (const listener of listeners) listener({ data: reply } as MessageEvent<WhisperReply>);
        }
      });
    },
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  return { worker, seen };
}

describe("the web host's speech to text", () => {
  it("asks the worker for the pinned model, reports progress and returns the text", async () => {
    const { worker, seen } = fakeWorker((request) => [
      { kind: "progress", id: request.id, fraction: 0.5 },
      { kind: "done", id: request.id, text: " I rebuilt the reports. " },
    ]);
    const engine = createWhisperSpeechToText({
      fetchManifest: async () => manifest,
      createWorker: () => worker,
    });
    const progress: number[] = [];
    const text = await engine.transcribe(new Float32Array(16), {
      language: "fr",
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(text).toBe(" I rebuilt the reports. ");
    expect(progress).toEqual([0.5]);
    expect(seen[0]).toMatchObject({
      language: "fr",
      model: { model: "whisper-base", revision: "abc" },
    });
  });

  it("refuses when the server has no model, and passes on a worker failure", async () => {
    const off = createWhisperSpeechToText({
      fetchManifest: async () => ({ ...manifest, available: false }),
      createWorker: () => fakeWorker(() => []).worker,
    });
    await expect(off.transcribe(new Float32Array(1))).rejects.toBeInstanceOf(
      SpeechUnavailableError,
    );
    const failing = createWhisperSpeechToText({
      fetchManifest: async () => manifest,
      createWorker: () =>
        fakeWorker((request) => [{ kind: "failed", id: request.id, message: "no wasm" }]).worker,
    });
    await expect(failing.transcribe(new Float32Array(1))).rejects.toThrow("no wasm");
  });
});
