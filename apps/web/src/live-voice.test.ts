import type { CareerInterviewLiveState } from "@draft-loop/ui/career-interview-live";
import { describe, expect, it } from "vitest";

import {
  createPcm16Resampler,
  type LiveMicrophone,
  type LiveSocket,
  liveSocketOf,
  pcm16Level,
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
  const played: {
    audio: Blob;
    onEnded: () => void;
    onLevel?: ((level: number) => void) | undefined;
  }[] = [];
  const levels: number[] = [];
  let stops = 0;
  const live = startLiveVoiceCall({
    socket,
    microphone: async () => microphone,
    player: {
      play: (audio, onEnded, onLevel) => played.push({ audio, onEnded, onLevel }),
      stop: () => {
        stops += 1;
      },
    },
    events: {
      onState: (state) => states.push(state),
      onHeard: (text) => heard.push(text),
      onRefusal: () => {},
      onLevel: (level) => levels.push(level),
    },
    onSession: (view) => sessions.push(view),
  });
  return { socket, microphone, states, heard, sessions, played, levels, live, stops: () => stops };
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

  it("measures how loud the voice is, about twenty times a second, only while listening", async () => {
    expect(pcm16Level(new Int16Array(800))).toBe(0);
    expect(pcm16Level(new Int16Array(800).fill(0x7fff))).toBe(1);
    const quiet = pcm16Level(new Int16Array(800).fill(300));
    const loud = pcm16Level(new Int16Array(800).fill(6_000));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);

    const { socket, microphone, levels, played } = call();
    await Promise.resolve();
    microphone.speak(new Int16Array(800).fill(6_000));
    expect(levels).toEqual([]);
    socket.server({ type: "ready" });
    microphone.speak(new Int16Array(400).fill(6_000));
    expect(levels).toEqual([]);
    microphone.speak(new Int16Array(400).fill(6_000));
    expect(levels).toEqual([loud]);

    socket.server({ type: "answer", text: "Yes." });
    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    socket.emit("message", new Uint8Array([1]).buffer);
    socket.server({ type: "audio_end" });
    microphone.speak(new Int16Array(800).fill(6_000));
    expect(levels).toHaveLength(1);
    played[0]?.onLevel?.(0.4);
    expect(levels.at(-1)).toBe(0.4);
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

  it("plays the acknowledgement while thinking, then the question clip by clip (#2409)", async () => {
    const { socket, microphone, states, played, live } = call();
    await Promise.resolve();
    socket.server({ type: "ready" });
    socket.server({ type: "answer", text: "I rebuilt the reports." });
    socket.server({ type: "audio_start", media_type: "audio/ogg", kind: "acknowledgement" });
    socket.emit("message", new Uint8Array([1]).buffer);
    socket.server({ type: "audio_end", more: true });
    expect(played).toHaveLength(1);
    expect(states.at(-1)).toBe("thinking");

    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    socket.emit("message", new Uint8Array([1, 2]).buffer);
    socket.server({ type: "audio_end", more: true });
    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    socket.emit("message", new Uint8Array([1, 2, 3]).buffer);
    socket.server({ type: "audio_end" });
    expect(states.at(-1)).toBe("speaking");
    expect(played).toHaveLength(1);

    played[0]?.onEnded();
    expect(played[1]?.audio.size).toBe(2);
    played[1]?.onEnded();
    expect(played[2]?.audio.size).toBe(3);
    microphone.speak(new Int16Array(160));
    const sentBefore = socket.sent.length;
    played[2]?.onEnded();
    expect(states.at(-1)).toBe("listening");
    microphone.speak(new Int16Array(160));
    expect(socket.sent).toHaveLength(sentBefore + 1);

    socket.server({ type: "answer", text: "Forty events." });
    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    socket.emit("message", new Uint8Array([1]).buffer);
    socket.server({ type: "audio_end", more: true });
    live.skipQuestion();
    socket.server({ type: "audio_start", media_type: "audio/ogg" });
    socket.emit("message", new Uint8Array([1]).buffer);
    socket.server({ type: "audio_end" });
    expect(played).toHaveLength(4);
    expect(states.at(-1)).toBe("listening");
  });

  it("waits for a socket that is still opening, then talks over it (#2393)", async () => {
    let open: (socket: FakeSocket) => void = () => {};
    const pending = liveSocketOf(new Promise<LiveSocket>((resolve) => (open = resolve)));
    const states: CareerInterviewLiveState[] = [];
    startLiveVoiceCall({
      socket: pending,
      microphone: async () => fakeMicrophone(),
      player: { play: () => {}, stop: () => {} },
      events: { onState: (state) => states.push(state), onHeard: () => {}, onRefusal: () => {} },
      onSession: () => {},
    });
    expect(pending.readyState).toBe(0);

    const socket = new FakeSocket();
    open(socket);
    await Promise.resolve();
    expect(socket.binaryType).toBe("arraybuffer");
    socket.server({ type: "ready" });
    expect(states).toEqual(["listening"]);
    socket.close();
    expect(states).toEqual(["listening", "ended"]);
  });

  it("ends the call when the socket cannot open, and closes one stopped while opening", async () => {
    const states: CareerInterviewLiveState[] = [];
    const refused = liveSocketOf(Promise.reject(new Error("signed out")));
    startLiveVoiceCall({
      socket: refused,
      microphone: async () => fakeMicrophone(),
      player: { play: () => {}, stop: () => {} },
      events: { onState: (state) => states.push(state), onHeard: () => {}, onRefusal: () => {} },
      onSession: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(refused.readyState).toBe(3);
    expect(states).toEqual(["ended"]);

    let open: (socket: FakeSocket) => void = () => {};
    const pending = liveSocketOf(new Promise<LiveSocket>((resolve) => (open = resolve)));
    const live = startLiveVoiceCall({
      socket: pending,
      microphone: async () => fakeMicrophone(),
      player: { play: () => {}, stop: () => {} },
      events: { onState: () => {}, onHeard: () => {}, onRefusal: () => {} },
      onSession: () => {},
    });
    live.stop();
    const socket = new FakeSocket();
    open(socket);
    await Promise.resolve();
    expect(socket.closed).toBe(true);
  });
});
