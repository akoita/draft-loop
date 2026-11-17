import { formatLocale } from "@draft-loop/ui/locale-format";
import { t } from "@lingui/core/macro";

/**
 * The planned-maintenance banner (#2966). The API serves the operator's notice at a public route
 * (#2965); every screen, signed in or not, shows it while it exists. Dates are written in the
 * reader's own locale and time zone.
 */

/** How often a tab checks, besides whenever it regains focus. */
export const NOTICE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** How often it checks while changes are paused, so the banner leaves soon after. */
export const NOTICE_ACTIVE_CHECK_INTERVAL_MS = 60 * 1000;

export interface ServiceNotice {
  readonly kind: "maintenance";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly readOnly: boolean;
  readonly state: "upcoming" | "ongoing" | "overrunning";
}

/** The window as one phrase, such as "Dec 1, 2026, 8:00 – 10:00 PM". */
export function noticeWindow(notice: ServiceNotice, locale?: string, timeZone?: string): string {
  const format = new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  return format.formatRange(new Date(notice.startsAt), new Date(notice.endsAt));
}

/** The announced end alone, for a maintenance under way. */
export function noticeEnd(notice: ServiceNotice, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(notice.endsAt));
}

/** What the banner says. It never names a cause: only that the maintenance is planned. */
export function noticeMessage(notice: ServiceNotice, locale?: string, timeZone?: string): string {
  if (notice.state === "overrunning") {
    return t`Maintenance is taking longer than planned. Changes are still paused and come back on their own; reading and downloading stay available.`;
  }
  if (notice.state === "ongoing") {
    const end = noticeEnd(notice, locale, timeZone);
    return notice.readOnly
      ? t`Planned maintenance until ${end}: changes are paused and come back on their own. Reading and downloading stay available.`
      : t`Planned maintenance until ${end}. The service may be briefly unavailable.`;
  }
  const when = noticeWindow(notice, locale, timeZone);
  return notice.readOnly
    ? t`Planned maintenance: ${when}. Changes will be paused during it; reading and downloading stay available.`
    : t`Planned maintenance: ${when}. The service may be briefly unavailable.`;
}

/** Checks sooner while the maintenance is under way. */
export function nextCheckMs(notice: ServiceNotice | null): number {
  return notice !== null && notice.state !== "upcoming"
    ? NOTICE_ACTIVE_CHECK_INTERVAL_MS
    : NOTICE_CHECK_INTERVAL_MS;
}
