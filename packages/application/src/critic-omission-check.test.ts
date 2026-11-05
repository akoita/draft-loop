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
  blockingOmissionCheckFindings,
  criticRunsOmissionCheck,
  maximumOmissionCheckFindings,
  maximumOmissionCheckRoundFindings,
  maximumOmissionCheckSliceChunks,
  mergeOmissionChecks,
  type OmissionCheckInput,
  omissionCheckCvText,
  omissionCheckFindings,
  omissionCheckInput,
  omissionCheckInputs,
  omissionCheckOutputSchema,
  omissionCheckScope,
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

/** The one slice a small evidence set makes. */
function onlySlice(slices: readonly OmissionCheckInput[]): OmissionCheckInput {
  const [first] = slices;
  if (first === undefined) throw new Error("expected one slice");
  return first;
}

describe("omission check over every chunk (critic v10, #2046)", () => {
  const widerPlan: ApplicationPlan = {
    ...plan,
    themes: [
      ...plan.themes,
      {
        title: "Mentoring",
        rationale: "Asked for.",
        requirementIds: ["req-5"],
        evidenceChunkIds: ["chunk-missing"],
        gap: false,
      },
    ],
  };

  it("sends every retrieved chunk with every supported theme, uncited chunks without a theme", () => {
    const [only, ...rest] = omissionCheckInputs(
      artifact,
      evidence,
      widerPlan,
      [],
      noAchievements,
      "every-chunk",
    );
    expect(rest).toEqual([]);
    expect(only).toEqual({
      cv: omissionCheckCvText(artifact),
      themes: [
        { id: "theme-1", title: "Platform migration", requirementIds: ["req-1"] },
        { id: "theme-3", title: "Delivery speed", requirementIds: ["req-3", "req-4"] },
        { id: "theme-4", title: "Mentoring", requirementIds: ["req-5"] },
      ],
      cuts: [{ action: "compress", target: "Certification list" }],
      chunks: [
        { id: "chunk-a", themeIds: ["theme-1"], text: evidence[0]?.text },
        { id: "chunk-b", themeIds: ["theme-1", "theme-3"], text: evidence[1]?.text },
        { id: "chunk-c", themeIds: [], text: evidence[2]?.text },
      ],
    });
    // The v9 scope keeps the cited chunks and the themes they serve, as before.
    expect(
      omissionCheckInput(artifact, evidence, widerPlan, [], noAchievements)?.themes.map(
        ({ id }) => id,
      ),
    ).toEqual(["theme-1", "theme-3"]);
  });

  it("slices the evidence by the slice size, each slice with the same CV, themes and cuts", () => {
    const many = Array.from({ length: maximumOmissionCheckSliceChunks * 2 + 3 }, (_, index) =>
      chunk(`chunk-${index}`, `Accomplishment ${index}.`),
    );
    const slices = omissionCheckInputs(artifact, many, plan, [], noAchievements, "every-chunk");
    expect(slices.map(({ chunks }) => chunks.length)).toEqual([
      maximumOmissionCheckSliceChunks,
      maximumOmissionCheckSliceChunks,
      3,
    ]);
    expect(slices.flatMap(({ chunks }) => chunks.map(({ id }) => id))).toEqual(
      many.map(({ id }) => id),
    );
    for (const slice of slices) {
      expect(slice.cv).toBe(slices[0]?.cv);
      expect(slice.themes).toEqual(slices[0]?.themes);
      expect(slice.cuts).toEqual(slices[0]?.cuts);
    }
  });

  it("is empty without a theme to serve or a chunk to read", () => {
    expect(
      omissionCheckInputs(artifact, evidence, undefined, [], noAchievements, "every-chunk"),
    ).toEqual([]);
    expect(omissionCheckInputs(artifact, [], plan, [], noAchievements, "every-chunk")).toEqual([]);
    // Without a plan, every chunk is read once a critical or high requirement stands as a theme.
    const [withRequirement] = omissionCheckInputs(
      artifact,
      evidence,
      undefined,
      [{ id: "req-1", text: "Kubernetes migration", priority: "high" }],
      {
        achievements: [
          { evidenceChunkId: "chunk-a", sourceId: "source", requirementIds: ["req-1"] },
        ],
      },
      "every-chunk",
    );
    expect(withRequirement?.chunks.map(({ id, themeIds }) => [id, themeIds])).toEqual([
      ["chunk-a", ["req-1"]],
      ["chunk-b", []],
      ["chunk-c", []],
    ]);
  });

  it("keeps an uncited chunk's omission only when it names a theme the call was sent", () => {
    const input = onlySlice(
      omissionCheckInputs(artifact, evidence, plan, [], noAchievements, "every-chunk"),
    );
    const entry = (themeId: string) => ({
      chunkId: "chunk-c",
      themeId,
      accomplishment: "Mentored four junior engineers",
      role: "Platform engineer",
      status: "bare-mention",
      move: "Add it to the role.",
    });
    expect(parseOmissionCheck({ omissions: [entry("theme-3"), entry("theme-9")] }, input)).toEqual([
      entry("theme-3"),
    ]);
  });

  it("merges the slices' answers once per chunk and accomplishment, up to the round cap", () => {
    const omission = (chunkId: string, accomplishment: string) => ({
      chunkId,
      themeId: "theme-1",
      accomplishment,
      role: "Engineer",
      status: "left-out" as const,
      move: "Add it.",
    });
    expect(
      mergeOmissionChecks([
        [
          omission("chunk-a", "Led the migration of 40 services"),
          omission("chunk-b", "Cut the cycle"),
        ],
        [
          omission("chunk-a", "led the migration of 40 services."),
          omission("chunk-b", "Cut the cycle!"),
        ],
        [omission("chunk-c", "Cut the cycle")],
      ]),
    ).toEqual([
      omission("chunk-a", "Led the migration of 40 services"),
      omission("chunk-b", "Cut the cycle"),
      omission("chunk-c", "Cut the cycle"),
    ]);
    const flood = Array.from({ length: maximumOmissionCheckRoundFindings + 4 }, (_, index) =>
      omission(`chunk-${index}`, `Accomplishment ${index}`),
    );
    expect(mergeOmissionChecks([flood.slice(0, 8), flood.slice(8)])).toHaveLength(
      maximumOmissionCheckRoundFindings,
    );
  });

  it("lets every merged answer block on v10 and keeps v9's cap of three", () => {
    const input = onlySlice(
      omissionCheckInputs(artifact, evidence, plan, [], noAchievements, "every-chunk"),
    );
    const findings = omissionCheckFindings(
      Array.from({ length: 5 }, (_, index) => ({
        chunkId: "chunk-a",
        themeId: "theme-1",
        accomplishment: `Accomplishment ${index}`,
        role: "Engineer",
        status: "left-out" as const,
        move: "Add it.",
      })),
      input.themes,
    );
    expect(blockingOmissionCheckFindings("cli-critic-v10")).toBe(maximumOmissionCheckRoundFindings);
    expect(blockingOmissionCheckFindings("cli-critic-v9")).toBeUndefined();
    expect(blockingOmissionCheckFindings("cli-critic-v8")).toBeUndefined();
    expect(
      capBlockingOmissions(findings, blockingOmissionCheckFindings("cli-critic-v10")).map(
        ({ severity }) => severity,
      ),
    ).toEqual(["error", "error", "error", "error", "error"]);
    expect(
      capBlockingOmissions(findings, blockingOmissionCheckFindings("cli-critic-v9")).map(
        ({ severity }) => severity,
      ),
    ).toEqual(["error", "error", "error", "warning", "warning"]);
  });

  it("tells the check that a chunk may cite no theme", () => {
    expect(omissionCheckSystemPrompt).toContain("a slice of the retrieved evidence");
    expect(omissionCheckSystemPrompt).toContain("is empty when it cites none");
  });
});

describe("critic prompts v9 and v10", () => {
  it("v9 and v10 keep v6's critique prompt and read the compact table", () => {
    for (const version of ["cli-critic-v9", "cli-critic-v10"]) {
      expect(createCriticAdjudicationPrompt(version)).toBe(
        createCriticAdjudicationPrompt("cli-critic-v6"),
      );
      expect(createCriticAdjudicationPrompt(version)).not.toContain("omission");
      expect(criticReadsCompactEvidenceTable(version)).toBe(true);
    }
  });

  it("are the only versions that run the separate check, v9 on the cited chunks, v10 on every chunk", () => {
    expect(criticRunsOmissionCheck("cli-critic-v9")).toBe(true);
    expect(criticRunsOmissionCheck("cli-critic-v10")).toBe(true);
    expect(omissionCheckScope("cli-critic-v9")).toBe("cited-chunks");
    expect(omissionCheckScope("cli-critic-v10")).toBe("every-chunk");
    for (const earlier of [6, 7, 8]) {
      expect(criticRunsOmissionCheck(`cli-critic-v${earlier}`)).toBe(false);
      expect(omissionCheckScope(`cli-critic-v${earlier}`)).toBeUndefined();
    }
  });
});
