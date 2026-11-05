import type { SpeechLanguage } from "@draft-loop/ui/speech-to-text";

/** The pinned model as the server's manifest names it. */
export interface WhisperModelRef {
  readonly model: string;
  readonly revision: string;
  readonly dtype: string;
}

/** What the page asks the speech worker. Audio is mono at 16 kHz and stays in the browser. */
export interface WhisperRequest {
  readonly kind: "transcribe";
  readonly id: number;
  readonly audio: Float32Array;
  readonly language?: SpeechLanguage | undefined;
  readonly model: WhisperModelRef;
}

export type WhisperReply =
  | { readonly kind: "progress"; readonly id: number; readonly fraction: number }
  | { readonly kind: "done"; readonly id: number; readonly text: string }
  | { readonly kind: "failed"; readonly id: number; readonly message: string };

/** The part of a Worker the engine uses, so tests can stand in for it. */
export interface WhisperWorkerLike {
  postMessage(message: WhisperRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WhisperReply>) => void): void;
}
