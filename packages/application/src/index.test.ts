import { describe, expect, it, vi } from "vitest";

import { type ApplicationDriver, createApplicationService } from "./index.js";

function driver(): ApplicationDriver {
  const snapshot = { runId: "run-1" } as never;
  const opportunityRecord = {
    workspaceId: "workspace-1",
    brief: { id: "brief-1", version: 1 },
    checksum: "a".repeat(64),
  } as never;
  const profileRecord = {
    workspaceId: "workspace-1",
    profile: { id: "profile-1", version: 1 },
    checksum: "b".repeat(64),
  } as never;
  return {
    initialize: vi.fn(async (command) => ({
      id: "workspace-1",
      root: command.root,
      jobDescriptionPath: command.jobDescription,
      sourceDirectory: command.sources,
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: "anthropic", model: "author" },
      critic: { company: "openai", model: "critic" },
      fixtureMode: true,
    })),
    readWorkspace: vi.fn(async (root) => ({
      id: "workspace-1",
      root,
      jobDescriptionPath: "job.md",
      sourceDirectory: "evidence",
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: "anthropic", model: "author" },
      critic: { company: "openai", model: "critic" },
      fixtureMode: true,
    })),
    reconfigureModels: vi.fn<ApplicationDriver["reconfigureModels"]>(async (command) => ({
      id: "workspace-1",
      root: command.root,
      jobDescriptionPath: "job.md",
      sourceDirectory: "evidence",
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: command.authorCompany, model: command.authorModel },
      critic: { company: command.criticCompany, model: command.criticModel },
      fixtureMode: true,
    })),
    configureWritingPolicy: vi.fn<ApplicationDriver["configureWritingPolicy"]>(async (command) => ({
      id: "workspace-1",
      root: command.root,
      jobDescriptionPath: "job.md",
      sourceDirectory: "evidence",
      writingPolicyPath: ".draft-loop/writing-policy.md",
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: "anthropic", model: "author" },
      critic: { company: "openai", model: "critic" },
      fixtureMode: true,
    })),
    getWritingPolicy: vi.fn<NonNullable<ApplicationDriver["getWritingPolicy"]>>(
      async () => undefined,
    ),
    listWritingPolicyVersions: vi.fn<NonNullable<ApplicationDriver["listWritingPolicyVersions"]>>(
      async () => [],
    ),
    configureKnowledgeSelection: vi.fn<ApplicationDriver["configureKnowledgeSelection"]>(
      async (command) => ({
        id: "workspace-1",
        root: command.root,
        jobDescriptionPath: "job.md",
        sourceDirectory: "evidence",
        language: "en",
        outputFormat: "markdown" as const,
        requiredSections: ["Summary"],
        maxRounds: 3,
        author: { company: "anthropic", model: "author" },
        critic: { company: "openai", model: "critic" },
        fixtureMode: true,
      }),
    ),
    begin: vi.fn(async () => snapshot),
    start: vi.fn(async () => snapshot),
    resume: vi.fn(async () => snapshot),
    lifecycle: vi.fn(async () => snapshot),
    status: vi.fn(async () => snapshot),
    createOpportunity: vi.fn(async () => opportunityRecord),
    getOpportunity: vi.fn(async () => opportunityRecord),
    listOpportunityVersions: vi.fn(async () => [opportunityRecord]),
    editOpportunity: vi.fn(async () => opportunityRecord),
    reviewOpportunity: vi.fn(async () => opportunityRecord),
    deriveCanonicalCandidateProfile: vi.fn(async () => profileRecord),
    getCanonicalCandidateProfile: vi.fn(async () => profileRecord),
    listCanonicalCandidateProfileVersions: vi.fn(async () => [profileRecord]),
    editCanonicalCandidateProfile: vi.fn(async () => profileRecord),
    reviewCanonicalCandidateProfile: vi.fn(async () => profileRecord),
    export: vi.fn(async () => "exports/run-1.md"),
    latestExportPath: vi.fn(async () => null),
    queryEvidence: vi.fn(async () => []),
    inspectEvidenceRetrieval: vi.fn<ApplicationDriver["inspectEvidenceRetrieval"]>(async () => ({
      status: "not-indexed",
      indexedChunkCount: 0,
      selectedChunkCount: 0,
      selectedSourceCount: 0,
      hits: [],
    })),
    recordReviewDecision: vi.fn(async () => undefined),
    readIndependentReview: vi.fn<ApplicationDriver["readIndependentReview"]>(async () => ({
      authorLineage: "anthropic:author",
      criticLineage: "openai:critic",
      lineagesDistinct: true,
      required: true,
    })),
    readRunWritingPolicy: vi.fn<NonNullable<ApplicationDriver["readRunWritingPolicy"]>>(
      async () => undefined,
    ),
  };
}

describe("application service contract", () => {
  it("normalizes the shared root and supplies a safe no-op IO adapter", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.start({ root: "workspace" });

    expect(underlying.start).toHaveBeenCalledWith(
      { root: "workspace" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards durable run creation without starting provider execution", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.begin({ root: "workspace", allowProviderData: true });

    expect(underlying.begin).toHaveBeenCalledWith(
      { root: "workspace", allowProviderData: true },
      expect.objectContaining({ write: expect.any(Function) }),
    );
    expect(underlying.start).not.toHaveBeenCalled();
  });

  it("forwards an exact reviewed opportunity only when creating a run", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.start({
      root: "workspace",
      opportunityBrief: { briefId: "brief-1", version: 3 },
    });

    expect(underlying.start).toHaveBeenCalledWith(
      {
        root: "workspace",
        opportunityBrief: { briefId: "brief-1", version: 3 },
      },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards an exact candidate profile only when creating a run", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.start({
      root: "workspace",
      candidateProfile: { profileId: "profile-1", version: 3 },
    });

    expect(underlying.start).toHaveBeenCalledWith(
      {
        root: "workspace",
        candidateProfile: { profileId: "profile-1", version: 3 },
      },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards policy override and path-safe policy reads through the shared boundary", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);
    const checksum = "a".repeat(64);
    const getWritingPolicy = service.getWritingPolicy;
    const listWritingPolicyVersions = service.listWritingPolicyVersions;
    const readRunWritingPolicy = service.readRunWritingPolicy;
    const underlyingGetWritingPolicy = underlying.getWritingPolicy;
    const underlyingListWritingPolicyVersions = underlying.listWritingPolicyVersions;
    const underlyingReadRunWritingPolicy = underlying.readRunWritingPolicy;
    if (
      getWritingPolicy === undefined ||
      listWritingPolicyVersions === undefined ||
      readRunWritingPolicy === undefined ||
      underlyingGetWritingPolicy === undefined ||
      underlyingListWritingPolicyVersions === undefined ||
      underlyingReadRunWritingPolicy === undefined
    ) {
      throw new Error("writing-policy service APIs are unavailable");
    }

    await service.start({
      root: "workspace",
      opportunityBrief: { briefId: "brief-1", version: 3 },
      writingPolicyOverrideChecksum: checksum,
    });
    await getWritingPolicy({ root: "workspace", checksum });
    await listWritingPolicyVersions({ root: "workspace" });
    await readRunWritingPolicy({ root: "workspace", runId: "run-1" });

    expect(underlying.start).toHaveBeenCalledWith(
      {
        root: "workspace",
        opportunityBrief: { briefId: "brief-1", version: 3 },
        writingPolicyOverrideChecksum: checksum,
      },
      expect.objectContaining({ write: expect.any(Function) }),
    );
    expect(underlyingGetWritingPolicy).toHaveBeenCalledWith({ root: "workspace", checksum });
    expect(underlyingListWritingPolicyVersions).toHaveBeenCalledWith({ root: "workspace" });
    expect(underlyingReadRunWritingPolicy).toHaveBeenCalledWith({
      root: "workspace",
      runId: "run-1",
    });
  });

  it("forwards queryEvidence with normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.queryEvidence({ root: "workspace", query: "typescript" });

    expect(underlying.queryEvidence).toHaveBeenCalledWith(
      { root: "workspace", query: "typescript" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards retrieval inspection with normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.inspectEvidenceRetrieval({ root: "workspace", query: "typescript" });

    expect(underlying.inspectEvidenceRetrieval).toHaveBeenCalledWith(
      { root: "workspace", query: "typescript" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards opportunity version commands and validates their roots", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);
    const source = {
      id: "source-1",
      kind: "pasted-content" as const,
      classification: "job-posting" as const,
      content: "A bounded source.",
    };

    await service.createOpportunity({ root: "workspace", id: "brief-1", sources: [source] });
    await service.getOpportunity({ root: "workspace", briefId: "brief-1" });
    await service.getOpportunity({ root: "workspace", briefId: "brief-1", version: 1 });
    await service.listOpportunityVersions({ root: "workspace", briefId: "brief-1" });
    await service.editOpportunity({
      root: "workspace",
      briefId: "brief-1",
      expectedVersion: 1,
      patch: {},
      createdAt: "2026-08-28T10:00:00.000Z",
    });
    await service.reviewOpportunity({
      root: "workspace",
      briefId: "brief-1",
      expectedVersion: 2,
      reviewedAt: "2026-08-28T10:01:00.000Z",
    });

    expect(underlying.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", id: "brief-1", sources: [source] }),
    );
    expect(underlying.getOpportunity).toHaveBeenNthCalledWith(1, {
      root: "workspace",
      briefId: "brief-1",
    });
    expect(underlying.getOpportunity).toHaveBeenNthCalledWith(2, {
      root: "workspace",
      briefId: "brief-1",
      version: 1,
    });
    expect(underlying.listOpportunityVersions).toHaveBeenCalledWith({
      root: "workspace",
      briefId: "brief-1",
    });
    expect(underlying.editOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", expectedVersion: 1 }),
    );
    expect(underlying.reviewOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", expectedVersion: 2 }),
    );

    await expect(
      service.getOpportunity({ root: "   ", briefId: "private-brief-id" }),
    ).rejects.toThrow("workspace root is required");
    expect(underlying.getOpportunity).toHaveBeenCalledTimes(2);
  });

  it("forwards canonical candidate profile version commands and validates their roots", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.deriveCanonicalCandidateProfile({
      root: "workspace",
      profileId: "profile-1",
      allowProviderData: true,
      createdAt: "2026-08-28T10:00:00.000Z",
    });
    await service.getCanonicalCandidateProfile({ root: "workspace", profileId: "profile-1" });
    await service.getCanonicalCandidateProfile({
      root: "workspace",
      profileId: "profile-1",
      version: 1,
    });
    await service.listCanonicalCandidateProfileVersions({
      root: "workspace",
      profileId: "profile-1",
    });
    await service.editCanonicalCandidateProfile({
      root: "workspace",
      profileId: "profile-1",
      expectedVersion: 1,
      patch: { facts: [] },
      updatedAt: "2026-08-28T10:01:00.000Z",
    });
    await service.reviewCanonicalCandidateProfile({
      root: "workspace",
      profileId: "profile-1",
      expectedVersion: 2,
      reviewedAt: "2026-08-28T10:02:00.000Z",
    });

    expect(underlying.deriveCanonicalCandidateProfile).toHaveBeenCalledWith({
      root: "workspace",
      profileId: "profile-1",
      allowProviderData: true,
      createdAt: "2026-08-28T10:00:00.000Z",
    });
    expect(underlying.getCanonicalCandidateProfile).toHaveBeenNthCalledWith(1, {
      root: "workspace",
      profileId: "profile-1",
    });
    expect(underlying.getCanonicalCandidateProfile).toHaveBeenNthCalledWith(2, {
      root: "workspace",
      profileId: "profile-1",
      version: 1,
    });
    expect(underlying.listCanonicalCandidateProfileVersions).toHaveBeenCalledWith({
      root: "workspace",
      profileId: "profile-1",
    });
    expect(underlying.editCanonicalCandidateProfile).toHaveBeenCalledWith({
      root: "workspace",
      profileId: "profile-1",
      expectedVersion: 1,
      patch: { facts: [] },
      updatedAt: "2026-08-28T10:01:00.000Z",
    });
    expect(underlying.reviewCanonicalCandidateProfile).toHaveBeenCalledWith({
      root: "workspace",
      profileId: "profile-1",
      expectedVersion: 2,
      reviewedAt: "2026-08-28T10:02:00.000Z",
    });

    await expect(
      service.getCanonicalCandidateProfile({ root: "   ", profileId: "private-profile-id" }),
    ).rejects.toThrow("workspace root is required");
    expect(underlying.getCanonicalCandidateProfile).toHaveBeenCalledTimes(2);
  });

  it("forwards the durable latest export path query with normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.latestExportPath({ root: "workspace", runId: "run-1", format: "markdown" });

    expect(underlying.latestExportPath).toHaveBeenCalledWith({
      root: "workspace",
      runId: "run-1",
      format: "markdown",
    });
  });

  it("rejects empty roots before an adapter can access the filesystem", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await expect(service.status({ root: "   " })).rejects.toThrow("workspace root is required");
    expect(underlying.status).not.toHaveBeenCalled();
  });

  it("forwards desktop review decisions through the application boundary", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.recordReviewDecision({
      root: "workspace",
      runId: "run-1",
      kind: "finding",
      targetId: "finding-1",
      decision: "accepted",
    });

    expect(underlying.recordReviewDecision).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", targetId: "finding-1" }),
    );
  });

  it("forwards candidate-knowledge selection configuration with a normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.configureKnowledgeSelection({
      root: "workspace",
      entries: [{ storeRoot: "/tmp/store", storeId: "store-1", knowledgeBaseId: "ckb-1" }],
    });

    expect(underlying.configureKnowledgeSelection).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", entries: expect.any(Array) }),
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards the recorded independence question with a validated root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await expect(
      service.readIndependentReview({ root: "workspace", runId: "run-1" }),
    ).resolves.toEqual({
      authorLineage: "anthropic:author",
      criticLineage: "openai:critic",
      lineagesDistinct: true,
      required: true,
    });
    expect(underlying.readIndependentReview).toHaveBeenCalledWith({
      root: "workspace",
      runId: "run-1",
    });

    await expect(service.readIndependentReview({ root: "  " })).rejects.toThrow(
      "workspace root is required",
    );
    expect(underlying.readIndependentReview).toHaveBeenCalledTimes(1);
  });

  it("forwards provider recovery through the provider-independent lifecycle boundary", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.lifecycle({ root: "workspace", runId: "run-1", action: "recover-review" });

    expect(underlying.lifecycle).toHaveBeenCalledWith(
      { root: "workspace", runId: "run-1", action: "recover-review" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });
});
