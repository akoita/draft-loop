function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Remove only a terminal navigation note to an exact configured section title. */
export function withoutConfiguredNavigationSuffix(
  text: string,
  presentRequiredSectionTitles: readonly string[],
): string {
  for (const title of presentRequiredSectionTitles) {
    const suffix = new RegExp(`;[ \\t]+see[ \\t]+${escapePattern(title)}\\.$`, "u");
    if (suffix.test(text)) return text.replace(suffix, "");
  }
  return text;
}
