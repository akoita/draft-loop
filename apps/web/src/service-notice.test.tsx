import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { refusalText } from "./refusal-text.js";
import { ServiceNoticeBanner } from "./service-notice.js";
import {
  NOTICE_ACTIVE_CHECK_INTERVAL_MS,
  NOTICE_CHECK_INTERVAL_MS,
  nextCheckMs,
  noticeMessage,
  type ServiceNotice,
} from "./service-notice-model.js";

const planned: ServiceNotice = {
  kind: "maintenance",
  startsAt: "2026-12-01T19:00:00Z",
  endsAt: "2026-12-01T21:00:00Z",
  readOnly: true,
  state: "upcoming",
};

describe("planned-maintenance banner (#2966)", () => {
  it("announces the window in the reader's time zone before it starts", () => {
    const text = noticeMessage(planned, "en", "Europe/Paris");
    expect(text).toContain("Planned maintenance");
    expect(text).toContain("1 Dec 2026");
    expect(text).toContain("20:00");
    expect(text).toContain("22:00");
    expect(text).toContain("Changes will be paused");
  });

  it("says changes are paused and come back on their own while under way", () => {
    const text = noticeMessage({ ...planned, state: "ongoing" }, "en", "Europe/Paris");
    expect(text).toContain("until 1 Dec 2026, 22:00");
    expect(text).toContain("come back on their own");
  });

  it("says it is taking longer than planned after the announced end", () => {
    expect(noticeMessage({ ...planned, state: "overrunning" }, "en")).toContain(
      "taking longer than planned",
    );
  });

  it("only warns of a short interruption when changes are not paused", () => {
    const text = noticeMessage({ ...planned, readOnly: false }, "en", "UTC");
    expect(text).toContain("briefly unavailable");
    expect(text).not.toContain("paused");
  });

  it("never names a cause", () => {
    for (const state of ["upcoming", "ongoing", "overrunning"] as const) {
      expect(noticeMessage({ ...planned, state }, "en")).not.toMatch(/billing|credit|trial/iu);
    }
  });

  it("checks every minute while under way, every five minutes otherwise", () => {
    expect(nextCheckMs(null)).toBe(NOTICE_CHECK_INTERVAL_MS);
    expect(nextCheckMs(planned)).toBe(NOTICE_CHECK_INTERVAL_MS);
    expect(nextCheckMs({ ...planned, state: "ongoing" })).toBe(NOTICE_ACTIVE_CHECK_INTERVAL_MS);
  });

  it("renders as a status line", () => {
    const html = renderToStaticMarkup(<ServiceNoticeBanner notice={planned} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("service-notice");
  });

  it("words a write refused during maintenance", () => {
    expect(refusalText({ code: "service_maintenance", message: "Changes are paused." })).toContain(
      "come back on their own",
    );
  });
});
