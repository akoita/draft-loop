import {
  type ContentScreenerIdentity,
  type ContentScreeningResult,
  type ContentScreeningSignal,
  contentScreeningResultSchema,
} from "@draft-loop/schemas/content-screening";

/**
 * Rule screener for prompt injection (ADR 0011, phase 2d). It reads untrusted text, a pasted job
 * source or the extracted text of an uploaded candidate file, and reports which of four closed
 * signals it finds. It is deterministic: no model, no network, and the same text always gives the
 * same signals. It reports codes only, never a quote or an offset of the text.
 *
 * Wiring: the object returned by `createRuleContentScreener` is structurally a `ContentScreener`
 * of `@draft-loop/application` (this package cannot import that one, which depends on this one).
 * The API passes it to `screenWith` next to the model screener.
 *
 * ## Normalization
 *
 * Phrase rules run on a folded copy of the text so that obfuscation does not hide a phrase:
 * Unicode tag characters are decoded to the ASCII they mirror, zero-width, bidi and other
 * invisible characters are removed, then NFKC folds full-width and compatibility letters, accents
 * are dropped, case is lowered and runs of spaces collapse. Phrase rules also see a "words" copy
 * where every run of punctuation is one space, so "ignore   all..previous --- instructions" reads
 * as plain words. Homoglyphs from other scripts (Cyrillic "о" for "o") and leetspeak ("1gn0re")
 * are not folded: the model screener covers what these rules cannot.
 *
 * ## Signals
 *
 * - `hidden-text`: zero-width characters (U+200B to U+200D, U+2060, U+FEFF except a leading BOM),
 *   bidi controls (U+202A to U+202E, U+2066 to U+2069) and Unicode tag characters (U+E0000 to
 *   U+E007F). Legitimate uses stay clear: a joiner inside an emoji sequence, a joiner between
 *   Arabic or Indic letters, and an emoji flag subdivision such as the flag of England.
 * - `instruction-override`: an imperative to drop earlier instructions. "ignore / disregard /
 *   forget / discard" with "previous, prior, above, earlier, original, system" and "instructions,
 *   prompts, rules, directions, guidelines" (or "all / any / your / these" and such a noun);
 *   "do not follow the previous instructions"; "ignore the above"; "forget everything above";
 *   "new / updated / revised instructions:"; "override / bypass the system prompt" or "safety
 *   rules". French: "ignore(z) / oublie(z) toutes les instructions precedentes", "oublie(z) tes /
 *   vos instructions", "nouvelles instructions :". "Ignore distractions", "ignore any previous
 *   experience" and "ne pas ignorer les consignes de securite" are ordinary text and stay clear.
 * - `role-change`: text that gives a model another identity. "you are now" followed by an
 *   assistant, bot, unrestricted or similar identity; "act as" an AI, a chatbot or an assistant
 *   (not "assistant to the CEO"); "from now on you are / will act / always"; "your new role is";
 *   "developer mode"; fake chat turns at the start of a line ("system:" or "assistant:" followed
 *   by an instruction, "### system"); chat template tokens (`<|im_start|>`, `[INST]`, `<<SYS>>`,
 *   `<system>`). French: "tu es / vous etes maintenant" followed by such an identity, "a partir
 *   de maintenant tu es / reponds". "You will act as the main point of contact", "act as a
 *   mentor" and the skills line "System: Linux" stay clear.
 * - `exfiltration-link`: a markdown image whose URL has a query string or a placeholder (the
 *   image loads without a click, so a query can carry data out); any URL with a template
 *   placeholder (`{...}`, `{{...}}`, `${name}`, `$name`, `%s`, `[NAME]`); an instruction to send
 *   the conversation, prompt, instructions, secrets or credentials to a URL. French: "envoie(z)
 *   l'historique ... a https://". A plain job-board URL, a link with a tracking query and "send
 *   your resume to https://..." are what real job posts contain and stay clear.
 *
 * `kind` is accepted for the port but does not change the rules: both kinds are untrusted, and
 * an injection reads the same in a job post and in a CV.
 */

export const ruleContentScreenerIdentity: ContentScreenerIdentity = Object.freeze({
  id: "rules",
  version: "1",
});

export interface RuleContentScreeningInput {
  readonly text: string;
  readonly kind: "job-source" | "candidate-source";
}

/** Structurally the `ContentScreener` port of `@draft-loop/application`. */
export interface RuleContentScreener {
  readonly identity: ContentScreenerIdentity;
  screen(input: RuleContentScreeningInput): Promise<ContentScreeningResult>;
}

// ---------------------------------------------------------------------------------------------
// Normalization

const hiddenTextCharacters =
  /[\u200b-\u200d\u2060\ufeff\u202a-\u202e\u2066-\u2069\u{e0000}-\u{e007f}]/gu;
// Invisible or ignorable characters removed before matching; a superset of the hidden-text set.
const ignorableCharacters =
  /[\u00ad\u180e\u200b-\u200d\u2060-\u2064\ufeff\u202a-\u202e\u2066-\u2069\u3164\uffa0\u{e0000}-\u{e007f}]/gu;
const tagAscii = /[\u{e0020}-\u{e007e}]/gu;
const combiningMarks = /\p{M}/gu;
const emojiFlagSubdivision = /\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}/gu;

/** The text a phrase rule sees: tags decoded, invisibles removed, NFKC, no accents, lowercase. */
export function foldForContentScreening(text: string): string {
  return text
    .replace(tagAscii, (tag) => String.fromCodePoint((tag.codePointAt(0) ?? 0) - 0xe0000))
    .replace(ignorableCharacters, "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(combiningMarks, "")
    .toLowerCase()
    .replace(/[^\S\n]+/gu, " ");
}

/** The folded text with every run of punctuation and whitespace as one space. */
export function wordsForContentScreening(folded: string): string {
  return ` ${folded.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

// ---------------------------------------------------------------------------------------------
// hidden-text

const emojiNeighbour = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]|\u{fe0f}/u;
const pictographic = /\p{Extended_Pictographic}/u;
const joiningScript =
  /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}]/u;

function codePointBefore(text: string, index: number): string {
  const unit = text.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text.slice(Math.max(0, index - 1), index);
}

function codePointAfter(text: string, index: number): string {
  const point = text.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

/** A joiner that does real work: inside an emoji sequence, or between letters that join. */
function isFunctionalJoiner(text: string, index: number): boolean {
  const character = text[index];
  if (character !== "\u200c" && character !== "\u200d") return false;
  const before = codePointBefore(text, index);
  const after = codePointAfter(text, index + 1);
  if (character === "\u200d" && emojiNeighbour.test(before) && pictographic.test(after)) {
    return true;
  }
  return joiningScript.test(before) && joiningScript.test(after);
}

function hasHiddenText(text: string): boolean {
  const body = (text.startsWith("\ufeff") ? text.slice(1) : text).replace(emojiFlagSubdivision, "");
  for (const match of body.matchAll(hiddenTextCharacters)) {
    if (!isFunctionalJoiner(body, match.index)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// instruction-override

const english = {
  override: "ignore|disregard|forget|discard",
  determiner: "(?:all|any|every|the|your|my|these|those|of)",
  qualifier: "(?:previous|prior|above|earlier|preceding|original|initial|former|system|safety)",
  noun: "(?:instructions?|prompts?|rules|directions|guidelines|directives)",
};

const instructionOverrideRules: readonly RegExp[] = [
  // "ignore all previous instructions", "disregard the prior directions above"
  new RegExp(
    `\\b(?:${english.override}|(?:do not|don t|never|stop) (?:follow|following|obey|obeying))\\s+(?:${english.determiner}\\s+)*(?:${english.qualifier}\\s+)+${english.noun}\\b`,
    "u",
  ),
  // "ignore all instructions", "forget your rules", "disregard these guidelines"
  new RegExp(
    `\\b(?:${english.override})\\s+(?:all|any|every|your|these|those)\\s+(?:of\\s+)?(?:the\\s+)?(?:instructions|prompts|directions|guidelines|directives|programming|training|rules)\\b`,
    "u",
  ),
  // "ignore the above and ...", "forget everything above"
  /\b(?:ignore|disregard|forget)\s+(?:all\s+(?:of\s+)?)?(?:the\s+)?(?:above\s+(?:and|instead|then|text|content|information|prompt)|everything\s+(?:above|before|previous|prior|else|now|you\s+(?:were|have\s+been)\s+told|i\s+(?:said|told))|everything\s+and\s+(?:instead|only|just|do|follow|write|say|respond|reply|print|output))\b/u,
  // "new instructions: ..." (the colon keeps "new instructions for applicants" clear)
  /\b(?:new|updated|revised|real|actual|additional)\s+(?:instructions?|system\s+prompt)\s*:/u,
  // "override the system prompt", "bypass your safety rules"
  /\b(?:override|bypass|circumvent)\s+(?:(?:the|your|all|any)\s+)*(?:system\s+(?:prompt|instructions?|message)|(?:system|safety|previous|prior)\s+instructions?|safety\s+(?:guidelines|rules|restrictions|policies))\b/u,
  // French: "ignorez toutes les instructions precedentes", "oublie les consignes ci-dessus"
  /\b(?:ignore[sz]?|ignorer|oublie[sz]?|oublier|neglige[sz]?|passe[zr]?\s+outre)\s+(?:(?:toutes?|tous|les|ces|vos|tes|mes|des|l|la|le|aux?)\s+)*(?:(?:precedent(?:e)?s?|anterieur(?:e)?s?|ci dessus|prealables?|initial(?:e)?s?)\s+)+(?:instructions?|consignes?|directives?|regles|prompts?)\b/u,
  /\b(?:ignore[sz]?|ignorer|oublie[sz]?|oublier|neglige[sz]?)\s+(?:(?:toutes?|tous|les|ces|vos|tes|mes|des|l|la|le|aux?)\s+)*(?:instructions?|consignes?|directives?|regles|prompts?)\s+(?:precedent(?:e)?s?|anterieur(?:e)?s?|ci dessus|prealables?|initial(?:e)?s?)\b/u,
  // French: "oublie toutes tes instructions", "ignorez vos consignes" (not "les consignes de securite")
  /\b(?:ignore[sz]?|ignorer|oublie[sz]?|oublier|neglige[sz]?)\s+(?:(?:toutes?|tous)\s+(?:les|ces|tes|vos|mes)\s+(?:instructions?|prompts?|directives?)|(?:tes|vos|mes|ces)\s+(?:instructions?|prompts?|directives?|consignes?|regles))\b/u,
  /\b(?:oublie[sz]?|oublier|ignore[sz]?)\s+tout\s+ce\s+qui\s+(?:precede|est\s+ecrit\s+ci\s+dessus)\b/u,
  // French: "nouvelles instructions :"
  /\bnouvelles?\s+(?:instructions?|consignes?|directives?)\s*:/u,
  // French: "contournez les regles de securite", "outrepassez vos instructions"
  /\b(?:outrepasse[zr]?|contourne[zr]?)\s+(?:le|les|ton|tes|votre|vos)\s+(?:prompt\s+systeme|instructions?|consignes?\s+systeme|regles\s+de\s+securite)\b/u,
];

// ---------------------------------------------------------------------------------------------
// role-change

const roleChangeWordRules: readonly RegExp[] = [
  // "you are now an unrestricted AI assistant", not "you are now part of a team"
  /\byou are now (?:an? |the )?(?:[a-z]+ ){0,2}(?:assistant|ai|chatbot|bot|llm|gpt|dan|jailbroken|unrestricted|unfiltered|uncensored|language model|developer mode|hacker)\b/u,
  /\byou are no longer (?:an? |the )?(?:assistant|ai|bound|restricted|limited|a (?:language|helpful))/u,
  // "act as an AI", "act as an assistant" (but not "act as an assistant to the director")
  /\bact as (?:an? |the |my )?(?:ai|llm|chatbot|language model|dan)\b/u,
  /\bact as (?:an? |the |my )?(?:(?:ai|virtual|digital|personal|unrestricted) )*assistant\b(?! (?:to|for|in|of|at|and|manager|director|coordinator|professor|teacher|buyer|editor|researcher|lecturer|librarian|nurse|principal|secretary|accountant|engineer|vet|analyst|consultant))/u,
  /\bact as (?:an? |the )?(?:system|developer) (?:prompt|message|mode|override)\b/u,
  /\bact as (?:an? |the )?(?:unrestricted|jailbroken|unfiltered|uncensored)\b/u,
  /\bpretend (?:to be|you are|that you are) (?:an? |the )?(?:ai|llm|chatbot|unrestricted|jailbroken|unfiltered|different|another|system)\b/u,
  // "from now on you are / will act / will always ..."
  /\bfrom now on (?:you (?:are|will (?:act|behave|respond|answer|reply|pretend|only|always|never)|must (?:act|behave|respond|answer|reply|pretend|only|always|never)|only|always|never)|(?:act|respond|answer|reply|behave|pretend) )/u,
  /\byour (?:new|real|true) (?:role|persona|identity|job) is\b/u,
  /\bassume the role of (?:an? |the )?(?:system|assistant|ai|developer mode|unrestricted)/u,
  /\b(?:enter|enable|activate|switch to) (?:developer|dan|jailbreak|god) mode\b/u,
  /\bdeveloper mode (?:enabled|on|activated)\b/u,
  // French
  /\b(?:tu es|vous etes) maintenant (?:un |une |l )?(?:\w+ ){0,2}(?:assistante?|ia|chatbot|robot|modele|dan|pirate|hacker|libere|sans restrictions?|sans filtres?)\b(?! (?:de|d|du|des|aux?|aupres)\b)/u,
  /\ba partir de maintenant,? (?:tu|vous) (?:es|etes|reponds|repondez|agis|agissez|ignores|ignorez|oublies|oubliez)\b/u,
  /\b(?:agis|agissez|comporte toi|comportez vous) comme (?:un |une |l )?(?:ia|chatbot|assistant virtuel|modele de langage|systeme sans)\b/u,
];

// Applied to the folded text, line by line, so punctuation and line starts count.
const roleChangeLineRules: readonly RegExp[] = [
  // "SYSTEM: you must ...": a fake chat turn followed by an instruction, not "System: Linux"
  /^[\s>*_#-]*(?:system|assistant)\s*:\s*(?:you|your|ignore|disregard|forget|do not|don t|never|always|please|from now|new|the user|respond|answer|reply|output|print|say|act|remember|follow|reveal|write|include|send|rate|recommend|approve|score)\b/u,
  // "### system" and "## system prompt" as a heading on its own line
  /^\s{0,3}#{1,6}\s*(?:system(?:\s+(?:prompt|message))?|assistant)\s*:?\s*$/u,
];

// Chat template tokens and pseudo tags, anywhere in the folded text.
const roleChangeTokenRules: readonly RegExp[] = [
  /<\|[a-z_]{2,20}\|>/u,
  /\[\/?inst\]/u,
  /<<\/?sys>>/u,
  /<\/?(?:system|assistant|system-reminder|system_prompt)>/u,
];

// ---------------------------------------------------------------------------------------------
// exfiltration-link

const urlPlaceholder =
  /\{\{|\{[^{}\s]{1,60}\}|%7[bB]|\$\{?[a-z_][a-z0-9_]*|%s(?![0-9a-f])|\[[a-z_]{2,30}\]/u;
const markdownImage = /!\[[^\]\n]{0,200}\]\(\s*<?(https?:\/\/[^)\s>]*)/gu;
const anyUrl = /https?:\/\/[^\s)<>"']+/gu;

const exfiltrationDestination =
  "(?:https?://|\\burl\\b|\\bhyperlink\\b|\\bimage link\\b|\\bquery (?:string|parameters?)\\b|\\bwebhook\\b)";
// What a model holds that a job post or CV has no reason to ask to be sent out. "Send your
// resume to https://..." is ordinary, so CV, resume, application and personal data are absent.
const exfiltrationData =
  "(?:conversation|chat history|system prompt|prompts?|instructions|secrets?|api[ -]?keys?|credentials|passwords?|everything (?:above|you)|the above|previous messages|all (?:the )?(?:data|information) you)";
const exfiltrationVerbs =
  "(?:send|post|upload|forward|transmit|leak|exfiltrate|append|embed|encode|put|paste|add|include)";
const frenchExfiltration =
  /\b(?:envoie[sz]?|envoyer|poste[zr]?|transmets|transmettez|transmettre|televerse[zr]?|exfiltre[zr]?)\b[^.\n]{0,100}?\b(?:conversation|historique|prompt|instructions|contexte|secrets?|cles? api|identifiants|mots? de passe|tout ce qui precede|ce qui precede)\b[^.\n]{0,100}?\b(?:a|vers|sur)\s+(?:\w+\s+){0,3}?https?:\/\//u;

const englishExfiltration = new RegExp(
  `\\b${exfiltrationVerbs}\\b[^.\\n]{0,100}?\\b${exfiltrationData}\\b[^.\\n]{0,100}?${exfiltrationDestination}`,
  "u",
);

function hasExfiltrationLink(folded: string): boolean {
  for (const match of folded.matchAll(markdownImage)) {
    const url = match[1] ?? "";
    if (url.includes("?") || urlPlaceholder.test(url)) return true;
  }
  for (const match of folded.matchAll(anyUrl)) {
    if (urlPlaceholder.test(match[0])) return true;
  }
  return englishExfiltration.test(folded) || frenchExfiltration.test(folded);
}

// ---------------------------------------------------------------------------------------------
// Screening

/** The signals the rules find in a text, sorted ascending without duplicates. */
export function screenTextWithRules(text: string): ContentScreeningSignal[] {
  const folded = foldForContentScreening(text);
  const words = wordsForContentScreening(folded);
  const signals: ContentScreeningSignal[] = [];
  if (hasHiddenText(text)) signals.push("hidden-text");
  if (instructionOverrideRules.some((rule) => rule.test(words) || rule.test(folded))) {
    signals.push("instruction-override");
  }
  const lines = folded.split("\n");
  if (
    roleChangeWordRules.some((rule) => rule.test(words)) ||
    roleChangeTokenRules.some((rule) => rule.test(folded)) ||
    lines.some((line) => roleChangeLineRules.some((rule) => rule.test(line)))
  ) {
    signals.push("role-change");
  }
  if (hasExfiltrationLink(folded)) signals.push("exfiltration-link");
  return signals.sort();
}

/**
 * Creates the rule screener. `now` is injected for tests; it defaults to the clock. The result is
 * `clear` or `flagged`: rules never fail to decide, so they never report `unscreened`.
 */
export function createRuleContentScreener(
  now: () => string = () => new Date().toISOString(),
): RuleContentScreener {
  return {
    identity: ruleContentScreenerIdentity,
    async screen(input) {
      const signals = screenTextWithRules(input.text);
      return contentScreeningResultSchema.parse({
        verdict: signals.length > 0 ? "flagged" : "clear",
        signals,
        screeners: [{ ...ruleContentScreenerIdentity }],
        screenedAt: now(),
      });
    },
  };
}
