import { describe, expect, it } from "vitest";
import {
  maximumRecordArchiveEntries,
  recordArchiveManifestSchema,
  recordArchiveObjectPath,
  recordArchiveTableFileSchema,
  recordArchiveTablePath,
} from "./record-archive.js";

const sourceSha = "a".repeat(64);
const exportSha = "b".repeat(64);

const valid = {
  format: "draft-loop-record-archive",
  formatVersion: 1,
  createdAt: "2026-10-24T10:00:00.000Z",
  record: { workspaceId: "coach-north" },
  entries: [
    {
      kind: "table",
      path: "tables/workspace_settings.json",
      table: "workspace_settings",
      sha256: "c".repeat(64),
      sizeBytes: 812,
    },
    {
      kind: "table",
      path: "tables/consent_events.json",
      table: "consent_events",
      sha256: "d".repeat(64),
      sizeBytes: 230,
    },
    { kind: "object", path: `objects/${sourceSha}`, sha256: sourceSha, sizeBytes: 1_024 },
    { kind: "object", path: `objects/${exportSha}`, sha256: exportSha, sizeBytes: 0 },
  ],
};

function withEntries(entries: readonly unknown[]) {
  return { ...valid, entries };
}

describe("recordArchiveManifestSchema", () => {
  it("accepts a manifest of tables and objects", () => {
    const parsed = recordArchiveManifestSchema.parse(valid);
    expect(parsed.entries).toHaveLength(4);
    expect(recordArchiveTablePath("runs")).toBe("tables/runs.json");
    expect(recordArchiveObjectPath(sourceSha)).toBe(`objects/${sourceSha}`);
    expect(recordArchiveManifestSchema.safeParse(withEntries([])).success).toBe(true);
  });

  it("refuses another format, version, timestamp or record id", () => {
    for (const changed of [
      { format: "draft-loop-backup" },
      { formatVersion: 2 },
      { createdAt: "yesterday" },
      { record: { workspaceId: "../other" } },
      { record: { workspaceId: "coach-north", tenantId: "org-north" } },
      { extra: true },
    ]) {
      expect(recordArchiveManifestSchema.safeParse({ ...valid, ...changed }).success).toBe(false);
    }
  });

  it("refuses tables outside the format, such as members or idempotency keys", () => {
    for (const table of [
      "organisation_members",
      "candidate_record_assignments",
      "idempotency_keys",
    ]) {
      const entry = {
        kind: "table",
        path: `tables/${table}.json`,
        table,
        sha256: "e".repeat(64),
        sizeBytes: 2,
      };
      expect(recordArchiveManifestSchema.safeParse(withEntries([entry])).success).toBe(false);
    }
  });

  it("refuses paths that do not follow the layout or escape it", () => {
    const table = valid.entries[0];
    const object = valid.entries[2];
    for (const entry of [
      { ...table, path: "tables/runs.json" },
      { ...table, path: "../tables/workspace_settings.json" },
      { ...object, path: `/objects/${sourceSha}` },
      { ...object, path: `objects/${exportSha}` },
      { ...object, path: "manifest.json" },
    ]) {
      expect(recordArchiveManifestSchema.safeParse(withEntries([entry])).success).toBe(false);
    }
  });

  it("refuses bad checksums and sizes", () => {
    const object = valid.entries[2];
    const upper = "A".repeat(64);
    for (const entry of [
      { ...object, sha256: upper, path: `objects/${upper}` },
      { ...object, sha256: "a".repeat(63), path: `objects/${"a".repeat(63)}` },
      { ...object, sizeBytes: -1 },
      { ...object, sizeBytes: 1.5 },
      { ...object, mediaType: "application/pdf" },
    ]) {
      expect(recordArchiveManifestSchema.safeParse(withEntries([entry])).success).toBe(false);
    }
  });

  it("refuses a path listed twice and too many entries", () => {
    expect(
      recordArchiveManifestSchema.safeParse(withEntries([valid.entries[2], valid.entries[2]]))
        .success,
    ).toBe(false);
    const many = Array.from({ length: maximumRecordArchiveEntries + 1 }, (_, index) => {
      const sha = index.toString(16).padStart(64, "0");
      return { kind: "object", path: `objects/${sha}`, sha256: sha, sizeBytes: 1 };
    });
    expect(recordArchiveManifestSchema.safeParse(withEntries(many)).success).toBe(false);
  });
});

describe("recordArchiveTableFileSchema", () => {
  it("accepts rows as stored and refuses a tenant column or an unknown table", () => {
    const rows = [{ id: "consent-1", workspace_id: "workspace-1", kind: "material-storage" }];
    expect(recordArchiveTableFileSchema.safeParse({ table: "consent_events", rows }).success).toBe(
      true,
    );
    expect(
      recordArchiveTableFileSchema.safeParse({
        table: "consent_events",
        rows: [{ ...rows[0], tenant_id: "org-north" }],
      }).success,
    ).toBe(false);
    expect(recordArchiveTableFileSchema.safeParse({ table: "organisations", rows }).success).toBe(
      false,
    );
  });
});
