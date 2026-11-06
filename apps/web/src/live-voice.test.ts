import type { CareerInterviewLiveState } from "@draft-loop/ui/career-interview-live";
import { describe, expect, it } from "vitest";

import {
  createPcm16Resampler,
  type LiveMicrophone,
  type LiveSocket,
  startLiveVoiceCall,
} from "./live-voice.js";

class FakeSocket implements LiveSocket {
  binaryType: BinaryType = "blob";
  readyState = 1;
  readonly sent: unknown[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", {});
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent);
  }
  server(message: object) {
    this.emit("message", JSON.stringify(message));
  }
}

function fakeMicrophone() {
  let listener: ((frame: Int16Array<ArrayBuffer>) => void) | undefined;
  const microphone: LiveMicrophone & {
    closed: boolean;
    speak: (frame: Int16Array<ArrayBuffer>) => void;
  } = {
    closed: false,
    onFrame: (next) => {
      listener = next;
    },
    close: () => {
      microphone.closed = true;
    },
    speak: (frame) => listener?.(frame),
  };
  return microphone;
}

function call() {
  const socket = new FakeSocket();
  const microphone = fakeMicrophone();
  const states: CareerInterviewLiveState[] = [];
  const heard: string[] = [];
  const sessions: unknown[] = [];
  const played: { audio: Blob; onEnded: () => void }[] = [];
  let stops = 0;
  const live = startLiveVoiceCall({
    socket,
    microphone: async () => microphone,
    player: {
      play: (audio, onEnded) => played.push({ audio, onEnded }),
      stop: () => {
        stops += 1;
      },
    },
    events: {
      onState: (state) => states.push(state),
      onHeard: (text) => heard.push(text),
      onRefusal: () => {},
    },
    onSession: (view) => sessions.push(view),
  });
  return { socket, microphone, states, heard, sessions, played, live, stops: () => stops };
}

describe("web live voice", () => {
  it("resamples 48 kHz to 16 kHz PCM16 across frame boundaries", () => {
    const resample = createPcm16Resampler(48_000);
    const first = resample(new Float32Array(480).fill(0.5));
    const second = resample(new Float32Array(480).fill(-1));
    expect(first.length + second.length).toBe(320);
    expect(first[0]).toBe(Math.round(0.5 * 0x7fff));
    expect(second.at(-1)).toBe(-0x8000);
    expect(() => createPcm16Resampler(8_000)).toThrow(RangeError);
  });

  it("streams the voice while listening and mutes it while the question plays", async () => {
    const { socket, microphone, states, heard, sessions, played, live } = call();
    await Promise.resolve();
    microphone.speak(new Int16Array(160));
    expect(socket.sent).toEqual([]);

    socket.server({ type: "ready" });
    microphone.speak(new Int16Array(160));
    expect(socket.sent).toHaveLength(1);
    socket.server({ type: "partial", text: "I rebuilt" });
    live.endTurn();
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "end_turn" }));

    socket.server({ type: "answer", text: "I rebuilt the reports." });
    socket.server({ type: "session", view: { session: { id: "cis_fixture0001" } } });
    socket.server({ type: "audio_start", media_type: "audio/ogg; codecs=opus" });
    socket.emit("message", new Uint8Array([1, 2]).buffer);
    socket.server({ type: "audio_end" });
    microphone.speak(new Int16Array(160));
    expect(socket.sent).toHaveLength(2);
    expect(played[0]?.audio.type).toBe("audio/ogg; codecs=opus");
    expect(played[0]?.audio.size).toBe(2);

    played[0]?.onEnded();
    microphone.speak(new Int16Array(160));
    expect(socket.sent).toHaveLength(3);
    expect(heard).toEqual(["I rebuilt"]);
    expect(sessions).toEqual([{ session: { id: "cis_fixture0001" } }]);
    expect(states).toEqual(["listening", "thinking", "speaking", "listening"]);
  });

  it("lets the candidate cut a question short and releases everything on stop", async () => {
    const { socket, microphone, states, live, stops } = call();
    await Promise.resolve();
    socket.server({ type: "ready" });
    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    live.skipQuestion();
    expect(states.at(-1)).toBe("listening");
    expect(stops()).toBe(1);

    live.stop();
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "stop" }));
    expect(socket.closed).toBe(true);
    expect(microphone.closed).toBe(true);
    expect(states.at(-1)).toBe("ended");
  });
});
