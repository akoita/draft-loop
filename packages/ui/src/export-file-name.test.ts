import { describe, expect, it } from "vitest";

import { exportFileName } from "./export-file-name.js";

describe("hosted export file name", () => {
  it("names the file by its day, id and format", () => {
    const createdAt = "2026-10-25T06:00:00.000Z";
    expect(exportFileName({ id: "export-1", createdAt, format: "docx" })).toBe(
      "cv-2026-10-25-export-1.docx",
    );
    expect(exportFileName({ id: "export-2", createdAt, format: "markdown" })).toBe(
      "cv-2026-10-25-export-2.md",
    );
    expect(exportFileName({ id: "export-3", createdAt, format: "unknown" })).toBe(
      "cv-2026-10-25-export-3.bin",
    );
  });
});
