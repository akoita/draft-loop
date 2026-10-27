import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** The body of the last `@media (max-width: 640px)` block, where the phone layout lives. */
function phoneRules(): string {
  const start = styles.lastIndexOf("@media (max-width: 640px) {");
  expect(start).toBeGreaterThan(-1);
  return styles.slice(start);
}

function ruleIn(css: string, selector: string): string {
  const start = css.indexOf(`  ${selector} {`);
  if (start === -1) throw new Error(`no phone rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("the review on a phone (#1833)", () => {
  const phone = phoneRules();

  it("stacks the rail above one full-width column", () => {
    expect(ruleIn(phone, ".app-frame")).toContain("flex-direction: column;");
    const rail = ruleIn(phone, ".side-rail");
    expect(rail).toContain("flex-direction: row;");
    expect(rail).toContain("width: 100%;");
    expect(rail).toContain("height: auto;");
  });

  it("gives the draft the width: narrow page and paper margins", () => {
    expect(ruleIn(phone, ".main-column")).toContain("padding-inline: var(--space-3);");
    expect(ruleIn(phone, ".sheet")).toContain(
      "padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5);",
    );
  });

  it("spans the docked footer, export included, across the window", () => {
    expect(ruleIn(phone, ".gate-action-bar")).toContain("left: 0;");
  });
});
