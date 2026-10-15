import { describe, expect, it } from "vitest";

import {
  runSnapshotRef,
  runSnapshotTarget,
  runSnapshotTargetFromText,
} from "./run-snapshot-audit.js";

describe("runSnapshotTargetFromText", () => {
  const nasty = {
    payload: {
      id: "nested-id-must-not-win",
      checksum: "nested",
      text: 'quotes " and \\" and \\\\ and { [ braces ] } and "id":"fake"',
      list: [{ id: "x" }, "}", ["]"]],
    },
    id: "run-snapshot:run-1:abc",
    checksum: "c".repeat(64),
    sequence: 4,
    nothing: null,
    flag: true,
  };

  it("reads a legacy event the way the parsed payload is read", () => {
    const text = JSON.stringify(nasty);
    expect(runSnapshotTargetFromText(text)).toEqual(runSnapshotTarget(JSON.parse(text)));
    expect(runSnapshotTargetFromText(text)).toEqual({
      snapshotId: "run-snapshot:run-1:abc",
      checksum: "c".repeat(64),
    });
  });

  it("reads a reference event", () => {
    const reference = runSnapshotRef("run-snapshot:run-1:abc", "run-1", 4, "d".repeat(64));
    const text = JSON.stringify(reference, null, 2);
    expect(runSnapshotTargetFromText(text)).toEqual(runSnapshotTarget(reference));
  });

  it("returns undefined for text it cannot read, so the caller parses", () => {
    for (const text of ["", "[]", "{", '{"id":"a"', '{"id":"a" "checksum":"b"}', '{"id":"a"}']) {
      expect(runSnapshotTargetFromText(text)).toBeUndefined();
    }
  });
});
