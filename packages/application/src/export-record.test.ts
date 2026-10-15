import { describe, expect, it } from "vitest";

import { exportRecordId } from "./export-record.js";

describe("exportRecordId", () => {
  const checksum = "a".repeat(64);

  it("is stable for one export", () => {
    expect(exportRecordId("run-1", checksum, "/tmp/cv.md", "2026-10-15T10:00:00.000Z")).toBe(
      exportRecordId("run-1", checksum, "/tmp/cv.md", "2026-10-15T10:00:00.000Z"),
    );
  });

  it("differs when the same artifact is exported again, at another time or to another path", () => {
    const first = exportRecordId("run-1", checksum, "/tmp/cv.md", "2026-10-15T10:00:00.000Z");
    expect(first).toMatch(/^export-run-1-a{12}-[0-9a-f]{12}$/u);
    expect(exportRecordId("run-1", checksum, "/tmp/cv.md", "2026-10-15T11:00:00.000Z")).not.toBe(
      first,
    );
    expect(exportRecordId("run-1", checksum, "/tmp/moved.md", "2026-10-15T10:00:00.000Z")).not.toBe(
      first,
    );
  });
});
