import { describe, expect, it } from "vitest";

import { exportFileName } from "./export-file-name.js";

const createdAt = "2026-10-25T06:00:00.000Z";

describe("hosted export file name", () => {
  it("names the file after its application and day", () => {
    expect(
      exportFileName({
        id: "export-1",
        createdAt,
        format: "pdf",
        applicationName: "Acme - Platform engineer",
      }),
    ).toBe("Acme-Platform-engineer-CV-2026-10-25.pdf");
  });

  it("keeps only safe letters and digits, without accents", () => {
    expect(
      exportFileName({
        id: "export-1",
        createdAt,
        format: "docx",
        applicationName: "Société Générale / Ingénieur «backend»",
      }),
    ).toBe("Societe-Generale-Ingenieur-backend-CV-2026-10-25.docx");
  });

  it("cuts a long name at a word", () => {
    const name = exportFileName({
      id: "export-1",
      createdAt,
      format: "pdf",
      applicationName: `${"Platform ".repeat(12)}engineer`,
    });
    expect(name).toBe(`${Array(6).fill("Platform").join("-")}-CV-2026-10-25.pdf`);
    expect(name.length).toBeLessThanOrEqual(60 + "-CV-2026-10-25.pdf".length);
  });

  it("falls back to the day, id and format without a usable name", () => {
    expect(exportFileName({ id: "export-1", createdAt, format: "docx" })).toBe(
      "cv-2026-10-25-export-1.docx",
    );
    expect(
      exportFileName({ id: "export-2", createdAt, format: "markdown", applicationName: "«»" }),
    ).toBe("cv-2026-10-25-export-2.md");
    expect(
      exportFileName({ id: "export-3", createdAt, format: "unknown", applicationName: null }),
    ).toBe("cv-2026-10-25-export-3.bin");
  });
});
