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

/**
 * How the screens show themselves to a member (#2788): `guided` walks a newcomer through one step
 * at a time, `standard` is the simple view with folded Advanced options, and `everything` opens
 * every Advanced options section. `null` means the member never answered the first-run question.
 */
export const memberDisplayModes = ["guided", "standard", "everything"] as const;

export type MemberDisplayMode = (typeof memberDisplayModes)[number];

export function isMemberDisplayMode(value: unknown): value is MemberDisplayMode {
  return memberDisplayModes.some((mode) => mode === value);
}

export interface MemberDisplayPreference {
  readonly mode: MemberDisplayMode | null;
  /** True once the member hid the Getting started guide on Home. */
  readonly guideHidden: boolean;
}

/** What a member who never chose anything gets: today's simple view, the guide not hidden. */
export const defaultMemberDisplayPreference: MemberDisplayPreference = Object.freeze({
  mode: null,
  guideHidden: false,
});

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
  /** The member's display preference; the default when they never chose one. */
  readonly readDisplayPreference: (key: MemberSettingsKey) => Promise<MemberDisplayPreference>;
  /**
   * Saves the member's display preference, replacing any earlier one. Throws a
   * `TenantDirectoryError` with `member_not_found` when the organisation has no such member.
   */
  readonly saveDisplayPreference: (
    key: MemberSettingsKey & { readonly preference: MemberDisplayPreference },
  ) => Promise<void>;
}
