/** A deliberately closed enumeration grammar, not general clause parsing. */
const alternative = String.raw`(?!(?:and|or)(?![\p{L}\p{N}]))[\p{L}\p{N}](?:[\p{L}\p{N}.+#/-]*[\p{L}\p{N}])?`;
const enumerationPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:${alternative}, ){0,4}${alternative}),? or (${alternative})(?![\\p{L}\\p{N}])`,
  "iu",
);
const standaloneOr = /(?<![\p{L}\p{N}])or(?![\p{L}\p{N}])/giu;
// Conservative: an `and` list states a compound condition, not permitted alternatives.
const standaloneAnd = /(?<![\p{L}\p{N}])and(?![\p{L}\p{N}])/iu;
// A capitalized neighbouring word suggests a multi-word alternative this rule does not parse.
const capitalizedBefore = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}]* $/u;
const capitalizedAfter = /^ \p{Lu}[\p{L}\p{N}]*(?![\p{L}\p{N}])/u;
const maximumAlternatives = 5;

/**
 * Undefined leaves the requirement to ordinary matching as a single branch.
 * A recognized enumeration returns one branch per permitted alternative, each
 * retaining every condition stated outside the enumeration, so that listing more
 * alternatives cannot make a requirement harder to satisfy. This rewrites text
 * only; tokenization and matching stay with the coverage rule.
 */
export function alternativeRequirementBranches(requirement: string): readonly string[] | undefined {
  const text = requirement.normalize("NFKC");
  if (standaloneAnd.test(text)) return undefined;
  if ((text.match(standaloneOr) ?? []).length !== 1) return undefined;
  const enumeration = enumerationPattern.exec(text);
  if (enumeration === null) return undefined;
  const prefix = text.slice(0, enumeration.index);
  const suffix = text.slice(enumeration.index + enumeration[0].length);
  if (capitalizedBefore.test(prefix) || capitalizedAfter.test(suffix)) return undefined;
  const alternatives = [...(enumeration[1] ?? "").split(", "), enumeration[2] ?? ""];
  if (alternatives.length < 2 || alternatives.length > maximumAlternatives) return undefined;
  return alternatives.map((permitted) => `${prefix}${permitted}${suffix}`);
}
