import type { CandidateEvidenceKind } from "@draft-loop/domain/candidate-evidence-kind";

/**
 * Local, deterministic detector that names the evidence kind of one normalized
 * career source. Each kind gets a score from weighted heuristic signals; the
 * best kind wins only when it scores clearly and leads the runner-up. Signals
 * are fixed heuristic names and never contain source text.
 */

export interface CandidateEvidenceKindInput {
  readonly text: string;
  readonly mediaType: string;
  readonly displayName?: string;
}

export interface CandidateEvidenceKindDetection {
  readonly kind: CandidateEvidenceKind;
  /** 0..1; for `other`, how little evidence pointed to any named kind. */
  readonly confidence: number;
  /** Names of the heuristics that fired for the chosen kind. */
  readonly signals: readonly string[];
}

/** Only the start of a source is analysed, for speed. */
export const evidenceKindAnalysisCharLimit = 20_000;
/** The best score must reach this to name a kind. */
export const evidenceKindMinScore = 3;
/** The best score must lead the runner-up by this much to name a kind. */
export const evidenceKindMinMargin = 1.5;

const maxHeadingLength = 40;
const maxFragmentLength = 80;
const maxSpeakerLabels = 8;

type ScoredKind = Exclude<CandidateEvidenceKind, "other">;

interface Scorecard {
  score: number;
  readonly signals: string[];
}

function fire(card: Scorecard, signal: string, weight: number): void {
  card.score += weight;
  card.signals.push(signal);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\u2018\u2019]/gu, "'")
    .toLowerCase();
}

function headingLabel(line: string): string | undefined {
  const label = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[*_\s]+|[*_:\s]+$/g, "")
    .trim();
  return label.length > 0 && label.length <= maxHeadingLength ? label : undefined;
}

const cvHeadingGroups: Readonly<Record<string, readonly string[]>> = {
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "work history",
    "employment",
    "employment history",
    "experience professionnelle",
    "experiences professionnelles",
    "parcours professionnel",
  ],
  education: ["education", "formation", "formations", "etudes", "education and training"],
  skills: ["skills", "technical skills", "key skills", "competences", "competences techniques"],
  projects: ["projects", "selected projects", "projets", "projets personnels"],
  certifications: ["certifications", "certificates", "certificats", "licenses and certifications"],
  profile: [
    "summary",
    "professional summary",
    "profile",
    "about",
    "profil",
    "resume professionnel",
  ],
  languages: ["languages", "langues"],
  interests: ["interests", "hobbies", "centres d'interet", "loisirs"],
};

const linkedinHeadings = new Set([
  "contact",
  "top skills",
  "experience",
  "education",
  "summary",
  "languages",
  "certifications",
  "honors-awards",
  "honors and awards",
  "publications",
  "recommendations",
  "patents",
  "courses",
]);

const reviewPhrases = [
  "performance review",
  "self-assessment",
  "self assessment",
  "auto-evaluation",
  "autoevaluation",
  "manager feedback",
  "manager comments",
  "peer feedback",
  "overall rating",
  "rating",
  "meets expectations",
  "exceeds expectations",
  "below expectations",
  "strengths",
  "areas for improvement",
  "areas of improvement",
  "development areas",
  "promotion readiness",
  "points forts",
  "axes d'amelioration",
  "points d'amelioration",
  "commentaires du manager",
  "note globale",
  "objectifs",
];

const reviewPeriodPattern =
  /\b(?:review period|review cycle|evaluation period|periode d'evaluation|cycle d'evaluation|annual review|year-end review|mid-year review|evaluation annuelle|entretien annuel|entretien d'evaluation)\b/;

const notesVocabulary = [
  "notes",
  "meeting notes",
  "to-do",
  "todo",
  "action items",
  "ideas",
  "brain dump",
  "reminders",
  "brouillon",
  "idees",
];

const monthPattern =
  "(?:jan|feb|fev|mar|apr|avr|may|mai|jun|jul|juil|aug|aou|sep|oct|nov|dec)[a-z]*\\.?";
const yearPattern = "(?:19|20)\\d{2}";
const dateRangePattern = new RegExp(
  `\\b(?:${monthPattern}\\s+)?${yearPattern}\\s*(?:-|\\u2013|\\u2014|to|a|au)\\s*(?:(?:${monthPattern}\\s+)?${yearPattern}|present|current|now|today|aujourd'hui|ce jour)\\b|\\bdepuis\\s+(?:${monthPattern}\\s+)?${yearPattern}\\b`,
  "g",
);

const durationUnit = "(?:years?|yrs?|ans?|months?|mois)";
const durationBody = `\\d+\\s+${durationUnit}(?:\\s+\\d+\\s+(?:months?|mois))?`;
const standaloneDurationPattern = new RegExp(`^${durationBody}$`);
const trailingDurationPattern = new RegExp(`\\(\\s*${durationBody}\\s*\\)$`);

const timestampPattern = /(?:^|[\s[(])\d{1,2}:\d{2}(?::\d{2})?(?=$|[\s\])])/;
const speakerLabelPattern =
  /^(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s+)?(Q|A|\p{Lu}[\p{L}.'-]*(?: \p{Lu}[\p{L}.'-]*){0,2}|Speaker \d+):\s+\S/u;
const nonSpeakerLabels = new Set([
  "note",
  "notes",
  "date",
  "email",
  "phone",
  "address",
  "skills",
  "location",
  "rating",
  "objective",
  "subject",
  "contact",
  "title",
  "company",
  "stack",
  "tel",
]);
const bulletPattern = /^(?:[-*•▪◦]|\d{1,2}[.)])\s+\S/;

const displayNameHints: Readonly<Record<ScoredKind, RegExp>> = {
  "linkedin-export": /linkedin|^profile pdf$/,
  cv: /\b(?:cv|resume|curriculum)\b/,
  "performance-review": /review|appraisal|evaluation|performance|bilan/,
  notes: /\b(?:notes?|todo|journal|brain ?dump|memo|brouillon)\b/,
  transcript: /transcript|interview|meeting|\bcall\b|entretien|reunion/,
};

interface Features {
  readonly normalizedText: string;
  readonly nonEmptyLineCount: number;
  readonly cvSectionCount: number;
  readonly linkedinSectionCount: number;
  readonly hasContactSection: boolean;
  readonly hasTopSkillsSection: boolean;
  readonly dateRangeCount: number;
  readonly durationLineCount: number;
  readonly pageFooterCount: number;
  readonly bulletCount: number;
  readonly fragmentCount: number;
  readonly speakerTurnCount: number;
  readonly speakerLabelCounts: readonly number[];
  readonly timestampCount: number;
}

function extractFeatures(text: string): Features {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const cvSections = new Set<string>();
  const linkedinSections = new Set<string>();
  const speakerLabels = new Map<string, number>();
  let durationLineCount = 0;
  let pageFooterCount = 0;
  let bulletCount = 0;
  let fragmentCount = 0;
  let speakerTurnCount = 0;
  let timestampCount = 0;

  for (const line of rawLines) {
    const normalizedLine = normalize(line);
    const label = headingLabel(normalizedLine);
    if (label !== undefined) {
      for (const [group, names] of Object.entries(cvHeadingGroups)) {
        if (names.includes(label)) cvSections.add(group);
      }
      if (linkedinHeadings.has(label)) linkedinSections.add(label);
    }
    if (
      standaloneDurationPattern.test(normalizedLine) ||
      trailingDurationPattern.test(normalizedLine)
    ) {
      durationLineCount += 1;
    }
    if (/^page \d+ (?:of|sur) \d+$/.test(normalizedLine)) pageFooterCount += 1;
    if (timestampPattern.test(line)) timestampCount += 1;

    const isBullet = bulletPattern.test(line);
    if (isBullet) bulletCount += 1;
    const body = isBullet ? line.replace(bulletPattern, (match) => match.slice(-1)) : line;
    if (
      body.length <= maxFragmentLength &&
      body.split(/\s+/).length >= 2 &&
      !/[.!?:,;]$/.test(body) &&
      !/^#{1,6}\s/.test(line)
    ) {
      fragmentCount += 1;
    }

    const speaker = speakerLabelPattern.exec(line);
    const speakerName = speaker?.[1];
    if (speakerName !== undefined && !nonSpeakerLabels.has(speakerName.toLowerCase())) {
      speakerTurnCount += 1;
      speakerLabels.set(speakerName, (speakerLabels.get(speakerName) ?? 0) + 1);
    }
  }

  const normalizedText = normalize(text);
  return {
    normalizedText,
    nonEmptyLineCount: rawLines.length,
    cvSectionCount: cvSections.size,
    linkedinSectionCount: linkedinSections.size,
    hasContactSection: linkedinSections.has("contact"),
    hasTopSkillsSection: linkedinSections.has("top skills"),
    dateRangeCount: [...normalizedText.matchAll(dateRangePattern)].length,
    durationLineCount,
    pageFooterCount,
    bulletCount,
    fragmentCount,
    speakerTurnCount,
    speakerLabelCounts: [...speakerLabels.values()].sort((a, b) => b - a),
    timestampCount,
  };
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`).test(normalizedText);
}

function scoreLinkedinExport(
  features: Features,
  isPdf: boolean,
): { card: Scorecard; specificMarkers: number } {
  const card: Scorecard = { score: 0, signals: [] };
  let specificMarkers = 0;
  if (features.normalizedText.includes("(linkedin)")) {
    fire(card, "linkedin-profile-label", 2.5);
    specificMarkers += 2.5;
  } else if (features.normalizedText.includes("linkedin.com/in/")) {
    fire(card, "linkedin-profile-url", 1);
  }
  if (features.hasTopSkillsSection) {
    fire(card, "linkedin-top-skills-section", 2);
    specificMarkers += 2;
  }
  if (features.hasContactSection && features.linkedinSectionCount >= 3) {
    fire(card, "linkedin-section-layout", 2);
  }
  if (features.durationLineCount >= 2) {
    fire(card, "linkedin-duration-lines", 2);
    specificMarkers += 2;
  }
  if (isPdf && features.pageFooterCount >= 1) fire(card, "pdf-page-footer", 0.5);
  return { card, specificMarkers };
}

function scoreCv(features: Features, linkedinSpecificMarkers: number): Scorecard {
  const card: Scorecard = { score: 0, signals: [] };
  if (features.cvSectionCount >= 2) {
    fire(card, "cv-section-headings", Math.min(features.cvSectionCount, 4));
  }
  if (features.dateRangeCount >= 2) {
    fire(card, "employment-date-ranges", features.dateRangeCount >= 4 ? 3 : 2);
  }
  if (features.bulletCount >= 5 && features.bulletCount / features.nonEmptyLineCount >= 0.2) {
    fire(card, "bullet-density", 1);
  }
  card.score -= Math.min(4, linkedinSpecificMarkers);
  return card;
}

function scoreTranscript(features: Features): Scorecard {
  const card: Scorecard = { score: 0, signals: [] };
  const share = features.speakerTurnCount / Math.max(1, features.nonEmptyLineCount);
  const [first = 0, second = 0] = features.speakerLabelCounts;
  if (
    features.speakerTurnCount >= 4 &&
    share >= 0.3 &&
    first >= 2 &&
    second >= 2 &&
    features.speakerLabelCounts.length <= maxSpeakerLabels
  ) {
    fire(card, "speaker-turns", share >= 0.6 ? 5 : 4);
  }
  if (features.timestampCount >= 3) fire(card, "timestamps", 2);
  const vocabulary = ["transcript", "interviewer", "interviewee", "transcription"];
  if (vocabulary.some((word) => containsPhrase(features.normalizedText, word))) {
    fire(card, "transcript-vocabulary", 1.5);
  }
  return card;
}

function scoreReview(features: Features): Scorecard {
  const card: Scorecard = { score: 0, signals: [] };
  const matches = reviewPhrases.filter((phrase) =>
    containsPhrase(features.normalizedText, phrase),
  ).length;
  if (matches >= 1) {
    fire(
      card,
      "review-rating-language",
      matches >= 5 ? 5 : matches >= 3 ? 4 : matches === 2 ? 2.5 : 1,
    );
  }
  if (reviewPeriodPattern.test(features.normalizedText)) fire(card, "review-period", 1.5);
  return card;
}

function scoreNotes(features: Features): Scorecard {
  const card: Scorecard = { score: 0, signals: [] };
  const lines = features.nonEmptyLineCount;
  const hasCvStructure = features.cvSectionCount >= 2 || features.dateRangeCount >= 3;
  if (hasCvStructure || lines < 3) return card;
  if (features.fragmentCount / lines >= 0.6) fire(card, "fragmentary-lines", 3);
  if (features.bulletCount >= 3 && features.bulletCount / lines >= 0.5) {
    fire(card, "bullet-fragments", 1.5);
  }
  if (notesVocabulary.some((word) => containsPhrase(features.normalizedText, word))) {
    fire(card, "notes-vocabulary", 1.5);
  }
  return card;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function detectCandidateEvidenceKind(
  input: CandidateEvidenceKindInput,
): CandidateEvidenceKindDetection {
  const text = input.text.slice(0, evidenceKindAnalysisCharLimit);
  if (text.trim().length === 0) {
    return { kind: "other", confidence: 0, signals: ["empty-text"] };
  }

  const features = extractFeatures(text);
  const linkedin = scoreLinkedinExport(features, input.mediaType === "application/pdf");
  const cards: Record<ScoredKind, Scorecard> = {
    "linkedin-export": linkedin.card,
    cv: scoreCv(features, linkedin.specificMarkers),
    transcript: scoreTranscript(features),
    "performance-review": scoreReview(features),
    notes: scoreNotes(features),
  };

  const displayName = normalize(input.displayName ?? "").replace(/[_\-.]+/g, " ");
  for (const kind of Object.keys(cards) as ScoredKind[]) {
    if (displayNameHints[kind].test(displayName)) fire(cards[kind], "display-name-hint", 1);
  }

  const ranked = (Object.entries(cards) as [ScoredKind, Scorecard][]).sort(
    (a, b) => b[1].score - a[1].score,
  );
  const [bestKind, best] = ranked[0] as [ScoredKind, Scorecard];
  const runnerUpScore = ranked[1]?.[1].score ?? 0;
  const margin = best.score - runnerUpScore;

  if (best.score < evidenceKindMinScore || margin < evidenceKindMinMargin) {
    const clear = best.score >= evidenceKindMinScore;
    return {
      kind: "other",
      confidence: round2(Math.max(0.1, 0.5 - best.score / (2 * evidenceKindMinScore))),
      signals: [clear ? "ambiguous-evidence" : "insufficient-evidence"],
    };
  }

  return {
    kind: bestKind,
    confidence: round2(clamp01(0.4 * Math.min(1, best.score / 8) + 0.6 * Math.min(1, margin / 6))),
    signals: [...best.signals],
  };
}
