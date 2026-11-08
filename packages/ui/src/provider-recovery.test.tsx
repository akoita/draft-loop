import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProviderFailureView } from "./model.js";
import {
  automaticRetryLine,
  ProviderFailureStopView,
  providerRecoveryKind,
} from "./provider-recovery.js";

const failure: ProviderFailureView = {
  code: "invalid-response",
  explanation: "The provider returned a response that could not be validated.",
  provider: "openai",
  model: "critic-test",
  step: "critic",
  role: "critic",
  attempt: 1,
  maxAttempts: 3,
  retryAvailable: false,
  automaticRetry: true,
  retryNotBefore: null,
  availableActions: ["stop"],
  diagnostics: [],
};

describe("provider recovery", () => {
  it("tells retrying on its own, waiting for the person and no recovery apart", () => {
    expect(providerRecoveryKind(failure)).toBe("retrying");
    expect(
      providerRecoveryKind({
        ...failure,
        automaticRetry: false,
        retryAvailable: true,
        availableActions: ["retry", "stop"],
      }),
    ).toBe("waiting");
    expect(providerRecoveryKind({ ...failure, automaticRetry: false, attempt: 3 })).toBe(
      "unrecoverable",
    );
  });

  it("names the next attempt and how long until it starts", () => {
    expect(automaticRetryLine(failure, 8_200)).toMatch(/^Attempt 2 of 3 starts in 9 seconds\./u);
    expect(automaticRetryLine({ ...failure, attempt: 2 }, 0)).toMatch(
      /^Attempt 3 of 3 is starting\./u,
    );
  });

  it("asks before stopping a run the host is still retrying", () => {
    const calls = { ask: vi.fn(), keep: vi.fn(), stop: vi.fn() };
    const view = (asking: boolean) =>
      ProviderFailureStopView({
        asking,
        onAsk: calls.ask,
        onKeepWaiting: calls.keep,
        onStop: calls.stop,
      });

    const closed = view(false);
    expect(renderToStaticMarkup(closed)).toContain("Stop run");
    closed.props.onClick();
    expect(calls.ask).toHaveBeenCalledOnce();
    expect(calls.stop).not.toHaveBeenCalled();

    const asking = renderToStaticMarkup(view(true));
    expect(asking).toContain("Stopping ends this review for good");
    expect(asking).toContain("Keep waiting");
    expect(asking).toContain("Stop for good");
  });
});
