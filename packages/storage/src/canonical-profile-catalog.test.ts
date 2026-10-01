import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CanonicalCandidateProfile,
  CanonicalCandidateProfileInput,
} from "@draft-loop/schemas";
import { canonicalCandidateProfileSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  canonicalCandidateProfileCatalogLimitErrorMessage,
  maximumCanonicalCandidateProfileCatalogNameCount,
} from "./canonical-profile-catalog.js";
import { openSqliteStorage, type WorkspaceRecord } from "./index.js";

const createdAt = "2026-09-30T10:00:00.000Z";

function workspace(id: string): WorkspaceRecord {
  return { id, state: "collecting", createdAt, updatedAt: createdAt };
}

function profile(
  id: string,
  version = 1,
  parentVersion: number | null = null,
): CanonicalCandidateProfile {
  return canonicalCandidateProfileSchema.parse({
    id,
    version,
    parentVersion,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    facts: [],
    issues: [],
  } satisfies CanonicalCandidateProfileInput);
}

interface RawSqliteDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown;
  };
  readonly close: () => void;
}

interface RawSqliteConstructor {
  new (filename: string): RawSqliteDatabase;
}

function openRawDatabase(filename: string): RawSqliteDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  return new (Constructor as RawSqliteConstructor)(filename);
}

describe("workspace canonical candidate profile catalog storage", () => {
  it("lists deterministic complete histories for only the requested workspace across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-catalog-"));
    const filename = join(directory, "profiles.sqlite");
    const storage = openSqliteStorage(filename);
    const firstWorkspace = workspace("workspace-catalog-a");
    const secondWorkspace = workspace("workspace-catalog-b");
    try {
      await storage.saveWorkspace(firstWorkspace);
      await storage.saveWorkspace(secondWorkspace);
      await expect(
        storage.listCanonicalCandidateProfileVersions(firstWorkspace.id),
      ).resolves.toEqual([]);
      const zetaV1 = await storage.saveCanonicalCandidateProfile(
        firstWorkspace.id,
        profile("zeta"),
      );
      const alphaV1 = await storage.saveCanonicalCandidateProfile(
        firstWorkspace.id,
        profile("alpha"),
      );
      const zetaV2 = await storage.saveCanonicalCandidateProfile(
        firstWorkspace.id,
        profile("zeta", 2, 1),
      );
      await storage.saveCanonicalCandidateProfile(secondWorkspace.id, profile("foreign"));

      await expect(
        storage.listCanonicalCandidateProfileVersions(firstWorkspace.id, "zeta"),
      ).resolves.toEqual([zetaV1, zetaV2]);
      const catalog = await storage.listCanonicalCandidateProfileVersions(firstWorkspace.id);
      expect(catalog).toEqual([alphaV1, zetaV1, zetaV2]);
      expect(catalog.map((record) => [record.profile.id, record.profile.version])).toEqual([
        ["alpha", 1],
        ["zeta", 1],
        ["zeta", 2],
      ]);

      await storage.close();
      const reopened = openSqliteStorage(filename);
      try {
        await expect(
          reopened.listCanonicalCandidateProfileVersions(firstWorkspace.id),
        ).resolves.toEqual(catalog);
        await expect(
          reopened.listCanonicalCandidateProfileVersions(secondWorkspace.id),
        ).resolves.toMatchObject([{ profile: { id: "foreign", version: 1 } }]);
      } finally {
        await reopened.close();
      }
    } finally {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves explicit-name validation and rejects catalogs over the fixed bound", async () => {
    const storage = openSqliteStorage(":memory:");
    const owner = workspace("workspace-catalog-bound");
    try {
      await storage.saveWorkspace(owner);
      await expect(storage.listCanonicalCandidateProfileVersions(owner.id, "")).rejects.toThrow(
        "canonical candidate profileId",
      );
      await expect(storage.listCanonicalCandidateProfileVersions(owner.id, " ")).rejects.toThrow(
        "canonical candidate profileId",
      );
      for (let index = 0; index <= maximumCanonicalCandidateProfileCatalogNameCount; index += 1) {
        const id = `profile-${String(index).padStart(3, "0")}`;
        await storage.saveCanonicalCandidateProfile(owner.id, profile(id));
      }
      await expect(storage.listCanonicalCandidateProfileVersions(owner.id)).rejects.toThrow(
        canonicalCandidateProfileCatalogLimitErrorMessage,
      );
      await expect(
        storage.listCanonicalCandidateProfileVersions(owner.id, "profile-000"),
      ).resolves.toHaveLength(1);
    } finally {
      await storage.close();
    }
  });

  it("fails closed when a catalog history checksum or parent chain is corrupted", async () => {
    for (const corruption of ["checksum", "history"] as const) {
      const directory = await mkdtemp(join(tmpdir(), `draft-loop-profile-catalog-${corruption}-`));
      const filename = join(directory, "profiles.sqlite");
      const storage = openSqliteStorage(filename);
      const owner = workspace(`workspace-${corruption}`);
      try {
        await storage.saveWorkspace(owner);
        await storage.saveCanonicalCandidateProfile(owner.id, profile("broken-history"));
        await storage.saveCanonicalCandidateProfile(owner.id, profile("broken-history", 2, 1));
        await storage.close();

        const raw = openRawDatabase(filename);
        if (corruption === "checksum") {
          raw.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_update");
          raw
            .prepare(
              "UPDATE canonical_candidate_profile_versions SET payload_checksum = ? WHERE workspace_id = ? AND profile_id = ? AND version = 1",
            )
            .run("0".repeat(64), owner.id, "broken-history");
        } else {
          raw.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_delete");
          raw.exec("PRAGMA foreign_keys = OFF");
          raw
            .prepare(
              "DELETE FROM canonical_candidate_profile_versions WHERE workspace_id = ? AND profile_id = ? AND version = 1",
            )
            .run(owner.id, "broken-history");
        }
        raw.close();

        const reopened = openSqliteStorage(filename);
        try {
          await expect(reopened.listCanonicalCandidateProfileVersions(owner.id)).rejects.toThrow(
            corruption === "checksum" ? /checksum/iu : /contiguous append-only chain/iu,
          );
        } finally {
          await reopened.close();
        }
      } finally {
        await storage.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
});
