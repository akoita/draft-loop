import { describe, expect, it } from "vitest";

import { ingestBytes } from "./index.js";

function pdf(content: string): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`,
  );
}

async function extract(content: string): Promise<string> {
  const result = await ingestBytes(
    { path: "synthetic-layout.pdf", mediaType: "application/pdf" },
    pdf(content),
  );
  expect(result.issues).toEqual([]);
  if (result.source === null) throw new Error("synthetic PDF text was not extracted");
  return result.source.text;
}

describe("PDF text fragment layout", () => {
  it("joins literal and hex text fragments across horizontal movement", async () => {
    const text = await extract(`BT\n/F1 12 Tf\n(Hel) Tj\n10.265625 0 Td\n<006C006F> Tj\nET`);

    expect(text).toBe("Hello");
  });

  it("preserves line boundaries from vertical Td, TD, and T* movement", async () => {
    const text = await extract(
      `BT\n(First line) Tj\n0 -12 Td\n(Second line) Tj\n0 0 TD\n(same line) Tj\nT*\n(Third line) Tj\nET`,
    );

    expect(text).toBe("First line\nSecond linesame line\nThird line");
  });

  it("joins same-baseline text matrices and separates vertically moved baselines", async () => {
    const text = await extract(
      `BT\n1 0 0 1 10 100 Tm\n(First) Tj\n1 0 0 1 20 100 Tm\n(continued) Tj\n1 0 0 1 20 80 Tm\n(Next line) Tj\nET`,
    );

    expect(text).toBe("Firstcontinued\nNext line");
  });

  it("retains a relative vertical move when comparing a later text matrix", async () => {
    const text = await extract(
      `BT\n1 0 0 1 10 100 Tm\n(First) Tj\n0 -12 Td\n(Second) Tj\n1 0 0 1 20 70 Tm\n(Third) Tj\nET`,
    );

    expect(text).toBe("First\nSecond\nThird");
  });

  it("recognizes a text matrix that matches the baseline after relative movement", async () => {
    const text = await extract(
      `BT\n1 0 0 1 10 100 Tm\n(First) Tj\n0 -12 Td\n(Second) Tj\n1 0 0 1 20 88 Tm\n(continued) Tj\nET`,
    );

    expect(text).toBe("First\nSecondcontinued");
  });

  it("separates text objects without treating operator-like string content as operators", async () => {
    const text = await extract(
      `BT\n(First) Tj\n/Span << /ActualText (ET 0 -12 Td) >> BDC\n(continued) Tj\nET\nBT\n(Second) Tj\nET`,
    );

    expect(text).toBe("Firstcontinued\nSecond");
  });
});
