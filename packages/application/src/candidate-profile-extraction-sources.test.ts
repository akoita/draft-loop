import { maximumCanonicalCandidateProfileProvenanceCount } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import type {
  CanonicalCandidateProfileExtractionMaterial,
  CanonicalCandidateProfileExtractionPort,
  CanonicalCandidateProfileExtractionRequest,
  CanonicalCandidateProfileExtractionSource,
} from "./candidate-profile-extraction.js";
import { processCanonicalCandidateProfileExtraction } from "./candidate-profile-extraction.js";
import { prepareCanonicalCandidateProfileExtractionSources } from "./candidate-profile-extraction-sources.js";

const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);

interface SourceOverrides {
  readonly checksum?: string;
  readonly mediaType?: string;
}

function material(
  id: string,
  text: string,
  { checksum = checksumA, mediaType = "text/markdown" }: SourceOverrides = {},
): CanonicalCandidateProfileExtractionMaterial {
  return {
    id,
    mediaType,
    checksum,
    text,
    reference: {
      storeId: `store-${id}`,
      knowledgeBaseId: `knowledge-${id}`,
      sourceId: `document-${id}`,
      versionId: `version-${id}`,
      kind: "candidate-provided",
    },
  };
}

function providerSource(
  source: CanonicalCandidateProfileExtractionMaterial,
): CanonicalCandidateProfileExtractionSource {
  return {
    id: source.id,
    mediaType: source.mediaType,
    checksum: source.checksum,
    text: source.text,
  };
}

function profileFact(
  key: string,
  value: string,
  sourceId: string,
  options: {
    readonly category?: string;
    readonly field?: string;
    readonly subjectKey?: string;
  } = {},
) {
  return {
    key,
    category: options.category ?? "skill",
    field: options.field ?? "name",
    value,
    ...(options.subjectKey === undefined ? {} : { subjectKey: options.subjectKey }),
    evidence: [{ sourceId, quote: value }],
  };
}

async function process(
  sources: readonly CanonicalCandidateProfileExtractionMaterial[],
  output: unknown,
): Promise<{
  readonly result: Awaited<ReturnType<typeof processCanonicalCandidateProfileExtraction>>;
  readonly request: CanonicalCandidateProfileExtractionRequest | undefined;
}> {
  let request: CanonicalCandidateProfileExtractionRequest | undefined;
  const port: CanonicalCandidateProfileExtractionPort = {
    extract: async (value) => {
      request = value;
      return output;
    },
  };
  const result = await processCanonicalCandidateProfileExtraction(port, {
    operationId: "deduplicated-profile-extraction",
    sources,
    allowProviderData: true,
  });
  return { result, request };
}

describe("canonical candidate profile extraction source preparation", () => {
  it("sends exact duplicate contents once and maps the representative to every local source version", async () => {
    const awsText = "AWS Certified Solutions Architect";
    const scrumText = "Professional Scrum Master";
    const sources = [
      material("source-a", awsText),
      material("source-b", awsText),
      material("source-c", scrumText, { checksum: checksumB }),
      material("source-d", scrumText, { checksum: checksumB }),
    ];
    const { result, request } = await process(sources, {
      schemaVersion: 1,
      facts: [
        profileFact("aws", awsText, "source-a", {
          category: "certification",
          subjectKey: "aws-certification",
        }),
        profileFact("scrum", scrumText, "source-c", {
          category: "certification",
          subjectKey: "scrum-certification",
        }),
      ],
      issues: [],
    });

    expect(request?.operationId).toBe("deduplicated-profile-extraction");
    expect(request?.sources).toEqual(
      sources
        .filter((source) => source.id === "source-a" || source.id === "source-c")
        .map(providerSource),
    );
    expect(JSON.stringify(request)).not.toContain("store-source-");
    expect(request?.sources.map((source) => source.text)).toEqual([awsText, scrumText]);
    expect(result.facts).toHaveLength(2);
    expect(
      result.facts.flatMap((fact) => fact.provenance.map((ref) => ref.versionId)).sort(),
    ).toEqual(["version-source-a", "version-source-b", "version-source-c", "version-source-d"]);
  });

  it("does not group records with different media types, checksums, or text", async () => {
    const text = "TypeScript experience";
    const sources = [
      material("source-a", text, { mediaType: "text/plain" }),
      material("source-b", text, { checksum: checksumB, mediaType: "text/plain" }),
      material("source-c", text, { mediaType: "text/markdown" }),
      material("source-d", `${text} in projects`, { mediaType: "text/plain" }),
    ];
    const { result, request } = await process(sources, {
      schemaVersion: 1,
      facts: sources.map((source, index) =>
        profileFact(`skill-${index}`, "TypeScript", source.id, {
          field: `skill-${index}`,
        }),
      ),
      issues: [],
    });

    expect(request?.sources).toEqual(sources.map(providerSource));
    expect(result.facts).toHaveLength(4);
    expect(result.facts.map((fact) => fact.provenance[0]?.versionId)).toEqual(
      sources.map((source) => source.reference.versionId),
    );
  });

  it("rejects fact or issue citations to duplicate IDs omitted from the provider request", async () => {
    const text = "Engineer and Staff Engineer";
    const sources = [material("source-a", text), material("source-b", text)];
    const invalidOutputs = [
      {
        schemaVersion: 1,
        facts: [
          profileFact("role", "Engineer", "source-b", {
            category: "role",
            subjectKey: "employment-alias",
          }),
        ],
        issues: [],
      },
      {
        schemaVersion: 1,
        facts: [
          profileFact("role-a", "Engineer", "source-a", {
            category: "role",
            field: "title",
            subjectKey: "employment-alias",
          }),
          profileFact("role-b", "Staff Engineer", "source-a", {
            category: "role",
            field: "title",
            subjectKey: "employment-alias",
          }),
        ],
        issues: [
          {
            code: "conflict-title",
            factKeys: ["role-a", "role-b"],
            sourceIds: ["source-b"],
          },
        ],
      },
    ];

    for (const output of invalidOutputs) {
      const { result, request } = await process(sources, output);
      expect(request?.sources.map((source) => source.id)).toEqual(["source-a"]);
      expect(result.facts).toEqual([]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toBe(
        "Extracted claims could not be grounded in the selected sources. No facts were saved; review the source material and try again.",
      );
      expect(result.issues[0]?.sourceRefs).toHaveLength(2);
    }
  });

  it("expands provider issue citations from a representative to its duplicate source versions", async () => {
    const employmentText = "Engineer and Staff Engineer";
    const dateText = "2020 to 2023";
    const sources = [
      material("source-a", employmentText),
      material("source-b", employmentText),
      material("source-c", dateText, { checksum: checksumB }),
      material("source-d", dateText, { checksum: checksumB }),
    ];
    const { result, request } = await process(sources, {
      schemaVersion: 1,
      facts: [
        profileFact("role-a", "Engineer", "source-a", {
          category: "role",
          field: "title",
          subjectKey: "employment-one",
        }),
        profileFact("role-b", "Staff Engineer", "source-a", {
          category: "role",
          field: "title",
          subjectKey: "employment-one",
        }),
      ],
      issues: [
        {
          code: "conflict-title",
          factKeys: ["role-a", "role-b"],
          sourceIds: ["source-c"],
        },
      ],
    });

    expect(request?.sources.map((source) => source.id)).toEqual(["source-a", "source-c"]);
    const conflicts = result.issues.filter((issue) => issue.code === "conflict-title");
    expect(conflicts).toHaveLength(2);
    expect(
      conflicts
        .find((issue) =>
          issue.sourceRefs.some((reference) => reference.versionId === "version-source-c"),
        )
        ?.sourceRefs.map((reference) => reference.versionId),
    ).toEqual(["version-source-a", "version-source-b", "version-source-c", "version-source-d"]);
  });

  it("chunks more identical sources than the provenance bound into deterministic representatives", () => {
    const sources = Array.from(
      { length: maximumCanonicalCandidateProfileProvenanceCount + 1 },
      (_, index) => material(`source-${String(index).padStart(2, "0")}`, "same exact content"),
    );
    const prepared = prepareCanonicalCandidateProfileExtractionSources(
      sources.map(providerSource),
      new Map(sources.map((source) => [source.id, source.reference])),
    );

    expect(prepared.sources.map((source) => source.id)).toEqual(["source-00", "source-32"]);
    expect(prepared.referencesByRepresentativeId.get("source-00")).toHaveLength(32);
    expect(prepared.referencesByRepresentativeId.get("source-32")).toHaveLength(1);
    expect(prepared.sourceTextsByRepresentativeId.get("source-32")).toBe("same exact content");
  });

  it("fails closed when expansion exceeds one fact's provenance bound", async () => {
    const text = "AWS Certified Solutions Architect";
    const sources = Array.from({ length: 64 }, (_, index) =>
      material(`source-${String(index).padStart(2, "0")}`, text, {
        checksum: index < 32 ? checksumA : checksumB,
        mediaType: index < 32 ? "text/plain" : "text/markdown",
      }),
    );
    const { result, request } = await process(sources, {
      schemaVersion: 1,
      facts: [
        {
          ...profileFact("aws", "AWS Certified Solutions Architect", "source-00", {
            category: "certification",
          }),
          evidence: [
            { sourceId: "source-00", quote: text },
            { sourceId: "source-32", quote: text },
          ],
        },
      ],
      issues: [],
    });

    expect(request?.sources.map((source) => source.id)).toEqual(["source-00", "source-32"]);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.sourceRefs).toHaveLength(64);
  });
});
