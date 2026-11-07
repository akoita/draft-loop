import type {
  CareerInterviewLiveCall,
  CareerInterviewLiveEvents,
} from "@draft-loop/ui/career-interview-live";
import { t } from "@lingui/core/macro";

/**
 * The web host's live voice conversation (#2362): the microphone streams 16 kHz PCM to the API's
 * live route, the candidate's words come back as they speak, and the reply plays clip by clip:
 * a short acknowledgement, then the question sentence by sentence (#2409). The microphone is muted while a question plays, so the interviewer never
 * hears itself; "Answer now" stops the question and listens again.
 */

/** The rate and format the live route expects: 16 kHz mono, 16-bit little-endian. */
export const liveSampleRate = 16_000;

/**
 * Turns the microphone's frames at its own rate into 16 kHz PCM16, carrying the fractional
 * position between calls so no sample is lost or repeated at a frame boundary.
 */
export function createPcm16Resampler(
  inputRate: number,
): (input: Float32Array) => Int16Array<ArrayBuffer> {
  if (!(inputRate >= liveSampleRate)) {
    throw new RangeError(`The microphone must record at ${liveSampleRate} Hz or more.`);
  }
  const step = inputRate / liveSampleRate;
  let position = 0;
  return (input) => {
    const output: number[] = [];
    while (position < input.length) {
      // Average the input samples this output sample covers, a simple low-pass before decimation.
      const start = Math.floor(position);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor(position + step)));
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += input[index] ?? 0;
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output.push(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff));
      position += step;
    }
    position -= input.length;
    return Int16Array.from(output);
  };
}

/** The microphone as the live call uses it. */
export interface LiveMicrophone {
  /** Called with each frame of PCM16 at 16 kHz. */
  onFrame(listener: (frame: Int16Array<ArrayBuffer>) => void): void;
  close(): void;
}

/** Plays one clip of a turn's audio once it has all arrived. */
export interface LivePlayer {
  /** Plays the audio; `onLevel`, when given, hears how loud it is while it plays, if measurable. */
  play(audio: Blob, onEnded: () => void, onLevel?: (level: number) => void): void;
  stop(): void;
}

/**
 * How loud a stretch of PCM16 is, from 0 to 1, for the voice stage's orb (#2401). The square root
 * of the RMS spreads ordinary speech over the range instead of crowding it near zero.
 */
export function pcm16Level(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += (sample / 0x8000) ** 2;
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
}

/** Samples of 16 kHz audio between two level reports: 50 ms, about twenty a second. */
const levelWindow = liveSampleRate / 20;

/** The socket as the live call uses it; a browser WebSocket satisfies it. */
export interface LiveSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
}

const connectingState = 0;
const closedState = 3;

/**
 * A socket that may still be opening, such as the signed-in screen's, which waits for a current
 * access token (#2393). Until it resolves the call sees a connecting socket and sends nothing;
 * listeners attach when it arrives, and a refused opening reports an error and a close.
 */
export function liveSocketOf(opening: LiveSocket | Promise<LiveSocket>): LiveSocket {
  if (!(opening instanceof Promise)) return opening;
  let socket: LiveSocket | undefined;
  let failed = false;
  let closeRequested: { code?: number; reason?: string } | undefined;
  let binaryType: BinaryType = "blob";
  const listeners: Array<[string, (event: MessageEvent) => void]> = [];
  void opening.then(
    (opened) => {
      socket = opened;
      opened.binaryType = binaryType;
      for (const [type, listener] of listeners) {
        if (type === "message") opened.addEventListener("message", listener);
        else opened.addEventListener(type as "close" | "error", () => listener({} as MessageEvent));
      }
      if (closeRequested !== undefined) opened.close(closeRequested.code, closeRequested.reason);
    },
    () => {
      failed = true;
      for (const [type, listener] of listeners) {
        if (type !== "message") listener({} as MessageEvent);
      }
    },
  );
  return {
    get binaryType() {
      return socket?.binaryType ?? binaryType;
    },
    set binaryType(value) {
      binaryType = value;
      if (socket !== undefined) socket.binaryType = value;
    },
    get readyState() {
      return socket?.readyState ?? (failed ? closedState : connectingState);
    },
    send: (data) => socket?.send(data),
    close: (code, reason) => {
      if (socket !== undefined) socket.close(code, reason);
      else
        closeRequested = {
          ...(code === undefined ? {} : { code }),
          ...(reason === undefined ? {} : { reason }),
        };
    },
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (socket === undefined) {
        listeners.push([type, listener]);
      } else if (type === "message") {
        socket.addEventListener("message", listener);
      } else {
        socket.addEventListener(type as "close" | "error", () => listener({} as MessageEvent));
      }
    },
  } as LiveSocket;
}

export interface LiveVoiceCallOptions {
  readonly socket: LiveSocket;
  readonly microphone: () => Promise<LiveMicrophone>;
  readonly player: LivePlayer;
  readonly events: CareerInterviewLiveEvents;
  /** The session view the server saved after a turn, exactly as the actions route returns it. */
  readonly onSession: (view: unknown) => void;
}

const openState = 1;

interface ServerMessage {
  readonly type?: string;
  readonly text?: string;
  readonly view?: unknown;
  readonly media_type?: string;
  readonly kind?: string;
  readonly more?: boolean;
  readonly code?: string;
  readonly message?: string;
}

function parse(data: string): ServerMessage {
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Runs one live conversation over an opened socket. */
export function startLiveVoiceCall(options: LiveVoiceCallOptions): CareerInterviewLiveCall {
  const { socket, player, events } = options;
  socket.binaryType = "arraybuffer";
  let listening = false;
  let ended = false;
  let microphone: LiveMicrophone | undefined;
  let audio: { type: string; chunks: ArrayBuffer[] } | undefined;
  // A turn's speech arrives as clips (#2409): an acknowledgement, then the question sentence by
  // sentence. Each plays as soon as it has arrived and the one before it has finished.
  const queue: Blob[] = [];
  let playing = false;
  let turnAudioDone = false;
  let skipped = false;
  const playNext = () => {
    if (ended || playing) return;
    const next = queue.shift();
    if (next === undefined) {
      if (turnAudioDone) {
        turnAudioDone = false;
        listen();
      }
      return;
    }
    playing = true;
    player.play(
      next,
      () => {
        playing = false;
        playNext();
      },
      events.onLevel,
    );
  };

  const listen = () => {
    if (ended) return;
    listening = true;
    events.onState("listening");
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    listening = false;
    microphone?.close();
    player.stop();
    events.onState("ended");
  };

  void options.microphone().then(
    (opened) => {
      if (ended) {
        opened.close();
        return;
      }
      microphone = opened;
      let measured: Int16Array[] = [];
      let measuredLength = 0;
      opened.onFrame((frame) => {
        if (!listening) return;
        if (socket.readyState === openState) socket.send(frame);
        if (events.onLevel === undefined) return;
        measured.push(frame);
        measuredLength += frame.length;
        if (measuredLength < levelWindow) return;
        const joined = new Int16Array(measuredLength);
        let offset = 0;
        for (const part of measured) {
          joined.set(part, offset);
          offset += part.length;
        }
        measured = [];
        measuredLength = 0;
        events.onLevel(pcm16Level(joined));
      });
    },
    () => {
      events.onRefusal(
        "microphone_unavailable",
        t`The browser did not allow the microphone. Allow it for this page, or keep writing your answers.`,
      );
      if (socket.readyState === openState) socket.send(JSON.stringify({ type: "stop" }));
      socket.close();
      finish();
    },
  );

  socket.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      audio?.chunks.push(event.data);
      return;
    }
    const message = parse(String(event.data));
    switch (message.type) {
      case "ready":
        listen();
        break;
      case "partial":
        events.onHeard(message.text ?? "");
        break;
      case "answer":
        listening = false;
        skipped = false;
        events.onState("thinking");
        break;
      case "session":
        options.onSession(message.view);
        break;
      case "audio_start":
        if (skipped) break;
        audio = { type: message.media_type ?? "audio/ogg", chunks: [] };
        // The acknowledgement plays while the interviewer still writes.
        if (message.kind !== "acknowledgement") events.onState("speaking");
        break;
      case "audio_end": {
        const clip = audio;
        audio = undefined;
        if (skipped) break;
        if (clip !== undefined && clip.chunks.length > 0) {
          queue.push(new Blob(clip.chunks, { type: clip.type }));
        }
        if (message.more !== true) turnAudioDone = true;
        playNext();
        break;
      }
      case "error":
        events.onRefusal(message.code ?? "live_failed", message.message ?? "");
        break;
    }
  });
  socket.addEventListener("close", finish);
  socket.addEventListener("error", finish);

  return {
    endTurn: () => {
      if (listening && socket.readyState === openState) {
        socket.send(JSON.stringify({ type: "end_turn" }));
      }
    },
    skipQuestion: () => {
      player.stop();
      audio = undefined;
      queue.length = 0;
      playing = false;
      turnAudioDone = false;
      // The rest of this question's clips may still arrive; they stay silent.
      skipped = true;
      listen();
    },
    stop: () => {
      if (socket.readyState === openState) socket.send(JSON.stringify({ type: "stop" }));
      socket.close(1000, "stopped");
      finish();
    },
  };
}

/** The browser's microphone through an audio worklet, released on close. */
export async function openBrowserMicrophone(): Promise<LiveMicrophone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(
      new URL("./live-capture-worklet.js?no-inline", import.meta.url),
    );
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, "live-capture");
  const resample = createPcm16Resampler(context.sampleRate);
  let listener: ((frame: Int16Array<ArrayBuffer>) => void) | undefined;
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const frame = resample(event.data);
    if (frame.length > 0) listener?.(frame);
  };
  source.connect(capture);
  return {
    onFrame: (next) => {
      listener = next;
    },
    close: () => {
      listener = undefined;
      source.disconnect();
      capture.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

/**
 * Plays each question through one audio element, freeing its object URL when done. When asked for
 * levels, it routes the element through an analyser so the orb moves with the interviewer's voice;
 * a browser that refuses that, or an audio context that is not running, plays it plainly instead.
 */
export function createBrowserPlayer(): LivePlayer {
  let current: { element: HTMLAudioElement; url: string; frame?: number } | undefined;
  let context: AudioContext | undefined;
  const stop = () => {
    if (current === undefined) return;
    if (current.frame !== undefined) cancelAnimationFrame(current.frame);
    current.element.pause();
    current.element.onended = null;
    URL.revokeObjectURL(current.url);
    current = undefined;
  };
  const measure = (element: HTMLAudioElement, onLevel: (level: number) => void) => {
    try {
      context ??= new AudioContext();
      if (context.state !== "running") {
        // Routing the element through a context that is not running would silence it: play it
        // plainly this time, and let the context start for the next question.
        void context.resume().catch(() => {});
        return;
      }
      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(context.destination);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (current?.element !== element) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        onLevel(Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6));
        current.frame = requestAnimationFrame(tick);
      };
      if (current !== undefined) current.frame = requestAnimationFrame(tick);
    } catch {
      // No levels: the question still plays, and the orb keeps its resting motion.
    }
  };
  return {
    play: (audio, onEnded, onLevel) => {
      stop();
      const url = URL.createObjectURL(audio);
      const element = new Audio(url);
      current = { element, url };
      if (onLevel !== undefined) measure(element, onLevel);
      element.onended = () => {
        stop();
        onEnded();
      };
      // A blocked or broken playback still hands the turn back to the candidate.
      void element.play().catch(() => {
        stop();
        onEnded();
      });
    },
    stop,
  };
}

/** Whether this browser can talk live: a microphone, an audio worklet and WebSockets. */
export function liveVoiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebSocket !== "undefined"
  );
}
