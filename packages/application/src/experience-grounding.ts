// Deliberately limited to single acronyms and mixed-case technology names.
const technology = "(?:\\p{Lu}{2,}|\\p{Lu}\\p{Ll}+\\p{Lu}[\\p{L}\\p{N}]*)";
const claimPattern = new RegExp(`^([Nn]o )?(${technology}) experience[.!]?$`, "u");

interface ExperienceStatement {
  readonly name: string;
  readonly negative: boolean;
}

function canonical(statement: ExperienceStatement): string {
  return `${statement.negative ? "No " : ""}${statement.name} experience`;
}

/** A whole, unqualified statement; titles, clauses, and ambiguous names stay unchanged. */
export function experienceClaimValues(text: string): readonly string[] | undefined {
  const match = claimPattern.exec(text.trim());
  if (!match?.[2]) return undefined;
  return [canonical({ name: match[2], negative: match[1] !== undefined }), match[2]];
}

function statements(text: string): readonly ExperienceStatement[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const value = line
      .trim()
      .replace(/^[-*]\s+/u, "")
      .replace(/[.!]$/u, "");
    const direct = /^(no )?([\p{L}\p{N}]+) experience$/iu.exec(value);
    if (direct?.[2]) return [{ name: direct[2], negative: direct[1] !== undefined }];
    const list = /^(no )?experience:\s*(.+)$/iu.exec(value);
    if (!list?.[2]) return [];
    // Require the entire list to be names; qualifications must not become evidence.
    const names = list[2].split(/\s*,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+/iu);
    if (names.some((name) => !/^[\p{L}\p{N}]+$/u.test(name))) return [];
    return names.map((name) => ({ name, negative: list[1] !== undefined }));
  });
}

/** Make explicit source statements available to the model's protected-value guide. */
export function sourceExperienceValues(text: string): readonly string[] {
  const namePattern = new RegExp(`^${technology}$`, "u");
  return statements(text)
    .filter(({ name }) => namePattern.test(name))
    .map(canonical);
}

/** Undefined means this is outside the bounded experience-statement contract. */
export function supportsExperienceClaim(evidence: string, value: string): boolean | undefined {
  const match = claimPattern.exec(value);
  if (!match?.[2]) return undefined;
  const name = match[2].normalize("NFKC").toLocaleLowerCase("en-US");
  const negative = match[1] !== undefined;
  const relevant = statements(evidence.normalize("NFKC")).filter(
    (statement) => statement.name.toLocaleLowerCase("en-US") === name,
  );
  return (
    relevant.some((statement) => statement.negative === negative) &&
    !relevant.some((statement) => statement.negative !== negative)
  );
}
