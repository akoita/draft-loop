import { describe, expect, it, vi } from "vitest";

import {
  ModelCallSwitchConfigError,
  parseModelCallSwitchState,
  readModelCallSwitchReader,
  secretModelCallSwitchReader,
} from "./model-call-switch.js";

const secret = "projects/p/secrets/s/versions/latest";

function storing(text: string) {
  return {
    accessSecretVersion: vi.fn(async () => [{ payload: { data: text } }] as const),
  };
}

describe("model call switch state", () => {
  it.each([
    [undefined, { paused: false, refusalFallback: true }],
    ["{}", { paused: false, refusalFallback: true }],
    ['{"modelCalls":"on"}', { paused: false, refusalFallback: true }],
    ['{"refusalFallback":"on"}', { paused: false, refusalFallback: true }],
    ['{"refusalFallback":"off"}', { paused: false, refusalFallback: false }],
    ['{"modelCalls":"paused"}', { paused: true, refusalFallback: false }],
    ['{"modelCalls":"paused","refusalFallback":"on"}', { paused: true, refusalFallback: false }],
  ])("parses %s", (text, state) => {
    expect(parseModelCallSwitchState(text)).toEqual(state);
  });

  it("throws on an unknown value or key", () => {
    expect(() => parseModelCallSwitchState('{"modelCalls":"off"}')).toThrow();
    expect(() => parseModelCallSwitchState('{"refusalFallback":"paused"}')).toThrow();
    expect(() => parseModelCallSwitchState('{"other":"on"}')).toThrow();
  });

  it("reads the stored secret", async () => {
    const read = secretModelCallSwitchReader({
      secret,
      client: storing('{"refusalFallback":"off"}'),
    });
    expect(await read()).toEqual({ paused: false, refusalFallback: false });
  });

  it("keeps everything running and reports when the secret cannot be read", async () => {
    const onReadError = vi.fn();
    const read = secretModelCallSwitchReader({
      secret,
      client: {
        accessSecretVersion: async () => {
          throw new Error("denied");
        },
      },
      onReadError,
    });
    expect(await read()).toEqual({ paused: false, refusalFallback: true });
    expect(onReadError).toHaveBeenCalled();
  });

  it("reads the environment where there is no secret, and refuses bad settings", async () => {
    expect(await readModelCallSwitchReader({})()).toEqual({ paused: false, refusalFallback: true });
    expect(await readModelCallSwitchReader({ DRAFT_LOOP_MODEL_CALLS: "paused" })()).toEqual({
      paused: true,
      refusalFallback: false,
    });
    expect(() => readModelCallSwitchReader({ DRAFT_LOOP_MODEL_CALLS: "maybe" })).toThrow(
      ModelCallSwitchConfigError,
    );
    expect(() =>
      readModelCallSwitchReader({ DRAFT_LOOP_MODEL_CALLS_SECRET: "model-calls" }),
    ).toThrow(ModelCallSwitchConfigError);
  });
});
