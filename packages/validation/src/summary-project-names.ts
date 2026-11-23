import type { DraftArtifact } from "@draft-loop/schemas";

/**
 * Internal project names at the top of a CV (#3160). A screener knows employers, well-known
 * companies and technologies, but meets a project's own name in the summary or Core areas as a
 * puzzle. A name the evidence gives only as a project or product title, and the draft never uses
 * as an employer, skill, qualification or certification, raises one quality warning per block.
 */
export interface SummaryProjectNameIssue {
  readonly code: "editorial-project-name";
  readonly message: string;
  readonly sectionId: string;
  readonly blockId: string;
  readonly location: {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
  };
}

type Artifact = Pick<DraftArtifact, "sections" | "claims">;

const roleSeparator = " | ";
/** `**Name**` that is not a label such as `**Contact**:` or `**Honesty constraints:**`. */
const boldTitlePattern = /\*\*([^*\n:]{2,60})\*\*(?!\s*:)/gu;
const headingPattern = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu;
const headingSegmentSeparator = /\s+(?:·|\||—|–|-)\s+/u;
const projectWord = /\bprojects?\b/iu;
const projectLineSeparator = /\s+(?:\||—|–|-|·)\s+|:\s|,\s/u;
const datePattern =
  /\b(?:\d{4}|present|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/iu;

/** A title worth matching: one to five words, starting with a capital letter or digit. */
function asTitle(value: string): string | undefined {
  const title = value.replace(/[`_]/gu, "").trim();
  const words = title.split(/\s+/u);
  if (title.length < 3 || words.length > 5 || !/^[\p{Lu}\p{N}]/u.test(title)) return undefined;
  return title;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function phrasePattern(title: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(title)}(?![\\p{L}\\p{N}])`, "iu");
}

/** Project and product titles as the cited evidence and the draft's Projects section give them. */
function projectTitles(artifact: Artifact): Set<string> {
  const titles = new Set<string>();
  const add = (value: string | undefined) => {
    const title = value === undefined ? undefined : asTitle(value);
    if (title !== undefined) titles.add(title);
  };
  const excerpts = new Set(
    artifact.claims.flatMap(({ evidence }) => evidence.map(({ excerpt }) => excerpt)),
  );
  for (const excerpt of excerpts) {
    for (const match of excerpt.matchAll(boldTitlePattern)) add(match[1]);
    for (const match of excerpt.matchAll(headingPattern)) {
      const segments = (match[1] ?? "").split(headingSegmentSeparator);
      if (!segments.some((segment) => projectWord.test(segment))) continue;
      for (const segment of segments) {
        if (!projectWord.test(segment) && !datePattern.test(segment)) add(segment);
      }
    }
  }
  for (const section of artifact.sections) {
    if (section.kind !== "projects") continue;
    for (const block of section.blocks) {
      if (block.type === "bullet") continue;
      add(block.text.split(projectLineSeparator)[0]);
    }
  }
  return titles;
}

/** Text a recruiter already reads as known: role lines (employers), skills and qualifications. */
function knownText(artifact: Artifact): string {
  return artifact.sections
    .flatMap((section) => {
      if (["skills", "education", "certifications", "languages"].includes(section.kind)) {
        return section.blocks.map(({ text }) => text);
      }
      if (section.kind === "experience") {
        return section.blocks
          .filter(({ type, text }) => type !== "bullet" && text.includes(roleSeparator))
          .map(({ text }) => text);
      }
      return [];
    })
    .join("\n");
}

function locationOf(text: string, start: number, end: number) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return {
    start,
    end,
    line: text.slice(0, start).split("\n").length,
    column: start - lineStart + 1,
  };
}

/** One warning per summary or Core areas block that names an internal project. */
export function findSummaryProjectNames(artifact: Artifact): SummaryProjectNameIssue[] {
  const known = knownText(artifact);
  const titles = [...projectTitles(artifact)]
    .filter((title) => !phrasePattern(title).test(known))
    .sort((left, right) => right.length - left.length);
  if (titles.length === 0) return [];
  const issues: SummaryProjectNameIssue[] = [];
  for (const section of artifact.sections) {
    if (section.kind !== "summary" && section.kind !== "alignment") continue;
    const where = section.kind === "summary" ? "the summary" : "Core areas";
    for (const block of section.blocks) {
      for (const title of titles) {
        const match = phrasePattern(title).exec(block.text);
        if (match === null) continue;
        issues.push({
          code: "editorial-project-name",
          message: `${where} names "${match[0]}", which the evidence gives only as a project title: describe the work in plain words and name the project in Experience or Projects`,
          sectionId: section.id,
          blockId: block.id,
          location: locationOf(block.text, match.index, match.index + match[0].length),
        });
        break;
      }
    }
  }
  return issues;
}
