import { describe, expect, it } from "vitest";

import { createAuthorEvidenceAliases } from "./author-evidence-aliases.js";

const first = "a".repeat(64);
const second = "b".repeat(64);

describe("author evidence aliases", () => {
  it("replaces chunk IDs in values and keys and maps proposal citations back", () => {
    const aliases = createAuthorEvidenceAliases([first, second, first]);

    expect(aliases.aliases).toEqual(["E1", "E2"]);
    expect(
      aliases.toModel({
        retrievedEvidence: [{ id: first, checksum: "c".repeat(64), text: first }],
        guide: { [second]: ["2021"] },
        plan: [{ evidenceChunkId: second }],
      }),
    ).toEqual({
      retrievedEvidence: [{ id: "E1", checksum: "c".repeat(64), text: "E1" }],
      guide: { E2: ["2021"] },
      plan: [{ evidenceChunkId: "E2" }],
    });
    expect(
      aliases.fromModel({
        sections: [
          {
            title: "E1",
            blocks: [
              { text: "E2", claims: [{ text: "E1", evidenceChunkIds: ["E2", "E1", "E9"] }] },
            ],
          },
        ],
      }),
    ).toEqual({
      sections: [
        {
          title: "E1",
          blocks: [
            { text: "E2", claims: [{ text: "E1", evidenceChunkIds: [second, first, "E9"] }] },
          ],
        },
      ],
    });
  });

  it("keeps real IDs when one already looks like an alias", () => {
    const aliases = createAuthorEvidenceAliases(["E2", first]);

    expect(aliases.aliases).toEqual(["E2", first]);
    expect(aliases.toModel({ id: first })).toEqual({ id: first });
    expect(aliases.fromModel({ evidenceChunkIds: ["E1", "E2"] })).toEqual({
      evidenceChunkIds: ["E1", "E2"],
    });
  });
});
