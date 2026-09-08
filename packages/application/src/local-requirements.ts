/** Syntactic source units only; semantic selection and priority belong to reviewed briefs. */
export function localJobRequirements(jobDescription: string): readonly {
  readonly id: string;
  readonly text: string;
  readonly priority: "medium";
}[] {
  const reviewHint = "Use a reviewed opportunity brief to select requirements and priorities.";
  if (Buffer.byteLength(jobDescription) > 65_536)
    throw new Error(`Local job document exceeds 64 KiB. ${reviewHint}`);
  const units: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    const text = pending.join(" ").trim();
    pending = [];
    if (!text) return;
    if (text.length > 2_000)
      throw new Error(`Local requirement unit exceeds 2,000 characters. ${reviewHint}`);
    units.push(text);
    if (units.length > 100)
      throw new Error(`Local job document exceeds 100 requirement units. ${reviewHint}`);
  };
  const lines = jobDescription.split(/\r?\n/u);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (/^(?:```|~~~)/u.test(line) || line.includes("|"))
      throw new Error(
        `Code fences and tables require explicit requirement selection. ${reviewHint}`,
      );
    if (/^(?:#{1,6})(?:\s|$)/u.test(line) || /^(?:-+|\*{3,}|_{3,}|=+)$/u.test(line) || !line) {
      flush();
      continue;
    }
    // Setext heading text and its underline are both structural, not requirements.
    if (/^\s*(?:=+|-+)\s*$/u.test(lines[index + 1] ?? "")) {
      flush();
      continue;
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/u.exec(line);
    if (item) {
      flush();
      pending.push(item[1] ?? "");
    } else {
      pending.push(line);
    }
  }
  flush();
  if (!units.length)
    throw new Error(`Local job document has no requirement content. ${reviewHint}`);
  return units.map((text, index) => ({ id: `requirement-${index + 1}`, text, priority: "medium" }));
}
