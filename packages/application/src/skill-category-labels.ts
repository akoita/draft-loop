/** Return the presentation-token count for the one supported Skills prefix. */
export function skillCategoryPresentationPrefixTokenCount(
  sectionKind: string,
  text: string,
): number | undefined {
  if (sectionKind !== "skills") return undefined;

  const normalized = text.normalize("NFKC");
  const label = /^[\t ]*Cloud[\t ]+and[\t ]+DevOps[\t ]*:/iu.exec(normalized);
  if (label === null || normalized.slice(label[0].length).trim() === "") return undefined;
  return 3;
}
