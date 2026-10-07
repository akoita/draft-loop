import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { announceRunEvidenceMode } from "./full-source-evidence.js";
import {
  declineLegacyEvidenceMigration,
  legacyEvidenceMigrationInvalidMessage,
  legacyEvidencePreflightLine,
  readLegacyEvidenceMigration,
} from "./legacy-evidence-migration.js";
import { defaultCandidateKnowledgeStoreRoot, defaultDraftLoopDataRoot } from "./user-data-root.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-legacy-migration-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("legacy evidence migration decision", () => {
  it("is undecided until the person declines, then stays declined", async () => {
    await expect(readLegacyEvidenceMigration(root)).resolves.toEqual({ declined: false });
    const declined = await declineLegacyEvidenceMigration(
      root,
      () => new Date("2026-10-07T10:00:00Z"),
    );
    expect(declined).toEqual({ declined: true, decidedAt: "2026-10-07T10:00:00.000Z" });
    await expect(readLegacyEvidenceMigration(root)).resolves.toEqual(declined);
    const saved = JSON.parse(
      await readFile(join(root, ".draft-loop", "legacy-evidence-migration.json"), "utf8"),
    ) as unknown;
    expect(saved).toEqual({
      schemaVersion: 1,
      decision: "declined",
      decidedAt: "2026-10-07T10:00:00.000Z",
    });
  });

  it("fails closed on an unrecognized file", async () => {
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    await writeFile(join(root, ".draft-loop", "legacy-evidence-migration.json"), "{}", "utf8");
    await expect(readLegacyEvidenceMigration(root)).rejects.toThrow(
      legacyEvidenceMigrationInvalidMessage,
    );
  });
});

describe("run preflight for the legacy evidence path", () => {
  it("says legacy workspace evidence is in use when no knowledge base is selected", async () => {
    const lines: string[] = [];
    const appendAuditEvent = vi.fn();
    await announceRunEvidenceMode({ appendAuditEvent }, undefined, "workspace", "run-1", (line) =>
      lines.push(line),
    );
    expect(lines).toEqual([legacyEvidencePreflightLine]);
    expect(legacyEvidencePreflightLine).toBe(
      "Career evidence: legacy workspace evidence (no knowledge base selected)",
    );
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });
});

describe("per-user DraftLoop data directory", () => {
  it("places the default candidate knowledge store beside the models on every platform", () => {
    expect(
      defaultCandidateKnowledgeStoreRoot({ env: {}, platform: "linux", homedir: "/home/u" }),
    ).toBe(join("/home/u", ".local", "share", "draft-loop", "candidate-knowledge"));
    expect(
      defaultCandidateKnowledgeStoreRoot({
        env: { LOCALAPPDATA: "/local" },
        platform: "win32",
        homedir: "/Users/u",
      }),
    ).toBe(join("/local", "DraftLoop", "candidate-knowledge"));
    expect(defaultDraftLoopDataRoot({ env: {}, platform: "darwin", homedir: "/Users/u" })).toBe(
      join("/Users/u", "Library", "Application Support", "DraftLoop"),
    );
  });
});
