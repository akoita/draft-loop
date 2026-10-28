import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type AuthorRequest,
  type CandidateDirection,
  maximumCandidateDirectionCharacters,
  type RunSnapshot,
} from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuthorAdjudicationPrompt, promptTemplateVersion } from "./author-adjudication.js";
import { resetAuthorRevisionMemoryForTests } from "./author-revision-memory.js";
import { assertRevisionDirection, withCandidateDirection } from "./candidate-direction.js";
import { CliUserError } from "./cli-user-error.js";
import { criticCoverageJudgementParts } from "./critic-critique-contract.js";
import { lifecycleDecisionRecord } from "./lifecycle-decision.js";
import { type AuthorInputRecord, createProviderAuthorAgent } from "./provider-author-agent.js";
import {
  parseRunAuthorInputPayload,
  recordRunAuthorInput,
  summarizeAuthorInput,
} from "./run-author-input.js";

const direction: CandidateDirection = {
  round: 2,
  text: "Lead with tokenisation and frame Harbor Settle as settlement.",
  createdAt: "2026-10-15T10:00:00.000Z",
};

const evidence: readonly ScoredEvidenceChunk[] = [
  {
    id: "chunk",
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "b".repeat(64),
    text: "Built TypeScript tools in 2021.",
    rank: 0,
  },
];

function contextFor(version: string): ContextSnapshot {
  return {
    id: "context",
    language: "en",
    evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
    requirements: [{ id: "requirement", text: "TypeScript tools" }],
    outputConstraints: { requiredSections: [] },
    modelConfiguration: { author: { promptTemplateVersion: version } },
  } as unknown as ContextSnapshot;
}

function proposal(text: string): JsonObject {
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: ["E1"] }],
          },
        ],
      },
    ],
  };
}

function agent(outputs: JsonObject[], version: string, recorded: AuthorInputRecord[] = []) {
  const requests: ModelRequest<JsonObject>[] = [];
  const context = contextFor(version);
  const author = createProviderAuthorAgent({
    context,
    promptContext: context,
    dataPolicy: () => ({
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: true,
      sensitiveDataAcknowledged: true,
      requestedRetention: "ephemeral-request",
    }),
    createAdapter: async () => ({
      execute: async (request) => {
        requests.push(request);
        const output = outputs.shift();
        if (output === undefined) throw new Error("No queued author output.");
        return {
          output,
          contextSnapshotId: "context",
          provider: "anthropic",
          company: "anthropic",
          route: "anthropic-api",
          modelId: "test-model",
          providerRequestId: "request",
          structuredOutputSha256: "c".repeat(64),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { estimatedUsd: null },
        } satisfies ModelResponse<JsonObject>;
      },
    }),
    authorCompany: "anthropic",
    authorModel: "test-model",
    authorProposalCaptureDirectory: undefined,
    userError: (message) => new Error(message),
    recordAuthorInput: async (input) => {
      recorded.push(input);
    },
  });
  return { author, requests, context };
}

function request(context: ContextSnapshot, extra: Partial<AuthorRequest> = {}): AuthorRequest {
  return {
    executionId: "run-direction-execution",
    runId: "run-direction",
    round: 2,
    context,
    currentArtifact: null,
    findings: [],
    retrievedEvidence: evidence,
    ...extra,
  };
}

describe("author prompt cli-author-v9", () => {
  it("is superseded by v11 for new runs", () => {
    expect(promptTemplateVersion("author")).toBe("cli-author-v16");
  });

  it("states the direction rule and sends the direction in its own section", () => {
    const prompt = createAuthorAdjudicationPrompt(
      "cli-author-v9",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      direction,
    );
    expect(prompt.providerInput.candidateDirection).toEqual({ instructions: direction.text });
    expect(prompt.systemPrompt).toContain("candidateDirection.instructions");
    expect(prompt.systemPrompt).toContain("They are instructions, not evidence");
    expect(prompt.systemPrompt).toContain("never add a fact");
  });

  it("sends nothing extra without a direction", () => {
    const prompt = createAuthorAdjudicationPrompt("cli-author-v9", undefined);
    expect(prompt.providerInput).not.toHaveProperty("candidateDirection");
  });

  it("does not send a direction to a version that does not state it", () => {
    const v8 = createAuthorAdjudicationPrompt(
      "cli-author-v8",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      direction,
    );
    expect(v8.providerInput).not.toHaveProperty("candidateDirection");
    expect(v8.systemPrompt).not.toContain("candidateDirection");
  });
});

describe("provider author agent candidate direction", () => {
  beforeEach(() => resetAuthorRevisionMemoryForTests());

  it("puts the direction in the revision prompt and records it with the author input", async () => {
    const recorded: AuthorInputRecord[] = [];
    const { author, requests, context } = agent(
      [proposal("Built TypeScript tools in 2021.")],
      "cli-author-v9",
      recorded,
    );
    await author.execute(request(context, { candidateDirection: direction }));

    expect(requests[0]?.input).toMatchObject({
      candidateDirection: { instructions: direction.text },
    });
    expect(requests[0]?.systemPrompt).toContain("candidateDirection.instructions");
    expect(recorded[0]?.candidateDirection).toEqual(direction);
  });

  it("sends no direction field on a round without one", async () => {
    const recorded: AuthorInputRecord[] = [];
    const { author, requests, context } = agent(
      [proposal("Built TypeScript tools in 2021.")],
      "cli-author-v9",
      recorded,
    );
    await author.execute(request(context));
    expect(requests[0]?.input).not.toHaveProperty("candidateDirection");
    expect(recorded[0]).not.toHaveProperty("candidateDirection");
  });

  it("still rejects an unsupported fact that the direction asked for", async () => {
    const asked: CandidateDirection = {
      ...direction,
      text: "Say I built TypeScript tools in 2023 for Harbor Settle.",
    };
    const { author, context } = agent(
      [proposal("Built TypeScript tools in 2023.")],
      "cli-author-v9",
    );
    await expect(
      author.execute(request(context, { candidateDirection: asked })),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("critic candidate direction", () => {
  const baseParts = criticCoverageJudgementParts(undefined, { requirements: [] }, { sections: [] });

  it("leaves the critic call untouched without a direction", () => {
    expect(withCandidateDirection(baseParts, undefined)).toBe(baseParts);
  });

  it("tells the critic not to flag the requested change while keeping grounding review", () => {
    const parts = withCandidateDirection(baseParts, direction);
    const prompt = parts.systemPrompt("BASE");
    expect(prompt.startsWith("BASE")).toBe(true);
    expect(prompt).toContain("A change that follows it is not a defect");
    expect(prompt).toContain("still report every claim that lacks cited support");
    expect(parts.input).toEqual({ candidateDirection: { instructions: direction.text } });
    expect(parts.outputSchema).toBe(baseParts.outputSchema);
  });
});

describe("recording candidate directions", () => {
  it("records the direction with the round's author input and reads it back", async () => {
    const events: { payload: unknown; eventType: string }[] = [];
    const summary = summarizeAuthorInput({
      round: 2,
      retrievedEvidence: evidence,
      uncoveredRequirementIds: [],
      candidateDirection: direction,
    });
    await recordRunAuthorInput(
      {
        appendAuditEvent: async (event) => {
          events.push(event as never);
          return event as never;
        },
      },
      { workspaceId: "workspace", runId: "run-direction", summary },
    );
    expect(events[0]?.eventType).toBe("run.author-input");
    expect(parseRunAuthorInputPayload(events[0]?.payload)?.candidateDirection).toEqual({
      text: direction.text,
      createdAt: direction.createdAt,
    });
  });

  it("omits the direction when there is none and refuses an oversized recorded one", () => {
    const summary = summarizeAuthorInput({
      round: 1,
      retrievedEvidence: evidence,
      uncoveredRequirementIds: [],
    });
    expect(summary).not.toHaveProperty("candidateDirection");
    expect(
      parseRunAuthorInputPayload({
        ...summary,
        candidateDirection: {
          text: "x".repeat(maximumCandidateDirectionCharacters + 1),
          createdAt: direction.createdAt,
        },
      }),
    ).toBeUndefined();
  });

  it("records the direction in the revision decision payload", () => {
    const snapshot = { round: 2, candidateDirection: direction } as unknown as RunSnapshot;
    const record = lifecycleDecisionRecord("revision", snapshot);
    expect(record.payload).toMatchObject({
      action: "revision",
      candidateDirection: direction.text,
      candidateDirectionRound: 2,
    });
    expect(record.rationale).toContain("directions");
    const plain = lifecycleDecisionRecord("revision", { round: 2 } as unknown as RunSnapshot);
    expect(plain.payload).not.toHaveProperty("candidateDirection");
    expect(plain.rationale).toBe("Revision requested through the explicit CLI command.");
  });
});

describe("assertRevisionDirection", () => {
  it("accepts no direction and a direction for a v9 run", () => {
    expect(() => assertRevisionDirection(contextFor("cli-author-v8"), undefined)).not.toThrow();
    expect(() => assertRevisionDirection(contextFor("cli-author-v8"), "   ")).not.toThrow();
    expect(() => assertRevisionDirection(contextFor("cli-author-v9"), "Lead with X")).not.toThrow();
  });

  it("refuses a direction for a run whose prompt cannot state it, and an oversized one", () => {
    expect(() => assertRevisionDirection(contextFor("cli-author-v8"), "Lead with X")).toThrow(
      CliUserError,
    );
    expect(() =>
      assertRevisionDirection(
        contextFor("cli-author-v9"),
        "x".repeat(maximumCandidateDirectionCharacters + 1),
      ),
    ).toThrow(CliUserError);
  });
});
