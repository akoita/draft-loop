import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewReleaseNotice } from "./new-release.js";
import {
  entryScriptOf,
  isNewRelease,
  NEW_RELEASE_MESSAGE,
  RELEASE_CHECK_INTERVAL_MS,
  type ReleaseWatch,
  watchForNewRelease,
} from "./new-release-model.js";

const page = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script>` +
  `<link rel="stylesheet" href="/assets/index-a1.css"></head><body><div id="root"></div></body></html>`;

/** A watch whose focus and timer the test fires by hand. */
function fakeWatch(served: () => Promise<string>) {
  const checks: { focus?: () => void; timer?: () => void; interval?: number } = {};
  const stopped = { focus: false, timer: false };
  let found = 0;
  const watch: ReleaseWatch = {
    running: "/assets/index-old.js",
    fetchIndex: served,
    onNewRelease: () => {
      found += 1;
    },
    onFocus: (check) => {
      checks.focus = check;
      return () => {
        stopped.focus = true;
      };
    },
    every: (interval, check) => {
      checks.interval = interval;
      checks.timer = check;
      return () => {
        stopped.timer = true;
      };
    },
  };
  return { watch, checks, stopped, found: () => found };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a new release while the tab is open (#1904)", () => {
  it("reads the entry script a built page names", () => {
    expect(entryScriptOf(page("/assets/index-Bx12.js"))).toBe("/assets/index-Bx12.js");
    expect(
      entryScriptOf('<script src="/legacy.js"></script><script src="/m.js" type="module">'),
    ).toBe("/m.js");
    expect(entryScriptOf("<p>Service unavailable</p>")).toBeNull();
  });

  it("calls only a different entry script a new release", () => {
    expect(isNewRelease("/assets/a.js", "/assets/b.js")).toBe(true);
    expect(isNewRelease("/assets/a.js", "/assets/a.js")).toBe(false);
    expect(isNewRelease("/assets/a.js", null)).toBe(false);
    expect(isNewRelease(null, "/assets/b.js")).toBe(false);
  });

  it("checks on focus and on a timer, and stops once it finds one", async () => {
    let served = page("/assets/index-old.js");
    const fake = fakeWatch(async () => served);
    watchForNewRelease(fake.watch);
    expect(fake.checks.interval).toBe(RELEASE_CHECK_INTERVAL_MS);

    fake.checks.focus?.();
    await settle();
    expect(fake.found()).toBe(0);

    served = page("/assets/index-new.js");
    fake.checks.timer?.();
    await settle();
    expect(fake.found()).toBe(1);
    expect(fake.stopped).toEqual({ focus: true, timer: true });
  });

  it("ignores a failed check and finds the release on the next one", async () => {
    let fail = true;
    const fake = fakeWatch(async () => {
      if (fail) throw new Error("offline");
      return page("/assets/index-new.js");
    });
    watchForNewRelease(fake.watch);

    fake.checks.focus?.();
    await settle();
    expect(fake.found()).toBe(0);
    fail = false;
    fake.checks.focus?.();
    await settle();
    expect(fake.found()).toBe(1);
  });

  it("does not watch a page without an entry script", () => {
    const fake = fakeWatch(async () => page("/assets/index-new.js"));
    watchForNewRelease({ ...fake.watch, running: null });
    expect(fake.checks.focus).toBeUndefined();
  });

  it("offers a reload with the notice", () => {
    const html = renderToStaticMarkup(<NewReleaseNotice onReload={() => undefined} />);
    expect(html).toContain(NEW_RELEASE_MESSAGE);
    expect(html).toContain('role="status"');
    expect(html).toContain(">Reload</button>");
  });
});
