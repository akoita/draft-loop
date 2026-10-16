import type { DraftArtifact } from "@draft-loop/schemas";

/** Synthetic CV fixtures shared by the layout tests; the content is invented prose. */
export const fixtureGeneratedAt = "2026-10-16T10:00:00.000Z";

const vocabulary = (
  "led a team of six engineers to design and deliver the new billing platform for over two " +
  "million customers, cutting response latency by a third while keeping the service available " +
  "through every release. Partnered with product, finance and security stakeholders to plan " +
  "the migration, coached junior colleagues, and wrote the operational runbooks that the " +
  "on-call rotation still uses to resolve production incidents faster across regional offices"
).split(" ");

/** Deterministic synthetic prose of exactly `count` words, starting at a varying offset. */
export function words(count: number, seed: number): string {
  return Array.from(
    { length: count },
    (_, index) => vocabulary[(seed * 7 + index * 5) % vocabulary.length] ?? "led",
  ).join(" ");
}

export function sectionOf(
  id: string,
  kind: DraftArtifact["sections"][number]["kind"],
  order: number,
  blocks: readonly { type: "paragraph" | "bullet"; text: string }[],
): DraftArtifact["sections"][number] {
  return {
    id,
    title: id.replace(/^./u, (first) => first.toUpperCase()),
    kind,
    order,
    blocks: blocks.map((block, index) => ({
      id: `${id}-${index}`,
      type: block.type,
      text: block.text,
      claimIds: [],
    })),
  };
}

/** A realistic CV structure; `scale` multiplies the length of every bullet and summary. */
export function syntheticCv(scale: number, roles = 6): DraftArtifact {
  const bullets = (count: number, seed: number, base: number, spread: number) =>
    Array.from({ length: count }, (_, index) => ({
      type: "bullet" as const,
      text: words(Math.round((base + ((index * 3 + seed) % spread)) * scale), seed + index),
    }));
  const experience = Array.from({ length: roles }, (_, role) => [
    {
      type: "paragraph" as const,
      text: `Role ${role + 1}, Example Company ${role + 1}, 2015 to 2020`,
    },
    ...bullets(5 + (role % 2), role, 30, 6),
  ]).flat();
  return {
    schemaVersion: 1,
    id: `artifact-density-${scale}`,
    version: 1,
    parentVersionId: null,
    createdAt: fixtureGeneratedAt,
    language: "en",
    sections: [
      sectionOf("header", "header", 0, [
        { type: "paragraph", text: "Alex Example, Senior Platform Engineer" },
        { type: "paragraph", text: "Sample City | alex@example.test | +00 0000 0000" },
        { type: "paragraph", text: "example.test/alex | example.test/code" },
      ]),
      sectionOf("summary", "summary", 1, [
        { type: "paragraph", text: words(Math.round(130 * scale), 3) },
      ]),
      sectionOf("core areas", "skills", 2, bullets(5, 2, 26, 8)),
      sectionOf("experience", "experience", 3, experience),
      sectionOf("projects", "projects", 4, bullets(5, 4, 28, 6)),
      sectionOf("education", "education", 5, [
        { type: "paragraph", text: "Master of Engineering, Example University, 2012" },
      ]),
      sectionOf("certifications", "certifications", 6, [
        { type: "bullet", text: "Example Cloud Practitioner, 2021" },
        { type: "bullet", text: "Example Security Associate, 2022" },
      ]),
      sectionOf("skills", "skills", 7, [{ type: "paragraph", text: words(80, 5) }]),
    ],
    claims: [],
    decisions: [],
  };
}

export function wordCount(artifact: DraftArtifact): number {
  return artifact.sections
    .flatMap((section) => section.blocks)
    .reduce((total, block) => total + block.text.split(/\s+/u).length, 0);
}
