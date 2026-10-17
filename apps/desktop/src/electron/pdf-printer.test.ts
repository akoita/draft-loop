import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, session: {} }));

const { parsePrintedUnits } = await import("./pdf-printer.js");

describe("printed unit report", () => {
  it("accepts heading and body units with their text", () => {
    expect(
      parsePrintedUnits([
        { kind: "heading", text: "Experience" },
        { kind: "body", text: "Led the migration." },
      ]),
    ).toEqual([
      { kind: "heading", text: "Experience" },
      { kind: "body", text: "Led the migration." },
    ]);
  });

  it("refuses anything else, so the export fails rather than passing unchecked", () => {
    expect(() => parsePrintedUnits(undefined)).toThrow("did not report its text");
    expect(() => parsePrintedUnits([{ kind: "script", text: "x" }])).toThrow("unexpected shape");
    expect(() => parsePrintedUnits([{ kind: "body", text: 3 }])).toThrow("unexpected shape");
    expect(() => parsePrintedUnits([null])).toThrow("unexpected shape");
  });
});
