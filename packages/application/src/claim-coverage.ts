import type { AuthorArtifactProposal } from "@draft-loop/schemas";

function tokens(text: string): readonly string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+|[%+−]|-(?=\d)/gu) ?? []
  );
}

function presentation(text: string, title: string, kind: string): boolean {
  const value = tokens(text).join(" ");
  if (value === "" || value === tokens(title).join(" ") || value === tokens(kind).join(" "))
    return true;
  return /^(?:(?:education|certifications?|languages?|skills|experience|information|details|graduation date)\s+)?(?:information\s+)?(?:unavailable|not available|not provided|not listed|not specified|unknown|none provided|n a)$/u.test(
    value,
  );
}

/** Require contiguous claim spans, not bag-of-words overlap, for factual prose. */
export function claimCoverageIssues(proposal: AuthorArtifactProposal): readonly {
  readonly path: PropertyKey[];
  readonly code: "substantive_text_uncovered";
  readonly message: string;
}[] {
  const issues: {
    path: PropertyKey[];
    code: "substantive_text_uncovered";
    message: string;
  }[] = [];
  for (const [sectionIndex, section] of proposal.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      const claims = block.claims
        .filter((claim) => claim.substantive)
        .map((claim) => tokens(claim.text));
      const words = tokens(block.text);
      const covered = words.map(() => false);
      let lineStart = 0;
      for (const line of block.text.split(/[\n:;]/u)) {
        const length = tokens(line).length;
        if (presentation(line, section.title, section.kind))
          covered.fill(true, lineStart, lineStart + length);
        lineStart += length;
      }
      for (const claim of claims) {
        if (claim.length === 0) continue;
        for (let start = 0; start <= words.length - claim.length; start += 1) {
          if (claim.every((word, offset) => words[start + offset] === word)) {
            for (let offset = 0; offset < claim.length; offset += 1) covered[start + offset] = true;
          }
        }
      }
      const uncovered = words.some((word, index) => !covered[index] && word !== "and");
      if (uncovered)
        issues.push({
          path: ["sections", sectionIndex, "blocks", blockIndex, "text"],
          code: "substantive_text_uncovered",
          message: "substantive block text is not fully covered by substantive claims",
        });
    }
  }
  return issues;
}
