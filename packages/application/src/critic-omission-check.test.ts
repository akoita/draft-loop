import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { ApplicationPlan } from "@draft-loop/schemas/application-plan";
import { describe, expect, it } from "vitest";
import { promptTemplateVersion } from "./author-adjudication.js";
import {
  createCriticAdjudicationPrompt,
  criticReadsCompactEvidenceTable,
} from "./critic-adjudication.js";
import { capBlockingOmissions, omittedAccomplishmentCode } from "./critic-omission.js";
import {
  criticRunsOmissionCheck,
  maximumOmissionCheckFindings,
  omissionCheckCvText,
  omissionCheckFindings,
  omissionCheckInput,
  omissionCheckOutputSchema,
  omissionCheckSystemPrompt,
  parseOmissionCheck,
} from "./critic-omission-check.js";

const chunk = (id: string, text: string): ScoredEvidenceChunk => ({
  id,
  workspaceId: "workspace",
  sourceId: "source",
  ordinal: 0,
  lineStart: 1,
  lineEnd: 2,
  checksum: "b".repeat(64),
  text,
  rank: 0,
});

const evidence = [
  chunk("chunk-a", "Led the migration of 40 services to Kubernetes in 2023."),
  chunk("chunk-b", "Cut the release cycle from two weeks to one day."),
  chunk("chunk-c", "Mentored four junior engineers."),
  chunk("chunk-empty", "   "),
];

const artifact = {
  sections: [
    {
      id: "skills",
      title: "Skills",
      kind: "skills",
      order: 2,
      blocks: [{ id: "b3", type: "paragraph", text: "Kubernetes, CI/CD", claimIds: [] }],
    },
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      order: 1,
      blocks: [
        { id: "b1", type: "paragraph", text: "Platform engineer, 2022 to 2024", claimIds: [] },
        { id: "b2", type: "bullet", text: "Ran the platform team.", claimIds: [] },
      ],
    },
  ],
} as unknown as DraftArtifact;

const plan: ApplicationPlan = {
  themes: [
    {
      title: "Platform migration",
      rationale: "The job centres on it.",
      requirementIds: ["req-1"],
      evidenceChunkIds: ["chunk-a", "chunk-b"],
      gap: false,
    },
    {
      title: "Security clearance",
      rationale: "Required.",
      requirementIds: ["req-2"],
      evidenceChunkIds: [],
      gap: true,
    },
    {
      title: "Delivery speed",
      rationale: "Stressed twice.",
      requirementIds: ["req-3", "req-4"],
      evidenceChunkIds: ["chunk-b", "chunk-missing"],
      gap: false,
    },
  ],
  leads: { summaryAngle: "Platform lead", coreAreas: [{ text: "Migration", themeRank: 1 }] },
  cuts: [{ action: "compress", target: "Certification list", reason: "The job ignores it." }],
};

const noAchievements = { achievements: [] };

describe("omission check input", () => {
  it("renders the CV in section order with headings and bullets", () => {
    expect(omissionCheckCvText(artifact)).toBe(
      "## Experience\nPlatform engineer, 2022 to 2024\n- Ran the platform team.\n\n## Skills\nKubernetes, CI/CD",
    );
  });

  it("sends the plan's supported themes, their cited chunks and the cuts, nothing else", () => {
    const input = omissionCheckInput(artifact, evidence, plan, [], noAchievements);
    expect(input).toEqual({
      cv: omissionCheckCvText(artifact),
      themes: [
        { id: "theme-1", title: "Platform migration", requirementIds: ["req-1"] },
        { id: "theme-3", title: "Delivery speed", requirementIds: ["req-3", "req-4"] },
      ],
      cuts: [{ action: "compress", target: "Certification list" }],
      chunks: [
        { id: "chunk-a", themeIds: ["theme-1"], text: evidence[0]?.text },
        { id: "chunk-b", themeIds: ["theme-1", "theme-3"], text: evidence[1]?.text },
      ],
    });
    expect(JSON.stringify(input)).not.toContain("chunk-c");
    expect(JSON.stringify(input)).not.toContain("rationale");
  });

  it("falls back to the achievement plan's chunks for critical and high requirements", () => {
    const requirements = [
      { id: "req-1", text: "Kubernetes migration", priority: "critical" },
      { id: "req-2", text: "Mentoring", priority: "low" },
      { id: "req-3", text: "Fast releases", priority: "high" },
    ];
    const input = omissionCheckInput(artifact, evidence, undefined, requirements, {
      achievements: [
        { evidenceChunkId: "chunk-a", sourceId: "source", requirementIds: ["req-1"] },
        { evidenceChunkId: "chunk-c", sourceId: "source", requirementIds: ["req-2"] },
        { evidenceChunkId: "chunk-b", sourceId: "source", requirementIds: ["req-3", "req-2"] },
      ],
    });
    expect(input?.themes).toEqual([
      { id: "req-1", title: "Kubernetes migration", requirementIds: ["req-1"] },
      { id: "req-3", title: "Fast releases", requirementIds: ["req-3"] },
    ]);
    expect(input?.chunks.map(({ id, themeIds }) => [id, themeIds])).toEqual([
      ["chunk-a", ["req-1"]],
      ["chunk-b", ["req-3"]],
    ]);
    expect(input?.cuts).toEqual([]);
  });

  it("is undefined when no candidate chunk was retrieved", () => {
    expect(omissionCheckInput(artifact, [], plan, [], noAchievements)).toBeUndefined();
    expect(omissionCheckInput(artifact, evidence, undefined, [], noAchievements)).toBeUndefined();
  });
});

describe("omission check output", () => {
  const input = omissionCheckInput(artifact, evidence, plan, [], noAchievements)!;
  const entry = (overrides: Record<string, unknown> = {}) => ({
    chunkId: "chunk-a",
    themeId: "theme-1",
    accomplishment: "Led the migration of 40 services to Kubernetes",
    role: "Platform engineer",
    status: "left-out",
    move: "State it under the platform role; shorten the team paragraph.",
    ...overrides,
  });

  it("keeps well-formed entries that name a sent chunk and drops the rest", () => {
    const parsed = parseOmissionCheck(
      {
        omissions: [
          entry(),
          entry({ chunkId: "chunk-c" }),
          entry({ status: "unknown" }),
          entry({ accomplishment: "  " }),
          "not an entry",
          entry({ chunkId: "chunk-b", themeId: "theme-9", status: "bare-mention" }),
        ],
      },
      input,
    );
    expect(parsed).toEqual([
      entry(),
      { ...entry({ chunkId: "chunk-b", status: "bare-mention" }), themeId: "theme-1" },
    ]);
  });

  it("bounds the count and the text lengths", () => {
    const long = "x".repeat(500);
    const parsed = parseOmissionCheck(
      {
        omissions: Array.from({ length: maximumOmissionCheckFindings + 2 }, () =>
          entry({ accomplishment: long, move: long, role: long }),
        ),
      },
      input,
    );
    expect(parsed).toHaveLength(maximumOmissionCheckFindings);
    expect(parsed[0]?.accomplishment).toHaveLength(120);
    expect(parsed[0]?.move).toHaveLength(200);
    expect(parsed[0]?.role).toHaveLength(80);
    expect(parseOmissionCheck({ omissions: "none" }, input)).toEqual([]);
  });

  it("turns omissions into blocking coverage findings the existing cap limits", () => {
    const omissions = parseOmissionCheck(
      { omissions: [entry(), entry({ status: "bare-mention" }), entry(), entry()] },
      input,
    );
    const findings = omissionCheckFindings(omissions, input.themes);
    expect(
      findings.map(({ id, code, category, severity }) => [id, code, category, severity]),
    ).toEqual(
      Array.from({ length: 4 }, (_, index) => [
        `omission-${index + 1}`,
        omittedAccomplishmentCode,
        "coverage",
        "error",
      ]),
    );
    expect(findings[0]?.message).toBe(
      'The CV left out "Led the migration of 40 services to Kubernetes" (chunk-a, Platform engineer; serves theme-1 Platform migration). Move: State it under the platform role; shorten the team paragraph.',
    );
    expect(findings[1]?.message).toContain("The CV mentioned only");
    expect(capBlockingOmissions(findings).map(({ severity }) => severity)).toEqual([
      "error",
      "error",
      "error",
      "warning",
    ]);
  });

  it("asks for a closed output of at most the finding cap", () => {
    expect(omissionCheckOutputSchema).toMatchObject({
      additionalProperties: false,
      properties: { omissions: { maxItems: maximumOmissionCheckFindings } },
    });
    expect(omissionCheckSystemPrompt).toContain(`at most ${maximumOmissionCheckFindings}`);
    expect(omissionCheckSystemPrompt).not.toContain("retrievedEvidence");
  });
});

describe("critic prompt v9", () => {
  it("is the default, keeps v6's critique prompt and reads the compact table", () => {
    expect(promptTemplateVersion("critic")).toBe("cli-critic-v9");
    expect(createCriticAdjudicationPrompt("cli-critic-v9")).toBe(
      createCriticAdjudicationPrompt("cli-critic-v6"),
    );
    expect(createCriticAdjudicationPrompt("cli-critic-v9")).not.toContain("omission");
    expect(criticReadsCompactEvidenceTable("cli-critic-v9")).toBe(true);
  });

  it("is the only version that runs the separate check", () => {
    expect(criticRunsOmissionCheck("cli-critic-v9")).toBe(true);
    for (const earlier of [6, 7, 8]) {
      expect(criticRunsOmissionCheck(`cli-critic-v${earlier}`)).toBe(false);
    }
  });
});
