import {
  excludedTitleWords,
  linkingWords,
  narrowOpeningActionVerbs,
} from "./opening-action-verbs.js";

export const closedProgrammingLanguagePattern =
  /(?:JavaScript|TypeScript|Java|Python|Rust|Kotlin|Scala|Go)/u;
const exactProgrammingLanguagePattern = new RegExp(
  `^${closedProgrammingLanguagePattern.source}$`,
  "u",
);

const singleTechnologyNamePattern =
  /^(?:\p{Lu}{2,}(?:[+-][\p{Lu}\p{N}]+)*|\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*)$/u;
const capitalizedWordPattern = /^\p{Lu}[\p{L}\p{N}]*$/u;
const languageObjectPhrasePattern =
  /^[ \t]+(?:(?:event[ \t]+)?ingestion|event[ \t]+processing|tools?|tooling|applications?|apps?|services?|systems?|software|integrations?|adapters?|pipelines?|libraries|infrastructure|components?|clients?|prox(?:y|ies))(?![\p{L}\p{N}])/u;
const softwareObjectFollowedByEmployerPattern =
  /^[ \t]+(?:(?:event[ \t]+)?ingestion|event[ \t]+processing|tools?|tooling|applications?|apps?|services?|systems?|software|integrations?|adapters?|pipelines?|libraries|infrastructure|components?|clients?|prox(?:y|ies))[ \t]+(?:company|firm|employer)\b/u;
const precedingEmployerPattern = /\b(?:at|for|employed[ \t]+by|joined)[ \t]+$/iu;
const softwareNounPattern =
  "(?:tools?|tooling|applications?|apps?|services?|systems?|software|integrations?|adapters?|pipelines?|libraries|library|tests?|infrastructure|components?|clients?|prox(?:y|ies))";
const appositiveQualifiersPattern = "(?:(?:model-driven|engineering|in-house|supervision)[ \\t]+)*";
const precedingGeneratedLanguageConjunctionPattern = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:generating|producing)[ \\t]+${closedProgrammingLanguagePattern.source}[ \\t]+and[ \\t]+$`,
  "iu",
);

export const softwareObjectAppositivePattern = new RegExp(
  `^[ \\t]*,[ \\t]+(?:a|an|the)[ \\t]+${appositiveQualifiersPattern}${softwareNounPattern}(?![\\p{L}\\p{N}])`,
  "iu",
);

const softwareObjectLanguageAppositivePattern = new RegExp(
  `^[ \\t]*,[ \\t]+(?:a|an|the)[ \\t]+(${closedProgrammingLanguagePattern.source})[ \\t]+${appositiveQualifiersPattern}${softwareNounPattern}(?![\\p{L}\\p{N}])`,
  "u",
);

export interface ProtectedSoftwareDescriptionPart {
  readonly value: string;
  readonly start: number;
}

/** Return only the bounded language, product-name, or MVP components in a software phrase. */
export function protectedSoftwareDescriptionParts(
  text: string,
  matched: string,
  start: number,
): readonly ProtectedSoftwareDescriptionPart[] {
  const words = matched.split(/\s+/u);
  if (words.length !== 2) return [];
  const [first, second] = words;
  if (first === undefined || second === undefined) return [];

  const firstStart = start + matched.indexOf(first);
  const secondStart = start + matched.lastIndexOf(second);
  const following = text.slice(start + matched.length);
  const preceding = text.slice(0, start);
  const precedingWord = preceding
    .trimEnd()
    .split(/[ \t]+/u)
    .at(-1);
  const hasEmployerOrTitleOrLinkingContext =
    precedingEmployerPattern.test(preceding) ||
    (precedingWord !== undefined &&
      [...excludedTitleWords, ...linkingWords].some(
        (word) =>
          word === precedingWord &&
          !(word === "and" && precedingGeneratedLanguageConjunctionPattern.test(preceding)),
      ));

  if (
    exactProgrammingLanguagePattern.test(first) &&
    capitalizedWordPattern.test(second) &&
    languageObjectPhrasePattern.test(following) &&
    !softwareObjectFollowedByEmployerPattern.test(following) &&
    !hasEmployerOrTitleOrLinkingContext
  ) {
    return [
      { value: first, start: firstStart },
      { value: second, start: secondStart },
    ];
  }

  if (text.slice(0, start).trim() !== "") return [];

  if (singleTechnologyNamePattern.test(first) && second === "MVP" && /^:[ \t]*/u.test(following)) {
    return [
      { value: first, start: firstStart },
      { value: second, start: secondStart },
    ];
  }

  const actionName = matched.split(/\s+/u);
  const [action, name] = actionName;
  if (
    actionName.length !== 2 ||
    action === undefined ||
    name === undefined ||
    !narrowOpeningActionVerbs.has(action) ||
    !singleTechnologyNamePattern.test(name)
  )
    return [];
  const languageMatch = softwareObjectLanguageAppositivePattern.exec(following);
  if (languageMatch?.[1] === undefined) return [];
  const articleEnd = /^[ \t]*,[ \t]+(?:a|an|the)[ \t]+/iu.exec(following)?.[0].length;
  if (articleEnd === undefined) return [];
  const languageStart = start + matched.length + articleEnd;
  return [
    { value: name, start: start + matched.indexOf(name) },
    { value: languageMatch[1], start: languageStart },
  ];
}
