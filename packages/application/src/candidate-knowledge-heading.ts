const evidenceIdCommentPattern = /^\s*<!--\s*evidence-id:\s*[^<>\r\n]+-->\s*$/iu;
const markdownHeadingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;

export interface LeadingMarkdownHeading {
  readonly line: string;
  readonly level: number;
  readonly lineIndex: number;
}

export function isCandidateEvidenceIdCommentLine(line: string): boolean {
  return evidenceIdCommentPattern.test(line);
}

/** Read a Markdown heading at the start of a chunk, allowing one evidence-id preamble. */
export function parseLeadingMarkdownHeading(text: string): LeadingMarkdownHeading | undefined {
  const lines = text.split(/\r?\n/u);
  const lineIndex = isCandidateEvidenceIdCommentLine(lines[0] ?? "") ? 1 : 0;
  const line = lines[lineIndex];
  const match = line === undefined ? null : markdownHeadingPattern.exec(line);
  if (line === undefined || match === null) return undefined;
  return {
    line,
    level: match[1]?.length ?? 0,
    lineIndex,
  };
}

/** Identify chunks that contain only an optional evidence-id preamble and one heading. */
export function isLeadingMarkdownHeadingOnly(text: string): boolean {
  const heading = parseLeadingMarkdownHeading(text);
  if (heading === undefined) return false;
  return text
    .split(/\r?\n/u)
    .slice(heading.lineIndex + 1)
    .every((line) => line.trim() === "");
}
