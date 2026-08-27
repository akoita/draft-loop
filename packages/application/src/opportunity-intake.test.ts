import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type {
  IngestionIssue,
  IngestionResult,
  IngestionSource,
  NormalizedSource,
  UrlIngestionOptions,
} from "@draft-loop/ingestion";
import { describe, expect, it, vi } from "vitest";
import type { OpportunityExtractionRequest } from "./opportunity-extraction.js";
import {
  createOpportunityDraft,
  editOpportunityDraft,
  maximumOpportunityIntakeContentBytes,
  reviewOpportunityDraft,
} from "./opportunity-intake.js";

const capturedAt = "2026-08-27T10:00:00.000Z";
const later = "2026-08-27T10:05:00.000Z";
const latest = "2026-08-27T10:06:00.000Z";

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function issue(code: IngestionIssue["code"], sourcePath: string): IngestionIssue {
  return { code, sourcePath, message: "private ingestion detail", recoverable: true };
}

function normalizedSource(
  sourcePath: string,
  sourceChecksum: string,
  issues: readonly IngestionIssue[] = [],
): NormalizedSource {
  const source: IngestionSource = { path: sourcePath, mediaType: "text/plain" };
  return {
    source,
    mediaType: "text/plain",
    checksum: sourceChecksum,
    sizeBytes: 4,
    text: "raw source text",
    chunks: [],
    issues,
  };
}

function availableResult(sourcePath: string, sourceChecksum: string): IngestionResult {
  return { source: normalizedSource(sourcePath, sourceChecksum), issues: [] };
}

describe("opportunity intake", () => {
  it("extracts only sanitized opportunity material and preserves candidate instructions locally", async () => {
    const sensitiveRoot = "/private/opportunity/material";
    const jobText = "private job source text";
    const companyText = "private company source text";
    const candidateText = "private candidate instruction text";
    const ingestFile = vi.fn(async (source: IngestionSource): Promise<IngestionResult> => {
      const isPartial = source.path.endsWith("company.md");
      const text = isPartial ? companyText : jobText;
      const sourceChecksum = checksum(text);
      return {
        source: {
          source,
          mediaType: "text/plain",
          checksum: sourceChecksum,
          sizeBytes: Buffer.byteLength(text, "utf8"),
          text,
          chunks: [],
          issues: isPartial ? [issue("parse-failure", source.path)] : [],
        },
        issues: [],
      };
    });
    const extract = vi.fn(async (request: OpportunityExtractionRequest) => {
      expect(request.operationId).toMatch(/^extraction-[a-f0-9]{32}$/u);
      expect(request.sources.map((source) => source.id)).toEqual(["job-source", "company-source"]);
      expect(request.sources).toMatchObject([
        {
          id: "job-source",
          classification: "job-posting",
          status: "available",
          mediaType: "text/plain",
          checksum: checksum(jobText),
          text: jobText,
        },
        {
          id: "company-source",
          classification: "company-context",
          status: "partial",
          mediaType: "text/plain",
          checksum: checksum(companyText),
          text: companyText,
        },
      ]);
      const serialized = JSON.stringify(request);
      expect(serialized).not.toContain(sensitiveRoot);
      expect(serialized).not.toContain(candidateText);
      return {
        schemaVersion: 1,
        role: { value: "Platform Engineer", sourceIds: ["job-source"] },
        employer: { value: "Example Systems", sourceIds: ["company-source"] },
        responsibilities: [{ text: "Lead platform reliability", sourceIds: ["job-source"] }],
        requirements: [
          {
            text: "Production systems experience",
            priority: "critical",
            sourceIds: ["job-source"],
          },
        ],
        priorities: [{ text: "Operational ownership", sourceIds: ["company-source"] }],
        contradictions: [],
      };
    });

    const draft = await createOpportunityDraft(
      {
        id: "brief-extraction",
        createdAt: capturedAt,
        sources: [
          {
            id: "job-source",
            kind: "local-file",
            classification: "job-posting",
            path: `${sensitiveRoot}/job.md`,
          },
          {
            id: "company-source",
            kind: "local-file",
            classification: "company-context",
            path: `${sensitiveRoot}/company.md`,
          },
          {
            id: "candidate-source",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: candidateText,
            instructions: {
              tone: "Warm",
              applicationGoal: "Emphasize platform leadership",
              forbiddenLanguage: ["Do not exaggerate"],
              focusAreas: ["Reliability outcomes"],
            },
          },
        ],
      },
      { dependencies: { ingestFile }, extractor: { extract }, now: () => capturedAt },
    );

    expect(extract).toHaveBeenCalledOnce();
    expect(draft.sources.map((source) => source.id)).toEqual([
      "job-source",
      "company-source",
      "candidate-source",
    ]);
    expect(draft.sources.map((source) => source.status)).toEqual([
      "available",
      "partial",
      "available",
    ]);
    expect(draft.role).toEqual({ value: "Platform Engineer", sourceIds: ["job-source"] });
    expect(draft.employer).toEqual({ value: "Example Systems", sourceIds: ["company-source"] });
    expect(draft.responsibilities[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-responsibility-[a-f0-9]{32}$/u),
    });
    expect(draft.requirements[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-requirement-[a-f0-9]{32}$/u),
    });
    expect(draft.priorities[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-priority-[a-f0-9]{32}$/u),
    });
    expect(draft.candidateInstructions).toEqual({
      tone: { value: "Warm", sourceIds: ["candidate-source"] },
      applicationGoal: { value: "Emphasize platform leadership", sourceIds: ["candidate-source"] },
      forbiddenLanguage: [{ value: "Do not exaggerate", sourceIds: ["candidate-source"] }],
      focusAreas: [{ value: "Reliability outcomes", sourceIds: ["candidate-source"] }],
    });
    expect(draft.issues.map((entry) => entry.code)).toContain("partial-fetch");
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain(sensitiveRoot);
    expect(serialized).not.toContain(jobText);
    expect(serialized).not.toContain(companyText);
    expect(serialized).not.toContain(candidateText);
  });

  it("merges and validates structured candidate instructions without invoking extraction", async () => {
    const extract = vi.fn(async () => {
      throw new Error("extractor should not be called for candidate-only material");
    });
    const draft = await createOpportunityDraft(
      {
        id: "brief-candidate-instructions",
        createdAt: capturedAt,
        sources: [
          {
            id: "candidate-one",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "private candidate one",
            instructions: {
              tone: " Warm ",
              applicationGoal: "Apply for platform role",
              forbiddenLanguage: ["Do not exaggerate", "Be concise"],
              focusAreas: ["Leadership"],
            },
          },
          {
            id: "candidate-two",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "private candidate two",
            instructions: {
              tone: "Direct",
              applicationGoal: " apply   for PLATFORM role ",
              forbiddenLanguage: [" do not   exaggerate ", "Be concise"],
              focusAreas: [" leadership ", "Evidence"],
            },
          },
        ],
      },
      { extractor: { extract } },
    );

    expect(extract).not.toHaveBeenCalled();
    expect(draft.role).toBeNull();
    expect(draft.candidateInstructions).toEqual({
      tone: { value: "Warm", sourceIds: ["candidate-one"] },
      applicationGoal: {
        value: "Apply for platform role",
        sourceIds: ["candidate-one", "candidate-two"],
      },
      forbiddenLanguage: [
        { value: "Do not exaggerate", sourceIds: ["candidate-one", "candidate-two"] },
        { value: "Be concise", sourceIds: ["candidate-one", "candidate-two"] },
      ],
      focusAreas: [
        { value: "Leadership", sourceIds: ["candidate-one", "candidate-two"] },
        { value: "Evidence", sourceIds: ["candidate-two"] },
      ],
    });
    expect(draft.issues).toContainEqual(
      expect.objectContaining({
        code: "contradiction",
        status: "open",
        severity: "warning",
        message: "Candidate instructions contain conflicting tone guidance.",
        sourceIds: ["candidate-one", "candidate-two"],
      }),
    );
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain("private candidate one");
    expect(serialized).not.toContain("private candidate two");

    const invalidValue = "private invalid candidate tone";
    const invalid = await createOpportunityDraft({
      id: "brief-invalid-instructions",
      sources: [
        {
          id: "candidate-invalid",
          kind: "candidate-input",
          classification: "candidate-instruction",
          content: "safe content",
          instructions: { tone: `${invalidValue}\0` },
        },
      ],
    }).then(
      () => "did not reject",
      (error: unknown) => String(error),
    );
    expect(invalid).not.toContain(invalidValue);
  });

  it("preserves source order while retaining only safe provenance metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-opportunity-"));
    const filePath = join(root, "private-notes.md");
    const fileContent = "private local source text";
    const pastedContent = "private pasted source text";
    const candidateContent = "private candidate instruction";
    await writeFile(filePath, fileContent, "utf8");

    try {
      const draft = await createOpportunityDraft(
        {
          id: "brief-intake",
          createdAt: capturedAt,
          sources: [
            {
              id: "local-source",
              kind: "local-file",
              classification: "company-context",
              path: filePath,
            },
            {
              id: "pasted-source",
              kind: "pasted-content",
              classification: "social-announcement",
              content: pastedContent,
            },
            {
              id: "candidate-source",
              kind: "candidate-input",
              classification: "candidate-instruction",
              content: candidateContent,
            },
          ],
        },
        { now: () => capturedAt },
      );

      expect(draft.sources.map((source) => source.id)).toEqual([
        "local-source",
        "pasted-source",
        "candidate-source",
      ]);
      expect(draft.sources[0]).toMatchObject({
        classification: "company-context",
        status: "available",
        provenance: {
          kind: "local-file",
          displayName: basename(filePath),
          capturedAt,
          checksum: checksum(fileContent),
        },
      });
      expect(draft.sources[1]).toMatchObject({
        classification: "social-announcement",
        status: "available",
        provenance: { kind: "pasted-content", capturedAt, checksum: checksum(pastedContent) },
      });
      expect(draft.sources[2]).toMatchObject({
        classification: "candidate-instruction",
        status: "available",
        provenance: { kind: "candidate-input", capturedAt, checksum: checksum(candidateContent) },
      });
      expect(draft.role).toBeNull();
      expect(draft.employer).toBeNull();
      expect(draft.responsibilities).toEqual([]);
      expect(draft.requirements).toEqual([]);
      expect(draft.priorities).toEqual([]);
      expect(draft.candidateInstructions).toEqual({
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      });
      const serialized = JSON.stringify(draft);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain(fileContent);
      expect(serialized).not.toContain(pastedContent);
      expect(serialized).not.toContain(candidateContent);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a schema-safe display name for odd local filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-opportunity-"));
    const filePath = join(root, "~private-notes.md");
    await writeFile(filePath, "private local source text", "utf8");

    try {
      const draft = await createOpportunityDraft({
        id: "brief-display-name",
        createdAt: capturedAt,
        sources: [
          {
            id: "odd-file-source",
            kind: "local-file",
            classification: "company-context",
            path: filePath,
          },
        ],
      });

      expect(draft.sources[0]?.provenance).toMatchObject({
        kind: "local-file",
        displayName: "local-file",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires explicit URL approval before the existing safe fetch path", async () => {
    const fetched = vi.fn(
      async () =>
        new Response("private URL source", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const resolveHostname = vi.fn(async () => ["93.184.216.34"]);
    const ingestionOptions: UrlIngestionOptions = {
      fetcher: fetched,
      resolveHostname,
      now: () => new Date(capturedAt),
    };

    const denied = await createOpportunityDraft(
      {
        id: "brief-denied",
        createdAt: capturedAt,
        sources: [
          {
            id: "denied-url",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://example.com/role",
            approved: false,
          },
        ],
      },
      { urlIngestionOptions: ingestionOptions, now: () => capturedAt },
    );
    expect(fetched).not.toHaveBeenCalled();
    expect(denied.sources[0]).toMatchObject({
      status: "inaccessible",
      provenance: {
        kind: "approved-url",
        originalUrl: "https://example.com/role",
        contentChecksum: null,
      },
    });
    expect(denied.issues).toMatchObject([
      { code: "inaccessible-source", status: "open", severity: "error" },
    ]);

    const approved = await createOpportunityDraft(
      {
        id: "brief-approved",
        createdAt: capturedAt,
        sources: [
          {
            id: "approved-url",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://example.com/role",
            approved: true,
          },
        ],
      },
      { urlIngestionOptions: ingestionOptions, now: () => capturedAt },
    );
    expect(fetched).toHaveBeenCalledOnce();
    expect(approved.sources[0]).toMatchObject({
      status: "available",
      provenance: {
        kind: "approved-url",
        originalUrl: "https://example.com/role",
        capturedAt,
        contentChecksum: checksum("private URL source"),
      },
    });
    expect(JSON.stringify(approved)).not.toContain("private URL source");
  });

  it("uses observed URL fetch time instead of a caller timestamp hint", async () => {
    const observedAt = "2026-08-27T10:02:00.000Z";
    const ingestUrl = vi.fn(async (): Promise<IngestionResult> => {
      const source = normalizedSource("https://example.com/role", checksum("captured"));
      return {
        source: {
          ...source,
          source: {
            ...source.source,
            url: {
              originalUrl: "https://example.com/role",
              finalUrl: "https://example.com/role",
              fetchedAt: observedAt,
              kind: "generic",
            },
          },
        },
        issues: [],
      };
    });

    const draft = await createOpportunityDraft(
      {
        id: "brief-observed-time",
        createdAt: capturedAt,
        sources: [
          {
            id: "url-source",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://example.com/role",
            approved: true,
            capturedAt: "2026-08-27T10:01:00.000Z",
          },
        ],
      },
      { dependencies: { ingestUrl } },
    );

    expect(draft.sources[0]?.provenance).toMatchObject({ capturedAt: observedAt });
  });

  it("maps ingestion outcomes, keeps duplicate checksums visible, and sanitizes diagnostics", async () => {
    const sharedChecksum = "c".repeat(64);
    const ingestFile = vi.fn(async (source: IngestionSource): Promise<IngestionResult> => {
      if (source.path.endsWith("unsupported.pdf")) {
        return { source: null, issues: [issue("unsupported-media-type", source.path)] };
      }
      if (source.path.endsWith("failed.md")) {
        return { source: null, issues: [issue("read-failure", source.path)] };
      }
      if (source.path.endsWith("partial.md")) {
        return {
          source: normalizedSource(source.path, sharedChecksum, [
            issue("parse-failure", source.path),
          ]),
          issues: [],
        };
      }
      return availableResult(source.path, sharedChecksum);
    });
    const sensitiveRoot = "/private/opportunity/source";
    const draft = await createOpportunityDraft(
      {
        id: "brief-outcomes",
        createdAt: capturedAt,
        sources: [
          {
            id: "available-source",
            kind: "local-file",
            classification: "job-posting",
            path: `${sensitiveRoot}/available.md`,
          },
          {
            id: "partial-source",
            kind: "local-file",
            classification: "company-context",
            path: `${sensitiveRoot}/partial.md`,
          },
          {
            id: "unsupported-source",
            kind: "local-file",
            classification: "social-announcement",
            path: `${sensitiveRoot}/unsupported.pdf`,
          },
          {
            id: "failed-source",
            kind: "local-file",
            classification: "company-context",
            path: `${sensitiveRoot}/failed.md`,
          },
        ],
      },
      { dependencies: { ingestFile }, now: () => capturedAt },
    );

    expect(draft.sources.map((source) => source.status)).toEqual([
      "available",
      "partial",
      "unsupported",
      "failed",
    ]);
    expect(draft.issues.map((entry) => entry.code)).toEqual([
      "partial-fetch",
      "unsupported-source",
      "fetch-failure",
      "duplicate-source",
    ]);
    expect(draft.issues[0]).toMatchObject({ severity: "warning", sourceIds: ["partial-source"] });
    expect(draft.issues[1]).toMatchObject({ severity: "error", sourceIds: ["unsupported-source"] });
    expect(draft.issues[2]).toMatchObject({ severity: "error", sourceIds: ["failed-source"] });
    expect(draft.issues[3]).toMatchObject({
      code: "duplicate-source",
      severity: "warning",
      sourceIds: ["available-source", "partial-source"],
    });
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain(sensitiveRoot);
    expect(serialized).toContain(sharedChecksum);
    expect(serialized).not.toContain("private ingestion detail");
    expect(serialized).not.toContain("raw source text");
  });

  it("rejects invalid raw content and classification before invoking ingestion", async () => {
    const ingestFile = vi.fn(async (): Promise<IngestionResult> => ({ source: null, issues: [] }));
    const source = {
      id: "candidate-source",
      kind: "candidate-input" as const,
      classification: "job-posting" as const,
      content: "candidate instruction",
    };
    await expect(
      createOpportunityDraft({ sources: [source as never] }, { dependencies: { ingestFile } }),
    ).rejects.toThrow(/candidate-input.*candidate-instruction/i);
    await expect(
      createOpportunityDraft(
        {
          sources: [
            {
              id: "pasted-source",
              kind: "pasted-content",
              classification: "candidate-instruction",
              content: "not accepted as opportunity source",
            } as never,
          ],
        },
        { dependencies: { ingestFile } },
      ),
    ).rejects.toThrow(/opportunity classification/i);
    await expect(
      createOpportunityDraft({
        sources: [
          {
            id: "empty-source",
            kind: "pasted-content",
            classification: "job-posting",
            content: "   ",
          },
        ],
      }),
    ).rejects.toThrow(/must not be empty/i);
    await expect(
      createOpportunityDraft({
        sources: [
          {
            id: "nul-source",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "bad\0content",
          },
        ],
      }),
    ).rejects.toThrow(/invalid character/i);
    await expect(
      createOpportunityDraft({
        sources: [
          {
            id: "large-source",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "x".repeat(maximumOpportunityIntakeContentBytes + 1),
          },
        ],
      }),
    ).rejects.toThrow(/size limit/i);
    expect(ingestFile).not.toHaveBeenCalled();
  });

  it("rejects path-like and URL-like ids without echoing sensitive values", async () => {
    const sensitiveIds = [
      "/private/opportunity/source.md",
      "https://example.test/role?token=secret",
    ];
    for (const sensitiveId of sensitiveIds) {
      const sourceError = await createOpportunityDraft({
        sources: [
          {
            id: sensitiveId,
            kind: "pasted-content",
            classification: "job-posting",
            content: "safe content",
          },
        ],
      }).then(
        () => "did not reject",
        (error: unknown) => String(error),
      );
      expect(sourceError).toContain("safe bounded identifier");
      expect(sourceError).not.toContain(sensitiveId);
    }

    const briefId = "https://example.test/role?token=secret";
    const briefError = await createOpportunityDraft({
      id: briefId,
      sources: [
        {
          id: "safe-source",
          kind: "pasted-content",
          classification: "job-posting",
          content: "safe content",
        },
      ],
    }).then(
      () => "did not reject",
      (error: unknown) => String(error),
    );
    expect(briefError).toContain("safe bounded identifier");
    expect(briefError).not.toContain(briefId);

    const secretContent = "/private/opportunity/source?token=secret";
    const contentError = await createOpportunityDraft({
      sources: [
        {
          id: "safe-source",
          kind: "pasted-content",
          classification: "job-posting",
          content: `${secretContent}\0content`,
        },
      ],
    }).then(
      () => "did not reject",
      (error: unknown) => String(error),
    );
    expect(contentError).toContain("invalid character");
    expect(contentError).not.toContain(secretContent);
  });

  it("derives different brief ids for separate drafts that reuse source labels", async () => {
    const source = {
      id: "job-source",
      kind: "pasted-content" as const,
      classification: "job-posting" as const,
      content: "same source content",
    };
    const first = await createOpportunityDraft({ createdAt: capturedAt, sources: [source] });
    const second = await createOpportunityDraft({ createdAt: later, sources: [source] });

    expect(first.id).not.toBe(second.id);
  });

  it("creates immutable versioned edits and reviewed versions", async () => {
    const draft = await createOpportunityDraft({
      id: "brief-versions",
      createdAt: capturedAt,
      sources: [
        {
          id: "job-source",
          kind: "pasted-content",
          classification: "job-posting",
          content: "private job source",
        },
      ],
    });
    const role = { value: "Platform Engineer", sourceIds: ["job-source"] };
    const employer = { value: "Example Systems", sourceIds: ["job-source"] };
    const requirements = [
      {
        id: "requirement-1",
        text: "Production systems experience",
        priority: "critical" as const,
        sourceIds: ["job-source"],
      },
    ];
    const edited = editOpportunityDraft(draft, { role, employer, requirements }, later);
    expect(draft.version).toBe(1);
    expect(draft.role).toBeNull();
    expect(edited).toMatchObject({
      version: 2,
      priorVersion: 1,
      status: "draft",
      createdAt: later,
      reviewedAt: null,
      role,
      employer,
      requirements,
    });
    expect(edited.sources).toEqual(draft.sources);
    expect(Object.isFrozen(edited)).toBe(true);
    expect(Object.isFrozen(edited.role)).toBe(true);
    expect(Object.isFrozen(edited.requirements)).toBe(true);

    const reviewed = reviewOpportunityDraft(edited, latest);
    expect(reviewed).toMatchObject({
      version: 3,
      priorVersion: 2,
      status: "reviewed",
      createdAt: latest,
      reviewedAt: latest,
      role,
      employer,
      requirements,
    });
    expect(reviewed.sources).toEqual(draft.sources);
    expect(Object.isFrozen(reviewed)).toBe(true);
    expect(() => reviewOpportunityDraft(reviewed, "2026-08-27T10:07:00.000Z")).toThrow(
      /only a draft/i,
    );
    expect(() => editOpportunityDraft(edited, { unknown: true } as never, latest)).toThrow(
      /not editable/i,
    );
    expect(() => reviewOpportunityDraft(edited, capturedAt)).toThrow(/not precede/i);
    expect(() =>
      editOpportunityDraft(
        { ...draft, version: Number.MAX_SAFE_INTEGER, priorVersion: Number.MAX_SAFE_INTEGER - 1 },
        {},
        later,
      ),
    ).toThrow(/cannot be advanced safely/i);
  });
});
