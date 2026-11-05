import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from "@huggingface/transformers";

import { ortRuntimeFile } from "./ort-runtime.js";
import type { WhisperModelRef, WhisperReply, WhisperRequest } from "./whisper-protocol.js";

/**
 * The speech worker (#2200): Whisper through transformers.js on WebAssembly, off the page's main
 * thread. The model and the ONNX runtime both come from this origin, `/speech-models/` and `/ort/`,
 * never from a model hub or a CDN, and the audio never leaves this worker.
 */
const scope = self as unknown as {
  location: Location;
  postMessage(message: WhisperReply): void;
  onmessage: ((event: MessageEvent<WhisperRequest>) => void) | null;
};

env.allowLocalModels = false;
env.remoteHost = `${scope.location.origin}/speech-models/`;
env.remotePathTemplate = "{model}/{revision}/";
// The runtime loads its factory straight from `/ort/`, not through a blob URL the page's content
// security policy would refuse.
env.useWasmCache = false;
const wasm = env.backends.onnx.wasm;
if (wasm !== undefined) {
  // The WebGPU build of the runtime that transformers.js imports runs on its asyncify variant.
  wasm.wasmPaths = {
    mjs: `${scope.location.origin}/ort/${ortRuntimeFile}.mjs`,
    wasm: `${scope.location.origin}/ort/${ortRuntimeFile}.wasm`,
  };
  // Threads need cross-origin isolation, which the screen does not ask for.
  wasm.numThreads = 1;
}

const languages = { fr: "french", en: "english" } as const;
let loading: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

function load(model: WhisperModelRef, id: number) {
  loading ??= pipeline("automatic-speech-recognition", model.model, {
    revision: model.revision,
    dtype: model.dtype as "q8",
    device: "wasm",
    progress_callback: (info) => {
      if (info.status === "progress_total") {
        scope.postMessage({ kind: "progress", id, fraction: info.progress / 100 });
      }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  return loading;
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    const transcriber = await load(request.model, request.id);
    const output = await transcriber(request.audio, {
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(request.language === undefined ? {} : { language: languages[request.language] }),
    });
    const text = Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text;
    scope.postMessage({ kind: "done", id: request.id, text });
  } catch (error) {
    loading = undefined;
    scope.postMessage({
      kind: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
