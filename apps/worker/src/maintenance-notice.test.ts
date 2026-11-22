import { describe, expect, it } from "vitest";

import type { MailMessage } from "./mail.js";
import { maintenanceNotice, notifyMembers, readNoticeRequest } from "./maintenance-notice.js";

const window = {
  startsAt: new Date("2026-12-01T19:00:00Z"),
  endsAt: new Date("2026-12-01T21:00:00Z"),
  readOnly: true,
};
const url = "https://draftloop.example.test";

describe("planned-maintenance email (#2968)", () => {
  it("names the window in Paris time and what members can still do", () => {
    const { subject, text } = maintenanceNotice(window, "en", url);
    expect(subject).toBe("Planned maintenance on Redakloop");
    expect(text).toContain("20:00");
    expect(text).toContain("22:00");
    expect(text).toContain("(Paris time)");
    expect(text).toContain("changes will be paused");
    expect(text).toContain(url);
  });

  it("is written in French for a member whose screen is in French", () => {
    const { subject, text } = maintenanceNotice(window, "fr", url);
    expect(subject).toBe("Maintenance planifiée de Redakloop");
    expect(text).toContain("heure de Paris");
    expect(text).toContain("modifications seront suspendues");
  });

  it("never names a cause", () => {
    for (const locale of ["en", "fr"] as const) {
      const { subject, text } = maintenanceNotice(window, locale, url);
      expect(`${subject} ${text}`).not.toMatch(/billing|credit|trial|facturation|crédit|essai/iu);
    }
  });

  it("only counts recipients on a dry run", async () => {
    const sent: MailMessage[] = [];
    const summary = await notifyMembers(
      {
        recipients: async () => [
          { email: "a@example.test", locale: "en" },
          { email: "b@example.test", locale: "fr" },
        ],
        send: async (message) => {
          sent.push(message);
          return true;
        },
      },
      window,
      url,
      true,
    );
    expect(summary).toEqual({ recipients: 2, sent: 0, failed: 0, dryRun: true });
    expect(sent).toEqual([]);
  });

  it("sends once per address in the member's language and counts refusals", async () => {
    const sent: MailMessage[] = [];
    const summary = await notifyMembers(
      {
        recipients: async () => [
          { email: "a@example.test", locale: "fr" },
          { email: "A@example.test", locale: "en" },
          { email: "b@example.test", locale: "en" },
        ],
        send: async (message) => {
          sent.push(message);
          return message.to !== "b@example.test";
        },
      },
      window,
      url,
      false,
    );
    expect(summary).toEqual({ recipients: 2, sent: 1, failed: 1, dryRun: false });
    expect(sent.map((message) => message.subject)).toEqual([
      "Maintenance planifiée de Redakloop",
      "Planned maintenance on Redakloop",
    ]);
  });

  it("reads the window and sends only when told yes", () => {
    const env = {
      DRAFT_LOOP_NOTICE_STARTS_AT: "2026-12-01T20:00:00+01:00",
      DRAFT_LOOP_NOTICE_ENDS_AT: "2026-12-01T22:00:00+01:00",
      DRAFT_LOOP_NOTICE_READ_ONLY: "true",
    };
    expect(readNoticeRequest(env)).toEqual({ window, dryRun: true });
    expect(readNoticeRequest({ ...env, DRAFT_LOOP_NOTICE_SEND: "yes" }).dryRun).toBe(false);
    expect(() =>
      readNoticeRequest({ ...env, DRAFT_LOOP_NOTICE_ENDS_AT: "2026-12-01T19:00:00+01:00" }),
    ).toThrow(/after the start/u);
    expect(() => readNoticeRequest({ ...env, DRAFT_LOOP_NOTICE_STARTS_AT: "tomorrow" })).toThrow(
      /ISO 8601/u,
    );
  });
});
