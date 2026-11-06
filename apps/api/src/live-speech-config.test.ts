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
    ).toEqual({ mode: "google", projectId: "fixture-project" });
    expect(
      readLiveSpeechConfig({
        DRAFT_LOOP_LIVE_SPEECH: "google",
        DRAFT_LOOP_SPEECH_PROJECT_ID: "fixture-project",
        DRAFT_LOOP_SPEECH_KEY_FILE: "/run/draft-loop/provider-keys/google_speech_api_key",
      }),
    ).toMatchObject({ keyFile: "/run/draft-loop/provider-keys/google_speech_api_key" });
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
