/**
 * Dates, numbers, money and lists as the active screen locale writes them (#2322). Every screen
 * formats through this module instead of calling `toLocale*` itself, so switching the screens'
 * language also switches how they write dates and amounts.
 *
 * English screens write British English ("24 Nov 2026", "Anthropic and OpenAI"): DraftLoop
 * serves the EU. A caller may pass an explicit locale, as tests and exports do.
 */
import { i18n } from "@lingui/core";

/** The `Intl` locale each screen locale formats with; the pseudo-locale formats as English. */
const formatLocales: Readonly<Record<string, string>> = {
  en: "en-GB",
  pseudo: "en-GB",
  fr: "fr-FR",
};

/** The `Intl` locale for the active screen locale, or for an explicit one. */
export function formatLocale(locale?: string): string {
  if (locale !== undefined && locale.includes("-")) return locale;
  return formatLocales[locale ?? i18n.locale] ?? formatLocales.en ?? "en-GB";
}

export interface FormatOptions {
  /** An explicit screen or `Intl` locale; the active screen locale when left out. */
  readonly locale?: string;
  /** An IANA time zone, such as `UTC`; the viewer's own when left out. */
  readonly timeZone?: string;
}

function asDate(value: Date | string | number): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function zoned(options: FormatOptions): { timeZone?: string } {
  return options.timeZone === undefined ? {} : { timeZone: options.timeZone };
}

/** A date and time, such as `24 Nov 2026, 14:05`; `undefined` for an invalid date. */
export function formatDateTime(
  value: Date | string | number,
  options: FormatOptions = {},
): string | undefined {
  const date = asDate(value);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(formatLocale(options.locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...zoned(options),
  }).format(date);
}

/** A date, such as `24 Nov 2026`; `undefined` for an invalid date. */
export function formatDate(
  value: Date | string | number,
  options: FormatOptions = {},
): string | undefined {
  const date = asDate(value);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(formatLocale(options.locale), {
    dateStyle: "medium",
    ...zoned(options),
  }).format(date);
}

/** A time of day, such as `14:05:09`; `undefined` for an invalid date. */
export function formatTime(
  value: Date | string | number,
  options: FormatOptions = {},
): string | undefined {
  const date = asDate(value);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(formatLocale(options.locale), {
    timeStyle: "medium",
    ...zoned(options),
  }).format(date);
}

/** A whole or decimal number with the locale's grouping, such as `12,000` or `12 000`. */
export function formatNumber(value: number, options: Pick<FormatOptions, "locale"> = {}): string {
  return new Intl.NumberFormat(formatLocale(options.locale)).format(value);
}

/** An amount in euros, such as `€19.00` or `19,00 €`. */
export function formatEuros(value: number, options: Pick<FormatOptions, "locale"> = {}): string {
  return new Intl.NumberFormat(formatLocale(options.locale), {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

/** Items joined as the locale lists them, such as `Anthropic and OpenAI` or `A, B et C`. */
export function formatList(
  items: readonly string[],
  options: Pick<FormatOptions, "locale"> & { readonly type?: "conjunction" | "disjunction" } = {},
): string {
  return new Intl.ListFormat(formatLocale(options.locale), {
    style: "long",
    type: options.type ?? "conjunction",
  }).format(items);
}

/** The locale's plural category for a count, such as `one` or `other`. */
export function pluralCategory(
  count: number,
  options: Pick<FormatOptions, "locale"> = {},
): Intl.LDMLPluralRule {
  return new Intl.PluralRules(formatLocale(options.locale)).select(count);
}
