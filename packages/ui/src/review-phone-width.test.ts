import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The review screen, and Home and the application screen before it, at phone width (#1794). A
 * browser walk at 390px checks that no page scrolls sideways; these checks keep the rules that
 * walk relies on from being dropped.
 */
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function rule(selector: string, from = 0): string {
  const start = styles.indexOf(`${selector} {`, from);
  expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf("}", start));
}

describe("review screen at phone width", () => {
  it("gives the review column and the claim list tracks no wider than the column", () => {
    expect(rule(".review-column")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".claim-list")).toContain("grid-template-columns: minmax(0, 1fr);");
  });

  it("wraps the draft toolbar, claim headings and the traceability title below 760px", () => {
    const narrow = styles.indexOf("@media (max-width: 760px) {");
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(rule(".doc-toolbar-views", narrow)).toContain("flex-wrap: wrap;");
    expect(styles.slice(narrow)).toMatch(
      /\.claim-heading,\s*\.export-action \{\s*flex-direction: column;/u,
    );
    expect(styles.slice(narrow)).toMatch(
      /\.claim-heading-actions,\s*\.claims-disclosure-title \{\s*flex-wrap: wrap;/u,
    );
  });

  it("lets a model pair card shrink to a phone's column on the application screen", () => {
    expect(rule(".application-step-body")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".model-preset-card-grid")).toContain("minmax(min(18rem, 100%), 1fr)");
  });

  it("fits Home's application list and its heading to a phone's column", () => {
    const panels = ".home-applications,\n.home-settings";
    // The second rule for the two panels lays out their grid.
    expect(rule(panels, styles.indexOf(`${panels} {`) + 1)).toContain(
      "grid-template-columns: minmax(0, 1fr);",
    );
    expect(rule(".application-list")).toContain("minmax(min(340px, 100%), 1fr)");
    expect(rule(".home-card-head,\n.home-section-head")).toContain("flex-wrap: wrap;");
  });

  it("wraps the application screen's start button below 760px", () => {
    const narrow = styles.indexOf("@media (max-width: 760px) {");
    expect(rule(".onboarding-footer .button-primary", narrow)).toContain("white-space: normal;");
  });
});
