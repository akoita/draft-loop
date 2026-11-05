import { maximumSpeechSeconds } from "@draft-loop/ui/speech-to-text";
import { describe, expect, it } from "vitest";

import { createMicrophoneRecorder, type MicrophoneBrowser } from "./microphone.js";

class FakeRecorder extends EventTarget {
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm";
  constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {
    super();
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    const data = Object.assign(new Event("dataavailable"), { data: new Blob([this.bytes]) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event("stop"));
  }
}

function fakeBrowser(bytes = new Uint8Array([1, 2, 3])) {
  const state = { tracksStopped: 0, limit: undefined as (() => void) | undefined, cleared: 0 };
  const track = { stop: () => (state.tracksStopped += 1) };
  const browser: MicrophoneBrowser = {
    getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
    createRecorder: () => new FakeRecorder(bytes) as unknown as MediaRecorder,
    decode: async (buffer) => {
      expect(new Uint8Array(buffer)).toEqual(bytes);
      return [new Float32Array([0.5, 1]), new Float32Array([0.5, 0])];
    },
    setTimeout: (run, milliseconds) => {
      expect(milliseconds).toBe(maximumSpeechSeconds * 1_000);
      state.limit = run;
      return 1;
    },
    clearTimeout: () => (state.cleared += 1),
  };
  return { browser, state };
}

describe("microphone recorder", () => {
  it("records, releases the microphone and returns mono samples", async () => {
    const { browser, state } = fakeBrowser();
    const recording = await createMicrophoneRecorder(browser).start({ onLimit: () => {} });
    const samples = await recording.stop();
    expect(Array.from(samples)).toEqual([0.5, 0.5]);
    expect(state.tracksStopped).toBe(1);
    expect(state.cleared).toBe(1);
  });

  it("tells the screen when the length limit is reached, and drops a cancelled take", async () => {
    const { browser, state } = fakeBrowser();
    let limited = false;
    const recording = await createMicrophoneRecorder(browser).start({
      onLimit: () => {
        limited = true;
      },
    });
    state.limit?.();
    expect(limited).toBe(true);
    recording.cancel();
    expect(state.tracksStopped).toBe(1);
  });

  it("refuses an empty recording", async () => {
    const { browser } = fakeBrowser(new Uint8Array(0));
    const recording = await createMicrophoneRecorder(browser).start({ onLimit: () => {} });
    await expect(recording.stop()).rejects.toThrow("Nothing was recorded");
  });
});
