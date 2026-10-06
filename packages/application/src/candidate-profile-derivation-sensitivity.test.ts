import { createHash } from "node:crypto";
import { createCandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import type {
  SourceSensitivityRule,
  SourceSensitivityTier,
} from "@draft-loop/domain/source-sensitivity";
import { type JsonObject, type ModelRequest, ProviderAdapterError } from "@draft-loop/providers";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { describe, expect, it, vi } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import type { CanonicalCandidateProfileExtractionRequest } from "./candidate-profile-extraction.js";
import { executeCanonicalProfileExtractionWithFallback } from "./canonical-profile-extraction-fallback.js";
import { excludedSensitivityTiersForConsent } from "./sensitive-knowledge-consent.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const checksum = "a".repeat(64);
const neverShareMarker = "SYNTHETIC-NEVER-SHARE-MARKER";
const sensitiveMarker = "SYNTHETIC-SENSITIVE-MARKER";
const allowedQuote = "Allowed synthetic skill line.";

const rules: readonly SourceSensitivityRule[] = [
  { id: "r-never", tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
  { id: "r-sensitive", tier: "sensitive", match: { kind: "heading-contains", text: "contact" } },
];
const rulesRecord = { version: 3, checksum: "b".repeat(64), createdAt, rules };

const smallMarkdown = [
  "# Profile",
  allowedQuote,
  "",
  "## Compensation",
  `${neverShareMarker} salary detail.`,
  "",
  "## Contact",
  `${sensitiveMarker} phone detail.`,
  "",
].join("\n");

const model: ModelRequest<JsonObject>["model"] = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "sensitivity-test-v1",
};
const controls = {
  model,
  systemPrompt: "Original extraction prompt.",
  maxOutputTokens: 8192,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
  } as const,
};

interface SourceFixture {
  readonly sourceId: string;
  readonly content: string;
  readonly mediaType?: string;
}

type ProviderRequest = ModelRequest<JsonObject>;
type Respond = (request: ProviderRequest, index: number) => JsonObject;

function fact(sourceId: string, quote: string, key = "fact-1", value = quote) {
  return {
    key,
    category: "skill",
    field: "skill-field",
    value,
    evidence: [{ sourceId, quote }],
  };
}

function proposal(...facts: readonly ReturnType<typeof fact>[]): JsonObject {
  return { schemaVersion: 1, facts, issues: [] } as unknown as JsonObject;
}

function requestSources(request: ProviderRequest) {
  return request.input.sources as readonly { readonly id: string; readonly text: string }[];
}

function truncation(): ProviderAdapterError {
  return new ProviderAdapterError("anthropic", "invalid-response", "private stop detail", {
    retryable: false,
    diagnostics: [{ code: "max_tokens", path: "stop_reason" }],
  });
}

async function derive(
  sources: readonly SourceFixture[],
  options: {
    readonly rules?: typeof rulesRecord | undefined;
    readonly respond: Respond;
    readonly throwWhen?: (request: ProviderRequest, index: number) => boolean;
    readonly excludedSensitivityTiers?: ReadonlySet<SourceSensitivityTier>;
  },
) {
  const versions = sources.map(({ sourceId }) => ({ sourceId, versionId: `version-${sourceId}` }));
  const selected = createCandidateKnowledgeSelectionSnapshot({
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: versions.map(({ sourceId, versionId }) => ({
          sourceId,
          versionId,
          lifecycleRevision: {
            knowledgeBaseState: "active" as const,
            knowledgeBaseArchivedAt: null,
            versionId,
            version: 1,
            createdAt,
            managed: true,
            originBoundAt: createdAt,
            observation: null,
            retirement: null,
            provenanceFetchedAt: null,
            directory: null,
          },
        })),
      },
    ],
  });
  const handle = {
    descriptor: { schemaVersion: 1, id: "store-1", createdAt },
    getCandidateKnowledgeSourceSensitivityRules: vi.fn(async () => options.rules),
    readManagedCandidateKnowledgeSourceVersion: vi.fn(
      async (_knowledgeBaseId: string, sourceId: string, versionId: string) => {
        const source = sources.find((candidate) => candidate.sourceId === sourceId);
        if (source === undefined) return undefined;
        const bytes = new TextEncoder().encode(source.content);
        return {
          metadata: {
            knowledgeBaseId: "knowledge-1",
            kind: "file",
            id: versionId,
            sourceId,
            version: 1,
            parentVersionId: null,
            mediaType: source.mediaType ?? "text/markdown",
            checksum: createHash("sha256").update(bytes).digest("hex"),
            sizeBytes: bytes.byteLength,
            createdAt,
          },
          bytes,
        };
      },
    ),
    close: vi.fn(async () => undefined),
  } as unknown as CandidateKnowledgeStoreHandle;

  const providerRequests: ProviderRequest[] = [];
  const extractionRequests: CanonicalCandidateProfileExtractionRequest[] = [];
  const executor = {
    execute: async (request: ProviderRequest) => {
      const index = providerRequests.length;
      providerRequests.push(request);
      if (options.throwWhen?.(request, index) === true) throw truncation();
      return { output: options.respond(request, index) };
    },
  } as unknown as Parameters<typeof executeCanonicalProfileExtractionWithFallback>[0];
  const saveCanonicalCandidateProfile = vi.fn(async (workspaceId, profile) => ({
    workspaceId,
    profile,
    checksum,
  }));
  const service = createCanonicalCandidateProfileDerivationService({
    persistence: {
      getLatestCanonicalCandidateProfile: vi.fn(async () => undefined),
      saveCanonicalCandidateProfile,
    },
    extractor: {
      extract: (request) => {
        extractionRequests.push(request);
        return executeCanonicalProfileExtractionWithFallback(executor, request, controls);
      },
    },
    knowledgeService: { createKnowledgeSelectionSnapshot: vi.fn(async () => selected) },
    openKnowledgeStore: async () => handle,
    now: () => createdAt,
  });
  const result = await service.deriveCanonicalCandidateProfile({
    workspaceId: "workspace-1",
    profileId: "profile-1",
    selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
    allowProviderData: true,
    ...(options.excludedSensitivityTiers === undefined
      ? {}
      : { excludedSensitivityTiers: options.excludedSensitivityTiers }),
  });
  return { result, providerRequests, extractionRequests, handle, saveCanonicalCandidateProfile };
}

function serialized(requests: readonly unknown[]): string {
  return JSON.stringify(requests);
}

function expectNoExcludedText(requests: readonly unknown[]): void {
  const text = serialized(requests);
  expect(text).not.toContain(neverShareMarker);
  expect(text).not.toContain(sensitiveMarker);
  expect(text).not.toContain("Compensation");
}

describe("profile derivation sensitivity filtering", () => {
  it("sends only allowed text in an unplanned request and keeps facts from allowed text", async () => {
    const { result, providerRequests } = await derive(
      [{ sourceId: "source-1", content: smallMarkdown }],
      {
        rules: rulesRecord,
        respond: (request) => proposal(fact(requestSources(request)[0]?.id ?? "", allowedQuote)),
      },
    );
    expect(providerRequests).toHaveLength(1);
    expectNoExcludedText(providerRequests);
    expect(serialized(providerRequests)).toContain(allowedQuote);
    expect(result.profile.facts).toHaveLength(1);
    expect(result.profile.facts[0]?.value).toBe(allowedQuote);
    expect(result.sensitivityRulesApplied).toEqual([
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        rulesVersion: 3,
        rulesChecksum: "b".repeat(64),
      },
    ]);
    expect(result.profile.issues.some((issue) => issue.message.includes("dropped"))).toBe(false);
  });

  it("keeps excluded text out of every planned window and its grounding recovery", async () => {
    const filler = Array.from(
      { length: 1_400 },
      (_, index) => `Synthetic allowed filler line number ${index} for window planning.`,
    ).join("\n");
    const content = [
      "# Profile",
      filler,
      "",
      "## Compensation",
      `${neverShareMarker} ${"x".repeat(9_000)}`,
      "",
      "## Contact",
      `${sensitiveMarker} ${"y".repeat(9_000)}`,
      "",
      "## Skills",
      allowedQuote,
      "",
    ].join("\n");
    expect(content.length).toBeGreaterThan(65_536);
    let ungroundedOnce = false;
    const { result, providerRequests } = await derive([{ sourceId: "source-1", content }], {
      rules: rulesRecord,
      respond: (request) => {
        const sourceId = requestSources(request)[0]?.id ?? "";
        const carriesAllowed = serialized([request.input]).includes(allowedQuote);
        if (!carriesAllowed) return proposal();
        if (!ungroundedOnce) {
          ungroundedOnce = true;
          return proposal(fact(sourceId, "A quote that is not in the supplied text."));
        }
        return proposal(fact(sourceId, allowedQuote));
      },
    });
    expect(providerRequests.length).toBeGreaterThan(2);
    expect(providerRequests.some((request) => request.input.groundingRecovery !== undefined)).toBe(
      true,
    );
    expectNoExcludedText(providerRequests);
    expect(result.profile.facts.map((item) => item.value)).toEqual([allowedQuote]);
  });

  it("keeps excluded text out of focused and windowed fallback requests", async () => {
    const { providerRequests, extractionRequests } = await derive(
      [
        { sourceId: "source-1", content: smallMarkdown },
        { sourceId: "source-2", content: `# Notes\nSecond allowed line.\n\n${smallMarkdown}` },
      ],
      {
        rules: rulesRecord,
        throwWhen: (request) => request.input.extractionFocusWindow === undefined,
        respond: () => proposal(),
      },
    );
    expect(providerRequests.some((request) => request.input.extractionFocusSourceId)).toBe(true);
    expect(providerRequests.some((request) => request.input.extractionFocusWindow)).toBe(true);
    expectNoExcludedText(providerRequests);
    expectNoExcludedText(extractionRequests);
  });

  it("keeps excluded text out of the unplanned grounding recovery request", async () => {
    const { result, providerRequests } = await derive(
      [{ sourceId: "source-1", content: smallMarkdown }],
      {
        rules: rulesRecord,
        respond: (request, index) => {
          const sourceId = requestSources(request)[0]?.id ?? "";
          return index === 0
            ? proposal(fact(sourceId, `${neverShareMarker} salary detail.`))
            : proposal(fact(sourceId, allowedQuote));
        },
      },
    );
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests[1]?.input.groundingRecovery).toBeDefined();
    expectNoExcludedText(providerRequests);
    expect(result.profile.facts.map((item) => item.value)).toEqual([allowedQuote]);
  });

  it("drops and counts a fact whose quote exists only in an excluded section", async () => {
    const { result, providerRequests } = await derive(
      [{ sourceId: "source-1", content: smallMarkdown }],
      {
        rules: rulesRecord,
        respond: (request) => {
          const sourceId = requestSources(request)[0]?.id ?? "";
          return proposal(
            fact(sourceId, allowedQuote, "fact-1"),
            fact(sourceId, `${neverShareMarker} salary detail.`, "fact-2"),
          );
        },
      },
    );
    expect(providerRequests).toHaveLength(2);
    expect(result.profile.facts.map((item) => item.value)).toEqual([allowedQuote]);
    const warning = result.profile.issues.find((issue) => issue.message.includes("dropped"));
    expect(warning?.message).toContain("1 extracted fact was dropped");
    expect(JSON.stringify(result.profile)).not.toContain(neverShareMarker);
  });

  it("drops a fact whose quote only exists across the artificial join", async () => {
    const content = [
      "# Profile",
      "Allowed first line.",
      "",
      "## Compensation",
      `${neverShareMarker} salary detail.`,
      "",
      "## Skills",
      "Allowed second line.",
      "",
    ].join("\n");
    const spanning = "Allowed first line. ## Skills Allowed second line.";
    const { result, providerRequests } = await derive([{ sourceId: "source-1", content }], {
      rules: rulesRecord,
      respond: (request) => {
        const source = requestSources(request)[0];
        expect(source?.text).toContain("Allowed first line.");
        expect(source?.text).toContain("Allowed second line.");
        return proposal(
          fact(source?.id ?? "", "Allowed first line.", "fact-1"),
          fact(source?.id ?? "", spanning, "fact-2"),
        );
      },
    });
    expectNoExcludedText(providerRequests);
    expect(result.profile.facts.map((item) => item.value)).toEqual(["Allowed first line."]);
    expect(result.profile.issues.some((issue) => issue.message.includes("dropped"))).toBe(true);
  });

  it("keeps a fact when its quote also occurs in allowed text outside the excluded ranges", async () => {
    const content = `# Compensation\nShared phrase.\n\n# Skills\nShared phrase.\n`;
    const { result } = await derive([{ sourceId: "source-1", content }], {
      rules: rulesRecord,
      respond: (request) => proposal(fact(requestSources(request)[0]?.id ?? "", "Shared phrase.")),
    });
    expect(result.profile.facts.map((item) => item.value)).toEqual(["Shared phrase."]);
  });

  it("leaves a fully excluded source out of extraction and records a content-free issue", async () => {
    const excluded = `# Compensation\n${neverShareMarker} salary detail.\n`;
    const both = await derive(
      [
        { sourceId: "source-1", content: excluded },
        { sourceId: "source-2", content: "# Skills\nAllowed synthetic skill line.\n" },
      ],
      {
        rules: rulesRecord,
        respond: (request) => proposal(fact(requestSources(request)[0]?.id ?? "", allowedQuote)),
      },
    );
    expect(both.providerRequests).toHaveLength(1);
    expect(requestSources(both.providerRequests[0] as ProviderRequest)).toHaveLength(1);
    expectNoExcludedText(both.providerRequests);
    const issue = both.result.profile.issues.find((item) =>
      item.message.includes("excluded by its knowledge base's sensitivity rules"),
    );
    expect(issue?.sourceRefs).toEqual([
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sourceId: "source-1",
        versionId: "version-source-1",
        kind: "candidate-provided",
      },
    ]);
    expect(JSON.stringify(both.result.profile)).not.toContain(neverShareMarker);

    const only = await derive([{ sourceId: "source-1", content: excluded }], {
      rules: rulesRecord,
      respond: () => proposal(),
    });
    expect(only.providerRequests).toHaveLength(0);
    expect(only.extractionRequests).toHaveLength(0);
    expect(only.result.profile.facts).toEqual([]);
    expect(
      only.result.profile.issues.some((item) => item.message.includes("sensitivity rules")),
    ).toBe(true);
  });

  it("is identical to unfiltered derivation when a knowledge base has no rules", async () => {
    const respond: Respond = (request) =>
      proposal(fact(requestSources(request)[0]?.id ?? "", allowedQuote));
    const noRules = await derive([{ sourceId: "source-1", content: smallMarkdown }], {
      rules: undefined,
      respond,
    });
    const nonMatching = await derive([{ sourceId: "source-1", content: smallMarkdown }], {
      rules: { ...rulesRecord, rules: [] },
      respond,
    });
    expect(serialized(noRules.providerRequests)).toContain(neverShareMarker);
    expect(serialized(noRules.providerRequests)).toBe(serialized(nonMatching.providerRequests));
    expect(noRules.result.profile).toEqual(nonMatching.result.profile);
    expect("sensitivityRulesApplied" in noRules.result).toBe(false);
    expect(noRules.extractionRequests[0]?.sources).toEqual(
      nonMatching.extractionRequests[0]?.sources,
    );
  });

  it("does not filter a source that is not Markdown", async () => {
    const { providerRequests } = await derive(
      [{ sourceId: "source-1", content: smallMarkdown, mediaType: "text/plain" }],
      { rules: rulesRecord, respond: () => proposal() },
    );
    expect(serialized(providerRequests)).toContain(neverShareMarker);
    expect(serialized(providerRequests)).toContain(sensitiveMarker);
  });

  describe("with workspace consent for sensitive sections", () => {
    const sensitiveQuote = `${sensitiveMarker} phone detail.`;
    const respond: Respond = (request) =>
      proposal(
        fact(requestSources(request)[0]?.id ?? "", allowedQuote, "fact-1"),
        fact(requestSources(request)[0]?.id ?? "", sensitiveQuote, "fact-2"),
      );

    it("withholds sensitive and never-share text when consent is off", async () => {
      const { result, providerRequests } = await derive(
        [{ sourceId: "source-1", content: smallMarkdown }],
        {
          rules: rulesRecord,
          respond,
          excludedSensitivityTiers: excludedSensitivityTiersForConsent(false),
        },
      );
      expectNoExcludedText(providerRequests);
      expect(result.profile.facts.map((item) => item.value)).toEqual([allowedQuote]);
    });

    it("sends sensitive text but still never sends never-share text when consent is on", async () => {
      const { result, providerRequests } = await derive(
        [{ sourceId: "source-1", content: smallMarkdown }],
        {
          rules: rulesRecord,
          respond,
          excludedSensitivityTiers: excludedSensitivityTiersForConsent(true),
        },
      );
      const text = serialized(providerRequests);
      expect(text).toContain(sensitiveMarker);
      expect(text).toContain(allowedQuote);
      expect(text).not.toContain(neverShareMarker);
      expect(text).not.toContain("Compensation");
      expect(result.profile.facts.map((item) => item.value).sort()).toEqual(
        [sensitiveQuote, allowedQuote].sort(),
      );
    });

    it("defaults to the consent-off policy when no tiers are passed", async () => {
      const { providerRequests } = await derive(
        [{ sourceId: "source-1", content: smallMarkdown }],
        { rules: rulesRecord, respond },
      );
      expectNoExcludedText(providerRequests);
    });
  });
});
