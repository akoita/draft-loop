import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextSnapshot } from "@draft-loop/domain";
import { openSqliteStorage } from "@draft-loop/storage";
import { expect, it } from "vitest";
import { createChronologyRetrieval } from "./chronology-retrieval.js";

it("retains dated headings from pinned sources, bounds results, and rejects source drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronology-"));
  const storage = openSqliteStorage(join(root, "history.sqlite"));
  const createdAt = "2026-01-01T00:00:00.000Z";
  try {
    await storage.saveWorkspace({
      id: "workspace",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    });
    for (const id of ["approved", "unapproved"]) {
      await storage.saveEvidenceSource({
        id,
        workspaceId: "workspace",
        path: `/${id}.md`,
        mediaType: "text/markdown",
        checksum: id,
        createdAt,
      });
      for (const [ordinal, text] of [
        "## Transition - June 2005 to December 2006",
        "## Independent work - January 2007 to present",
        "TypeScript tools and reliable APIs",
      ].entries()) {
        await storage.saveEvidenceChunk({
          id: `${id}-${ordinal}`,
          sourceId: id,
          workspaceId: "workspace",
          ordinal,
          lineStart: ordinal + 1,
          lineEnd: ordinal + 1,
          checksum: `${id}-${ordinal}`,
          text,
          createdAt,
        });
      }
    }
    const context = {
      evidenceManifest: [{ id: "approved", checksum: "approved" }],
    } as unknown as ContextSnapshot;
    const port = createChronologyRetrieval(storage, context);
    const result = await port.queryEvidence("TypeScript", { workspaceId: "workspace", limit: 3 });
    expect(result.map((hit) => hit.id)).toEqual(["approved-0", "approved-1", "approved-2"]);
    expect(result[0]?.text).toBe("## Transition - June 2005 to December 2006");
    await expect(
      port.queryEvidence("TypeScript", { workspaceId: "workspace", limit: 1 }),
    ).rejects.toThrow(/cannot fit/);
    await expect(port.queryEvidence("TypeScript", { workspaceId: "other" })).rejects.toThrow(
      /unavailable/,
    );
    await expect(
      createChronologyRetrieval(storage, {
        evidenceManifest: [{ id: "approved", checksum: "changed" }],
      } as unknown as ContextSnapshot).queryEvidence("TypeScript", { workspaceId: "workspace" }),
    ).rejects.toThrow(/unavailable/);
    const two = await port.queryEvidence("TypeScript", { workspaceId: "workspace", limit: 2 });
    expect(two).toHaveLength(2);
    await storage.saveEvidenceChunk({
      id: "large",
      sourceId: "approved",
      workspaceId: "workspace",
      ordinal: 3,
      lineStart: 4,
      lineEnd: 4,
      checksum: "large",
      text: `## Long entry - June 2005 to December 2006 ${"x".repeat(131072)}`,
      createdAt,
    });
    await expect(port.queryEvidence("TypeScript", { workspaceId: "workspace" })).rejects.toThrow(
      /bounds/,
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
