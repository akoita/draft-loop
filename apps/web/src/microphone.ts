import {
  downmixToMono,
  maximumSpeechSeconds,
  type SpeechRecorder,
  type SpeechRecording,
  SpeechUnavailableError,
  speechSampleRate,
} from "@draft-loop/ui/speech-to-text";
import { t } from "@lingui/core/macro";

/**
 * The web host's microphone (#2201): records one answer with the browser's MediaRecorder, then
 * decodes it to 16 kHz mono for Whisper. The audio stays in this page's memory, and the
 * microphone is released as soon as a recording stops or is dropped.
 */

/** The parts of the browser the recorder uses, replaceable in tests. */
export interface MicrophoneBrowser {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly createRecorder: (stream: MediaStream) => MediaRecorder;
  /** Decodes a recording's bytes into channels of samples at 16 kHz. */
  readonly decode: (bytes: ArrayBuffer) => Promise<readonly Float32Array[]>;
  readonly setTimeout: (run: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

async function decodeAt16kHz(bytes: ArrayBuffer): Promise<readonly Float32Array[]> {
  // An offline context resamples to its own rate and needs no audio output device.
  const context = new OfflineAudioContext(1, 1, speechSampleRate);
  const buffer = await context.decodeAudioData(bytes);
  return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
}

function browserMicrophone(): MicrophoneBrowser {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream) => new MediaRecorder(stream),
    decode: decodeAt16kHz,
    setTimeout: (run, milliseconds) => globalThis.setTimeout(run, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  };
}

/** Whether this browser can record at all. */
export function microphoneSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

export function createMicrophoneRecorder(
  browser: MicrophoneBrowser = browserMicrophone(),
): SpeechRecorder {
  return {
    start: async ({ onLimit }) => {
      const stream = await browser.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const recorder = browser.createRecorder(stream);
      let chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      const timer = browser.setTimeout(onLimit, maximumSpeechSeconds * 1_000);
      const release = () => {
        browser.clearTimeout(timer);
        for (const track of stream.getTracks()) track.stop();
      };
      recorder.start();

      const recording: SpeechRecording = {
        stop: () =>
          new Promise<Float32Array>((resolve, reject) => {
            recorder.addEventListener(
              "stop",
              () => {
                release();
                const blob = new Blob(chunks, { type: recorder.mimeType });
                chunks = [];
                if (blob.size === 0) {
                  reject(new SpeechUnavailableError(t`Nothing was recorded. Try again.`));
                  return;
                }
                blob
                  .arrayBuffer()
                  .then(browser.decode)
                  .then((channels) => resolve(downmixToMono(channels)), reject);
              },
              { once: true },
            );
            recorder.stop();
          }),
        cancel: () => {
          chunks = [];
          if (recorder.state !== "inactive") recorder.stop();
          release();
        },
      };
      return recording;
    },
  };
}
