import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalCandidateProfileExtractionProposalSchema,
  opportunityExtractionProposalSchema,
} from "@draft-loop/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver, type WorkspaceConfig } from "./local.js";
import {
  canonicalProfileExtractionPortFor,
  opportunityExtractionPortFor,
} from "./local-extraction-ports.js";
import {
  createFixtureCanonicalCandidateProfileExtractionPort,
  createFixtureOpportunityExtractionPort,
} from "./local-fixture-extraction.js";
import * as providerAdapter from "./local-provider-adapter.js";

vi.mock("./local-provider-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-provider-adapter.js")>();
  return { ...actual, createProviderAdapter: vi.fn(actual.createProviderAdapter) };
});

const createProviderAdapter = vi.mocked(providerAdapter.createProviderAdapter);
const silent = { write: () => undefined };
const evidenceText =
  "# Synthetic Candidate\n\n- Built a local-first TypeScript review tool\n- Led deterministic test design\n\nMaintained offline fixtures.\n";
const jobText =
  "# Platform Engineer\n\n## Requirements\n\n- Kubernetes operations\n- TypeScript services\n";

function workspaceConfig(fixtureMode: boolean): WorkspaceConfig {
  return {
    fixtureMode,
    authorCompany: "anthropic",
    authorModel: "claude-sonnet-4-5",
  } as unknown as WorkspaceConfig;
}

function profileSource(text = evidenceText) {
  return { id: "evidence-source", mediaType: "text/markdown", checksum: "a".repeat(64), text };
}

function jobSource(text = jobText) {
  return {
    id: "job-source",
    classification: "job-posting" as const,
    status: "available" as const,
    mediaType: "text/markdown",
    checksum: "b".repeat(64),
    text,
  };
}

beforeEach(() => {
  createProviderAdapter.mockClear();
});

describe("fixture canonical profile extraction", () => {
  it("returns deterministic facts that quote the source text verbatim", async () => {
    const port = createFixtureCanonicalCandidateProfileExtractionPort();
    const request = { operationId: "fixture-profile", sources: [profileSource()] };
    const proposal = canonicalCandidateProfileExtractionProposalSchema.parse(
      await port.extract(request),
    );

    expect(proposal.facts.map((fact) => fact.value)).toEqual([
      "Synthetic Candidate",
      "Built a local-first TypeScript review tool",
      "Led deterministic test design",
      "Maintained offline fixtures.",
    ]);
    for (const fact of proposal.facts) {
      expect(fact.evidence).toEqual([{ sourceId: "evidence-source", quote: fact.value }]);
      expect(evidenceText).toContain(fact.value);
    }
    expect(await port.extract(request)).toEqual(proposal);
  });

  it("returns no facts for text without content", async () => {
    const port = createFixtureCanonicalCandidateProfileExtractionPort();
    const proposal = await port.extract({
      operationId: "fixture-empty",
      sources: [profileSource("\n - \n#\n")],
    });
    expect(proposal).toMatchObject({ facts: [], issues: [] });
  });
});

describe("fixture requirements extraction", () => {
  it("takes the heading as the role and each list item as a requirement with its excerpt", async () => {
    const port = createFixtureOpportunityExtractionPort();
    const proposal = opportunityExtractionProposalSchema.parse(
      await port.extract({ operationId: "fixture-job", sources: [jobSource()] }),
    );

    expect(proposal.role).toEqual({ value: "Platform Engineer", sourceIds: ["job-source"] });
    expect(proposal.employer).toBeNull();
    expect(proposal.requirements).toEqual([
      {
        text: "Kubernetes operations",
        priority: "medium",
        sourceIds: ["job-source"],
        excerpt: "Kubernetes operations",
      },
      {
        text: "TypeScript services",
        priority: "medium",
        sourceIds: ["job-source"],
        excerpt: "TypeScript services",
      },
    ]);
  });

  it("uses plain lines after the first when the job text has no list", async () => {
    const port = createFixtureOpportunityExtractionPort();
    const proposal = opportunityExtractionProposalSchema.parse(
      await port.extract({
        operationId: "fixture-plain",
        sources: [jobSource("TypeScript systems engineer\nLocal-first product development\n")],
      }),
    );
    expect(proposal.role?.value).toBe("TypeScript systems engineer");
    expect(proposal.requirements.map((item) => item.text)).toEqual([
      "Local-first product development",
    ]);
  });
});

describe("extraction port routing", () => {
  it("never constructs a provider adapter in a demo workspace", async () => {
    await canonicalProfileExtractionPortFor(workspaceConfig(true), {
      allowProviderData: true,
    }).extract({ operationId: "demo-profile", sources: [profileSource()] });
    await opportunityExtractionPortFor(workspaceConfig(true), { allowProviderData: true }).extract({
      operationId: "demo-job",
      sources: [jobSource()],
    });
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("still constructs the provider adapter in a real workspace", async () => {
    const execute = vi.fn(async () => ({ output: { stubbed: true } }));
    createProviderAdapter.mockResolvedValue({ execute } as never);
    try {
      await expect(
        opportunityExtractionPortFor(workspaceConfig(false), { allowProviderData: true }).extract({
          operationId: "real-job",
          sources: [jobSource()],
        }),
      ).resolves.toEqual({ stubbed: true });
      canonicalProfileExtractionPortFor(workspaceConfig(false), { allowProviderData: true });
      expect(createProviderAdapter).toHaveBeenCalledOnce();
      expect(createProviderAdapter.mock.calls[0]?.[1]).toMatchObject({
        company: "anthropic",
        role: "author",
      });
    } finally {
      createProviderAdapter.mockReset();
    }
  });
});

describe("demo workspace extraction through the local driver", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draft-loop-demo-extraction-"));
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), jobText, "utf8");
    await writeFile(join(root, "evidence", "resume.md"), evidenceText, "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("generates a profile and requirements offline from the demo's own text", async () => {
    const storeRoot = join(root, "candidate-store");
    const ids = ["demo-store", "demo-ckb", "demo-source", "demo-version"];
    const store = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-10-15T10:00:00.000Z",
    });
    await store.initializeStore({ storeRoot });
    await store.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "demo-ckb",
      sourcePath: join(root, "evidence", "resume.md"),
    });
    const driver = createLocalApplicationDriver({
      resolveCredential: async () => {
        throw new Error("A demo workspace must not resolve provider credentials.");
      },
    });
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    await driver.configureKnowledgeSelection(
      { root, entries: [{ storeRoot, storeId: "demo-store", knowledgeBaseId: "demo-ckb" }] },
      silent,
    );

    const profile = await driver.deriveCanonicalCandidateProfile({
      root,
      profileId: "demo-profile",
      allowProviderData: true,
    });
    expect(profile.profile.status).toBe("draft");
    expect(profile.profile.facts.map((fact) => fact.value).sort()).toEqual(
      [
        "Built a local-first TypeScript review tool",
        "Led deterministic test design",
        "Maintained offline fixtures.",
        "Synthetic Candidate",
      ].sort(),
    );
    // The fixture reports no issues; the open ones are the derivation's own omission warnings,
    // which the person acknowledges as with any provider.
    expect(profile.profile.issues.every((issue) => issue.code === "omission")).toBe(true);
    const acknowledged = await driver.editCanonicalCandidateProfile({
      root,
      profileId: "demo-profile",
      expectedVersion: profile.profile.version,
      patch: {
        issues: profile.profile.issues.map((issue) => ({ ...issue, status: "acknowledged" })),
      },
    });
    const reviewed = await driver.reviewCanonicalCandidateProfile({
      root,
      profileId: "demo-profile",
      expectedVersion: acknowledged.profile.version,
    });
    expect(reviewed.profile.status).toBe("reviewed");

    const brief = await driver.createOpportunity({
      root,
      allowProviderData: true,
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: jobText,
        },
      ],
    });
    expect(brief.brief.role?.value).toBe("Platform Engineer");
    expect(brief.brief.requirements.map((item) => item.text)).toEqual([
      "Kubernetes operations",
      "TypeScript services",
    ]);
    // The fixture never invents an employer the job text does not name; the person adds it.
    expect(brief.brief.employer).toBeNull();
    const edited = await driver.editOpportunity({
      root,
      briefId: brief.brief.id,
      expectedVersion: brief.brief.version,
      patch: { employer: { value: "Example Systems", sourceIds: ["posting"] } },
    });
    const reviewedBrief = await driver.reviewOpportunity({
      root,
      briefId: brief.brief.id,
      expectedVersion: edited.brief.version,
    });
    expect(reviewedBrief.brief.status).toBe("reviewed");
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });
});
