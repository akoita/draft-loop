import { describe, expect, it } from "vitest";

import { operatorRefreshMs, type RefreshHost, startBackgroundRefresh } from "./operator-list.js";

function fakeHost() {
  let visible = true;
  let timer: (() => void) | undefined;
  let interval: number | undefined;
  let shown: (() => void) | undefined;
  const host: RefreshHost = {
    visible: () => visible,
    every: (work, ms) => {
      timer = work;
      interval = ms;
      return () => {
        timer = undefined;
      };
    },
    onShown: (work) => {
      shown = work;
      return () => {
        shown = undefined;
      };
    },
  };
  return {
    host,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
      shown?.();
    },
    tick: () => timer?.(),
    interval: () => interval,
  };
}

describe("the operator page's background refresh (#3024)", () => {
  it("reads again on each tick and when the tab comes back, never while hidden", () => {
    const fake = fakeHost();
    let reads = 0;
    const stop = startBackgroundRefresh(() => (reads += 1), operatorRefreshMs, fake.host);

    expect(fake.interval()).toBe(30_000);
    fake.tick();
    expect(reads).toBe(1);
    fake.hide();
    fake.tick();
    expect(reads).toBe(1);
    fake.show();
    expect(reads).toBe(2);

    stop();
    fake.tick();
    fake.show();
    expect(reads).toBe(2);
  });
});
