import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  enclosingRepository,
  generateSanitizedPilotReport,
  PilotReportUserError,
  parsePilotCases,
} from "./pilot-report.js";

describe("consented pilot report runner", () => {
  it("refuses a case file that sits inside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-inside-repo-"));
    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(join(root, "private"), { recursive: true });
      const casePath = join(root, "private", "case.json");
      await writeFile(casePath, "[]", "utf8");

      await expect(
        generateSanitizedPilotReport({ casePath, outputPath: join(root, "report.md") }),
      ).rejects.toThrow(/inside the repository/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the repository root that encloses a path", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-enclosing-"));
    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(join(root, "nested", "deeper"), { recursive: true });

      const found = await enclosingRepository(join(root, "nested", "deeper", "case.json"));

      expect(found).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when no repository encloses the path", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-no-repo-"));
    try {
      expect(await enclosingRepository(join(root, "case.json"))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed case file without quoting its contents", async () => {
    expect(() => parsePilotCases("{ not json")).toThrow(PilotReportUserError);
    try {
      parsePilotCases('{"cases":"nope"}');
      expect.unreachable("expected a user error");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotReportUserError);
      expect((error as Error).message).not.toContain("nope");
    }
  });

  it("requires every case to carry a consent record", () => {
    expect(() => parsePilotCases('[{"id":"case-1"}]')).toThrow(/consent record/i);
  });

  it("accepts both a bare array and a cases object", () => {
    expect(parsePilotCases('[{"id":"a","consent":{}}]')).toHaveLength(1);
    expect(parsePilotCases('{"cases":[{"id":"a","consent":{}}]}')).toHaveLength(1);
  });

  it("rejects an empty case list", () => {
    expect(() => parsePilotCases("[]")).toThrow(/no cases/i);
  });

  it("surfaces the harness consent and sanitization gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-unsanitized-"));
    try {
      const casePath = join(root, "case.json");
      await writeFile(
        casePath,
        JSON.stringify([
          {
            id: "case-1",
            consent: {
              candidateId: "candidate-1",
              consentRecordedAt: "2026-08-17T00:00:00.000Z",
              reportingScope: "private-only",
              sanitizationCompleted: false,
            },
          },
        ]),
        "utf8",
      );

      await expect(
        generateSanitizedPilotReport({ casePath, outputPath: join(root, "report.md") }),
      ).rejects.toThrow(/consent|sanitization/i);

      await expect(stat(join(root, "report.md"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leave a partial report when the harness rejects the case", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-partial-"));
    try {
      const casePath = join(root, "case.json");
      const outputPath = join(root, "report.md");
      await writeFile(casePath, '[{"id":"case-1","consent":{}}]', "utf8");

      await expect(generateSanitizedPilotReport({ casePath, outputPath })).rejects.toThrow();

      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
