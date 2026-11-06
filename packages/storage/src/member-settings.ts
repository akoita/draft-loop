/**
 * A member's own settings on the hosted service (#2373), kept with the member so they follow the
 * person to every browser and device. Owner-token deployments have no members and keep the
 * browser's choice instead.
 */

/** The screen languages a member can save; the screens' catalogs decide which exist. */
export const memberScreenLanguages = ["en", "fr"] as const;

export type MemberScreenLanguage = (typeof memberScreenLanguages)[number];

export function isMemberScreenLanguage(value: unknown): value is MemberScreenLanguage {
  return memberScreenLanguages.some((language) => language === value);
}

export interface MemberSettingsKey {
  readonly organisationId: string;
  readonly memberId: string;
}

export interface MemberSettingsStore {
  /** The member's saved screen language; `undefined` when they never chose one. */
  readonly readScreenLanguage: (
    key: MemberSettingsKey,
  ) => Promise<MemberScreenLanguage | undefined>;
  /**
   * Saves the member's screen language, replacing any earlier choice. Throws a
   * `TenantDirectoryError` with `member_not_found` when the organisation has no such member.
   */
  readonly saveScreenLanguage: (
    key: MemberSettingsKey & { readonly language: MemberScreenLanguage },
  ) => Promise<void>;
}
