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
  `(?:^|[^\\p{L}\\p{N}])(?:generating|producing|generated)[ \\t]+${closedProgrammingLanguagePattern.source}[ \\t]+and[ \\t]+$`,
  "iu",
);
const deliveredMvpApiPattern = /\bdelivered[ \t]+as[ \t]+an[ \t]+$/iu;
const replacingHaskellDslPattern = /\breplacing[ \t]+an[ \t]+unmaintainable[ \t]+$/iu;

export const softwareObjectAppositivePattern = new RegExp(
  `^[ \\t]*,[ \\t]+(?:a|an|the)[ \\t]+${appositiveQualifiersPattern}${softwareNounPattern}(?![\\p{L}\\p{N}])`,
  "iu",
);

const softwareObjectLanguageAppositivePattern = new RegExp(
  `^[ \\t]*,[ \\t]+(?:a|an|the)[ \\t]+(${closedProgrammingLanguagePattern.source})[ \\t]+${appositiveQualifiersPattern}${softwareNounPattern}(?![\\p{L}\\p{N}])`,
  "u",
);
const leadingThenChaincodePattern = /^[ \t]+chaincodes?(?![\p{L}\p{N}])/iu;
const apiAuthenticationPattern = /^[ \t]+authentication(?![\p{L}\p{N}])/u;
const apiAuthenticationEmployerPattern = /^[ \t]+authentication[ \t]+(?:company|firm|employer)\b/iu;
const technicalNamePattern =
  /^(?:\p{Lu}{2,}(?:[+-][\p{Lu}\p{N}]+)*|\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*|\p{Lu}{2,}\p{Ll}[\p{L}\p{N}]*)$/u;
const usedTechnicalPairPattern =
  /^[ \t]+and[ \t]+(?<name>\p{Lu}[\p{L}\p{N}]*)[ \t]+to[ \t]+\p{Ll}[\p{L}'’-]*/u;

export interface ProtectedSoftwareDescriptionPart {
  readonly value: string;
  readonly start: number;
}

function isTitleOrLinkingWord(word: string): boolean {
  return excludedTitleWords.has(word) || linkingWords.has(word.toLocaleLowerCase("en-US"));
}

function leadingThenProductPart(
  text: string,
  matched: string,
  words: readonly string[],
  start: number,
): readonly ProtectedSoftwareDescriptionPart[] {
  if (
    words[0] !== "Then" ||
    words.length < 2 ||
    text.slice(0, start).trim() !== "" ||
    !leadingThenChaincodePattern.test(text.slice(start + matched.length))
  ) {
    return [];
  }

  const nameWords = words.slice(1);
  if (nameWords.some((word) => !capitalizedWordPattern.test(word) || isTitleOrLinkingWord(word))) {
    return [];
  }
  const name = nameWords.join(" ");
  return [{ value: name, start: start + matched.indexOf(name) }];
}

/** Return only the bounded language, product-name, or MVP components in a software phrase. */
export function protectedSoftwareDescriptionParts(
  text: string,
  matched: string,
  start: number,
): readonly ProtectedSoftwareDescriptionPart[] {
  const words = matched.split(/\s+/u);
  const leadingThen = leadingThenProductPart(text, matched, words, start);
  if (leadingThen.length > 0) return leadingThen;

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

  if (words.length !== 2) return [];
  const [first, second] = words;
  if (first === undefined || second === undefined) return [];

  if (
    first === "MVP" &&
    second === "API" &&
    deliveredMvpApiPattern.test(preceding) &&
    /^:[ \t]*/u.test(following) &&
    !hasEmployerOrTitleOrLinkingContext
  ) {
    return [
      { value: first, start: start + matched.indexOf(first) },
      { value: second, start: start + matched.lastIndexOf(second) },
    ];
  }

  if (
    first === "Haskell" &&
    second === "DSL" &&
    replacingHaskellDslPattern.test(preceding) &&
    /^;/u.test(following) &&
    !hasEmployerOrTitleOrLinkingContext
  ) {
    return [
      { value: first, start: start + matched.indexOf(first) },
      { value: second, start: start + matched.lastIndexOf(second) },
    ];
  }

  const firstStart = start + matched.indexOf(first);
  const secondStart = start + matched.lastIndexOf(second);
  if (
    capitalizedWordPattern.test(first) &&
    second === "API" &&
    apiAuthenticationPattern.test(following) &&
    !apiAuthenticationEmployerPattern.test(following) &&
    !exactProgrammingLanguagePattern.test(first) &&
    !isTitleOrLinkingWord(first) &&
    !hasEmployerOrTitleOrLinkingContext
  ) {
    return [
      { value: first, start: firstStart },
      { value: second, start: secondStart },
    ];
  }

  const usedPair = usedTechnicalPairPattern.exec(following);
  const secondUsedName = usedPair?.groups?.name;
  if (
    text.slice(0, start).trim() === "" &&
    first === "Used" &&
    technicalNamePattern.test(second) &&
    !isTitleOrLinkingWord(second) &&
    secondUsedName !== undefined &&
    technicalNamePattern.test(secondUsedName) &&
    !isTitleOrLinkingWord(secondUsedName)
  ) {
    return [
      { value: second, start: secondStart },
      {
        value: secondUsedName,
        start: start + matched.length + (usedPair?.[0].indexOf(secondUsedName) ?? 0),
      },
    ];
  }

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
