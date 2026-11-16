import { describe, expect, it } from "vitest";

import { ApiConfigError } from "./config.js";
import { liveSpeechFrom, readLiveSpeechConfig } from "./live-speech-config.js";

describe("live speech config", () => {
  it("is off unless a deployment names Google with its project", () => {
    expect(readLiveSpeechConfig({})).toEqual({ mode: "off" });
    expect(readLiveSpeechConfig({ DRAFT_LOOP_LIVE_SPEECH: "off" })).toEqual({ mode: "off" });
    expect(liveSpeechFrom({ mode: "off" })).toBeUndefined();
    expect(
      readLiveSpeechConfig({
        DRAFT_LOOP_LIVE_SPEECH: "google",
        DRAFT_LOOP_SPEECH_PROJECT_ID: " fixture-project ",
      }),
    ).toEqual({
      mode: "google",
      projectId: "fixture-project",
      turnPause: { normalMs: 2_500, unfinishedMs: 5_000 },
    });
    expect(
      readLiveSpeechConfig({
        DRAFT_LOOP_LIVE_SPEECH: "google",
        DRAFT_LOOP_SPEECH_PROJECT_ID: "fixture-project",
        DRAFT_LOOP_SPEECH_KEY_FILE: "/run/draft-loop/provider-keys/google_speech_api_key",
      }),
    ).toMatchObject({ keyFile: "/run/draft-loop/provider-keys/google_speech_api_key" });
  });

  it("reads the turn pause and refuses one that cannot work", () => {
    const google = { DRAFT_LOOP_LIVE_SPEECH: "google", DRAFT_LOOP_SPEECH_PROJECT_ID: "p" };
    expect(
      readLiveSpeechConfig({ ...google, DRAFT_LOOP_LIVE_TURN_PAUSE_MS: " 2000 , 6000 " }),
    ).toMatchObject({ turnPause: { normalMs: 2_000, unfinishedMs: 6_000 } });
    expect(
      readLiveSpeechConfig({ ...google, DRAFT_LOOP_LIVE_TURN_PAUSE_MS: "3000,3000" }),
    ).toMatchObject({ turnPause: { normalMs: 3_000, unfinishedMs: 3_000 } });
    for (const value of ["2500", "5000,2500", "0,5000", "2500,20000", "2.5,5", "a,b", "1,2,3"]) {
      expect(() =>
        readLiveSpeechConfig({ ...google, DRAFT_LOOP_LIVE_TURN_PAUSE_MS: value }),
      ).toThrow(/DRAFT_LOOP_LIVE_TURN_PAUSE_MS/);
    }
  });

  it("refuses an unknown mode and a missing project", () => {
    expect(() => readLiveSpeechConfig({ DRAFT_LOOP_LIVE_SPEECH: "voxtral" })).toThrow(
      ApiConfigError,
    );
    expect(() => readLiveSpeechConfig({ DRAFT_LOOP_LIVE_SPEECH: "google" })).toThrow(
      /DRAFT_LOOP_SPEECH_PROJECT_ID/,
    );
  });
});
