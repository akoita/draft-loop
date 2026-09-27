import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidateContactEvidenceQuery,
  candidateContactEvidenceQueryLimit,
  isCandidateContactRecord,
  selectCandidateContactEvidence,
} from "./candidate-contact-evidence.js";
import { candidateKnowledgeChronologyProviderByteLimit } from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-27T09:00:00.000Z";

function lexicalHit(chunkId: string, text: string): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({
    chunkId,
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    text,
    bm25Rank: 0,
    metadata: {
      provenance: {
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: "source-a",
        versionId: "version-a",
      },
    },
  });
}

describe("candidate contact evidence", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("accepts explicit contact records with an email, labeled phone, or profile URL", () => {
    expect(
      isCandidateContactRecord(
        "Candidate contact: Fictional Candidate | Email: jordan@juniper.dev",
      ),
    ).toBe(true);
    expect(
      isCandidateContactRecord(
        "**Candidate identity:** Fictional Candidate | Phone: +1 202 555 0147",
      ),
    ).toBe(true);
    expect(
      isCandidateContactRecord(
        "CV header: Fictional Candidate | LinkedIn: https://www.linkedin.com/in/fictional-candidate",
      ),
    ).toBe(true);
    expect(
      isCandidateContactRecord(
        "**Contact.** Mira | mira@fictionalmail.org | Phone: +33 6 12 34 56 78 | LinkedIn: https://linkedin.com/in/mira **Disclosure.** Do not include personal contact details in examples.",
      ),
    ).toBe(true);
  });

  it("rejects policy text, placeholders, unlabeled details, and company/example discussion", () => {
    for (const text of [
      "Instructions: include contact, identity, email, phone, and LinkedIn in every profile.",
      "**Contact.** Do not include personal email or LinkedIn in sample profiles.",
      "Candidate contact: Name Here | Email: name@example.com | LinkedIn: linkedin.com/in/your-name",
      "Candidate contact: Phone: 555-01",
      "Skills: contact-center integration and LinkedIn API development.",
      "Company contact: hiring@northstar.dev | LinkedIn: https://linkedin.com/in/northstar-hiring",
      "Example header: Fictional Candidate | Email: jordan@juniper.dev",
      "Email: jordan@juniper.dev",
    ]) {
      expect(isCandidateContactRecord(text), text).toBe(false);
    }
  });

  it("selects one unchanged valid record only from matched results", () => {
    const policy = lexicalHit(
      "policy",
      "Instructions: include contact, email, phone, and LinkedIn in every profile.",
    );
    const contact = lexicalHit(
      "candidate-contact",
      "Candidate contact: Fictional Candidate | Email: jordan@juniper.dev",
    );
    const selected = selectCandidateContactEvidence({
      status: "matched",
      hits: [
        policy,
        contact,
        lexicalHit("second", "Header: Fictional Candidate | Phone: 202 555 0147"),
      ],
    });

    expect(selected).toBe(contact);
    expect(
      selectCandidateContactEvidence({ status: "bounded-fallback", hits: [contact] }),
    ).toBeUndefined();
    expect(
      selectCandidateContactEvidence({ status: "not-indexed", hits: [contact] }),
    ).toBeUndefined();
  });

  it("reserves the pinned contact record alongside chronology and required sections", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-contact-evidence-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    const roles = Array.from({ length: 13 }, (_, index) => {
      const year = 2010 + index;
      return [
        `## Example Systems ${index + 1} — Software Engineer — January ${year} to December ${year}`,
        "Maintained backend services and delivered reliability improvements.",
      ].join("\n");
    });
    await writeFile(
      sourcePath,
      [
        "# Fictional Candidate",
        "",
        "Candidate contact: Fictional Candidate | Email: jordan@juniper.dev | Phone: +1 202 555 0147 | LinkedIn: https://www.linkedin.com/in/fictional-candidate",
        "",
        "## Summary",
        "Backend software engineer focused on reliable service delivery and platform tools.",
        "",
        "## Projects",
        "QueueReplay prototype demonstrates asynchronous service testing workflows.",
        "",
        ...roles.flatMap((role) => [role, ""]),
        "## Education",
        "Bachelor of Computing, Example University, 2017.",
        "",
        "## Certifications",
        "Cloud Platform Practitioner Certificate, 2022.",
        "",
        "## Languages",
        "English — fluent; French — professional working proficiency.",
        "",
        "**Production experience:** Operated Java services in production with retries and incident response.",
      ].join("\n"),
      "utf8",
    );

    const ids = ["contact-store", "contact-ckb", "contact-source", "contact-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "contact-ckb",
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "contact-ckb" }],
    });
    const appendTrace = vi.fn(
      async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ): Promise<CandidateKnowledgeRetrievalTrace> =>
        input as unknown as CandidateKnowledgeRetrievalTrace,
    );
    const runtime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-contact",
        requiredSections: [
          "Experience",
          "Education",
          "Certifications",
          "Languages",
          "Skills",
          "Summary",
          "Projects",
        ],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "contact-ckb" }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");

    const query = "software engineer backend services reliability";
    const result = await runtime.inspect(query);
    const rawContactResults = await service.queryCandidateKnowledge({
      selections: [{ storeRoot, knowledgeBaseId: "contact-ckb" }],
      purpose: "achievement-recall",
      query: candidateContactEvidenceQuery,
      limit: candidateContactEvidenceQueryLimit,
    });
    const rawContact = selectCandidateContactEvidence(rawContactResults);
    if (rawContact === undefined) throw new Error("Expected the fictional pinned contact record.");
    const selectedContact = result.hits.find(({ chunkId }) => chunkId === rawContact.chunkId);

    expect(result.status).toBe("matched");
    expect(result.hits).toHaveLength(20);
    expect(selectedContact).toMatchObject({
      chunkId: rawContact.chunkId,
      ordinal: rawContact.ordinal,
      lineStart: rawContact.lineStart,
      lineEnd: rawContact.lineEnd,
      text: rawContact.text,
      metadata: rawContact.metadata,
    });
    expect(result.hits.filter(({ text }) => /^## .*— .*20\d{2}/u.test(text))).toHaveLength(13);
    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Bachelor of Computing, Example University, 2017."),
        expect.stringContaining("Cloud Platform Practitioner Certificate, 2022."),
        expect.stringContaining("English — fluent; French — professional working proficiency."),
        expect.stringContaining("Production experience:"),
        expect.stringContaining("Backend software engineer focused on reliable service delivery"),
        expect.stringContaining("QueueReplay prototype demonstrates asynchronous service testing"),
      ]),
    );
    expect(Buffer.byteLength(JSON.stringify(result.hits), "utf8")).toBeLessThanOrEqual(
      candidateKnowledgeChronologyProviderByteLimit,
    );
    expect(
      result.diagnostics.flatMap(({ selectedChunks }) =>
        selectedChunks.map(({ chunkId }) => chunkId),
      ),
    ).toContain(rawContact.chunkId);
    expect(
      appendTrace.mock.calls.flatMap(([trace]) =>
        trace.selectedChunks.map(({ chunkId }) => chunkId),
      ),
    ).toContain(rawContact.chunkId);
    const providerHits = await runtime.port.queryEvidence(query, { limit: 20 });
    expect(providerHits.find(({ id }) => id === rawContact.chunkId)?.text).toBe(rawContact.text);
  });
});
