import { describe, expect, it } from "vitest";

import { isDatedChronologyHeading } from "./chronology-evidence.js";

describe("dated chronology headings", () => {
  it("accepts a heading with a year, then to or a dash, then a year or an open end", () => {
    for (const heading of [
      "## Riverglass Tools - January 2018 to December 2020",
      "## Willowmere Systems - January 2021 to present",
      "### Nurse, 2019–2023",
      "# Analyst 2020 — Current",
      "\n## Teacher, 2015 to now",
      "###### Lead, 2016-2017",
    ]) {
      expect(isDatedChronologyHeading(heading), heading).toBe(true);
    }
  });

  it("refuses text that is not a dated heading", () => {
    for (const text of [
      "# Amara Okafor",
      "## Skills",
      "Worked 2018 to 2020 on the ward.",
      "####### Too deep, 2018 to 2020",
      "##No space 2018 to 2020",
      "## Joined in 2018",
      "## 2018 tomorrow 2020",
      "## Since 2018 to nowhere",
      "## Ward 2018 to 20201",
      "## Ward 2018\nto 2020",
    ]) {
      expect(isDatedChronologyHeading(text), text).toBe(false);
    }
  });

  it("stays linear on long runs of tabs and dashes", () => {
    const started = performance.now();
    isDatedChronologyHeading(`## 2018${"\t".repeat(100_000)}x`);
    isDatedChronologyHeading(`## 2018${"-".repeat(100_000)}x`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
