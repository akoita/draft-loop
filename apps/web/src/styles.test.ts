import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const sharedStyles = readFileSync(
  new URL("../../../packages/ui/src/styles.css", import.meta.url),
  "utf8",
);

/** The declarations of one rule in a stylesheet, found by its exact selector. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sheet.slice(start, sheet.indexOf("}", start));
}

describe("the web stylesheet beside the shared screens", () => {
  it("spaces only the web's own submit buttons, not a shared dialog's", () => {
    expect(styles).toContain('form button[type="submit"]:where(:not(.button)) {');
    expect(styles).not.toMatch(/form button\[type="submit"\] \{/u);
  });

  it("leaves a shared screen's fieldsets to the shared styles, so hidden ones stay hidden", () => {
    // The footer hides its approval actions while a round runs; a bare `fieldset { display }`
    // here showed them under Stop review on the web (#1927).
    expect(styles).toContain("fieldset:where(:not(.shared-screens *)) {");
    expect(styles).not.toMatch(/^fieldset \{/mu);
  });

  it("keeps the header's language menu level with the buttons above the shared screens", () => {
    // Above the shared screens (sign-in mode, the sign-in screen) the web's form-label and
    // select rules reach the menu: a label margin pushed it below Sign out on staging 0.26.4.
    expect(styles).toContain("label:where(:not(.shared-screens *)) {");
    expect(rule(sharedStyles, ".screen-language-menu")).toContain("margin: 0;");
    const select = rule(sharedStyles, ".screen-language-menu select");
    expect(select).toContain("width: auto;");
    expect(select).toContain("min-height: 0;");
  });
});
