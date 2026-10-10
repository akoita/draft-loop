import type { ModelSelection } from "@draft-loop/domain";
import type { CanonicalCandidateProfileProvenanceReference } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import type { CanonicalCandidateProfileExtractionRequest } from "./candidate-profile-extraction.js";
import { prepareCanonicalCandidateProfileExtractionSources } from "./candidate-profile-extraction-sources.js";
import {
  canonicalProfileEvidenceKindInstructions,
  effectiveCandidateEvidenceKind,
  evidenceKindChangedSince,
  recordedCanonicalProfileEvidenceKinds,
} from "./canonical-profile-evidence-kinds.js";
import { buildBoundedCallRequest } from "./canonical-profile-extraction-bounded-calls.js";
import { canonicalProfileRequest } from "./canonical-profile-provider-request.js";

const checksum = "a".repeat(64);
const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "synthetic",
};

function reference(sourceId: string): CanonicalCandidateProfileProvenanceReference {
  return {
    storeId: "store-1",
    knowledgeBaseId: "kb-1",
    sourceId,
    versionId: `${sourceId}-v1`,
    kind: "candidate-provided",
  };
}

function request(
  sources: CanonicalCandidateProfileExtractionRequest["sources"],
): CanonicalCandidateProfileExtractionRequest {
  return { operationId: "operation-1", sources };
}

const controls = {
  model,
  systemPrompt: "system",
  maxOutputTokens: 8192,
  dataPolicy: { allowProviderData: true },
} as unknown as Parameters<typeof buildBoundedCallRequest>[1];

describe("canonical profile evidence kinds", () => {
  it("sends the kind with a whole source and with a window of a longer source", () => {
    const source = {
      id: "source-1",
      mediaType: "text/markdown",
      checksum,
      text: "Reviewer: Exceeded expectations on delivery.",
      evidenceKind: "performance-review" as const,
    };
    const whole = buildBoundedCallRequest(
      request([source]),
      controls,
      { sourceId: source.id },
      undefined,
    );
    expect(whole.input).toMatchObject({
      sources: [{ id: source.id, evidenceKind: "performance-review", text: source.text }],
    });

    const windowed = buildBoundedCallRequest(
      request([source]),
      controls,
      { sourceId: source.id, window: { start: 0, end: 9, text: "Reviewer:" } },
      undefined,
    );
    expect(windowed.input).toMatchObject({
      sources: [{ id: source.id, evidenceKind: "performance-review", text: "Reviewer:" }],
      extractionWindow: { sourceId: source.id, start: 0, end: 9 },
    });
  });

  it("leaves the kind out of a request whose source has none", () => {
    const source = { id: "source-1", mediaType: "text/plain", checksum, text: "Engineer" };
    const whole = buildBoundedCallRequest(
      request([source]),
      controls,
      { sourceId: source.id },
      undefined,
    );
    expect(JSON.stringify(whole.input)).not.toContain("evidenceKind");
  });

  it("gives kind-specific guidance and keeps the grounding rules", () => {
    const { systemPrompt } = canonicalProfileRequest(model, "api-key");
    expect(systemPrompt).toContain(canonicalProfileEvidenceKindInstructions);
    for (const guidance of [
      "For a performance-review source, outcomes judged by others belong to the reviewer's assessment",
      "For a notes source, the text is fragmentary: extract only explicit statements",
      "For a linkedin-export source, the layout is fixed",
      "For a transcript source, only the candidate's own turns are evidence",
      "never invent facts, and every evidence quote is exact contiguous source text",
    ]) {
      expect(systemPrompt).toContain(guidance);
    }
    expect(systemPrompt).toContain(
      "make every evidence quote an exact contiguous quote from the cited source text",
    );
    expect(systemPrompt).toContain("Do not paraphrase evidence quotes or fact values.");
  });

  it("keeps identical text extracted under different kinds as separate provider inputs", () => {
    const text = "Engineer at Example";
    const prepared = prepareCanonicalCandidateProfileExtractionSources(
      [
        { id: "a", mediaType: "text/plain", checksum, text, evidenceKind: "cv" },
        { id: "b", mediaType: "text/plain", checksum, text, evidenceKind: "notes" },
        { id: "c", mediaType: "text/plain", checksum, text, evidenceKind: "cv" },
      ],
      new Map([
        ["a", reference("a")],
        ["b", reference("b")],
        ["c", reference("c")],
      ]),
    );
    expect(prepared.sources.map((source) => [source.id, source.evidenceKind])).toEqual([
      ["a", "cv"],
      ["b", "notes"],
    ]);
    expect(prepared.referencesByRepresentativeId.get("a")).toHaveLength(2);
  });

  it("prefers the user's override and otherwise detects the kind locally", () => {
    const transcript = [
      "Interviewer: Tell me about your last role.",
      "Candidate: I led the payments team for three years.",
      "Interviewer: What did you ship?",
      "Candidate: We rebuilt the settlement pipeline.",
    ].join("\n");
    expect(effectiveCandidateEvidenceKind({ text: transcript, mediaType: "text/plain" })).toBe(
      "transcript",
    );
    expect(
      effectiveCandidateEvidenceKind({ text: transcript, mediaType: "text/plain", override: "cv" }),
    ).toBe("cv");
  });

  it("records kinds per version and flags a material whose kind changed", () => {
    const recorded = recordedCanonicalProfileEvidenceKinds([
      { reference: reference("b"), evidenceKind: "notes" },
      { reference: reference("a"), evidenceKind: "cv" },
      { reference: reference("c") },
    ]);
    expect(recorded).toEqual([
      { ...reference("a"), kind: "cv" },
      { ...reference("b"), kind: "notes" },
    ]);

    const changed = evidenceKindChangedSince(recorded);
    expect(changed({ reference: reference("a"), evidenceKind: "cv" })).toBe(false);
    expect(changed({ reference: reference("a"), evidenceKind: "transcript" })).toBe(true);
    expect(changed({ reference: reference("c"), evidenceKind: "cv" })).toBe(true);
    expect(
      evidenceKindChangedSince(undefined)({ reference: reference("a"), evidenceKind: "cv" }),
    ).toBe(true);
  });
});
