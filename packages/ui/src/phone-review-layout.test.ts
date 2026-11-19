import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** The bodies of every `@media (max-width: 640px)` block, where the phone layout lives. */
function phoneRules(): string {
  const opening = "@media (max-width: 640px) {";
  const blocks: string[] = [];
  for (
    let start = styles.indexOf(opening);
    start !== -1;
    start = styles.indexOf(opening, start + 1)
  ) {
    const end = styles.indexOf("\n}\n", start);
    blocks.push(styles.slice(start, end === -1 ? undefined : end));
  }
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.join("\n");
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

describe("the docked export footer on a phone-narrow screen", () => {
  function containerRules(query: string): string {
    const start = styles.indexOf(`@container gate-bar (${query}) {`);
    expect(start).toBeGreaterThan(-1);
    return styles.slice(start, styles.indexOf("\n}\n", start));
  }

  it("measures its own width once docked", () => {
    const docked = styles.slice(styles.indexOf("@media (max-width: 1024px) {"));
    expect(ruleIn(docked, ".gate-action-bar")).toContain("container: gate-bar / inline-size;");
  });

  it("folds to its one-line status only when docked", () => {
    // The two-column desk shows the whole footer, so the toggle exists only docked.
    expect(styles).toMatch(/\n\.gate-bar-toggle \{\n {2}display: none;\n\}/u);
    const docked = styles.slice(styles.indexOf("@media (max-width: 1024px) {"));
    expect(ruleIn(docked, ".gate-action-bar .gate-bar-toggle")).toContain("display: inline-flex;");
    expect(ruleIn(docked, ".gate-action-bar[data-collapsed] .gate-bar-body")).toContain(
      "display: none;",
    );
    expect(ruleIn(docked, ".gate-action-bar[data-collapsed] .gate-blocker")).toContain(
      "text-overflow: ellipsis;",
    );
  });

  it("puts the three templates in one row and keeps their descriptions for screen readers", () => {
    const compact = containerRules("inline-size < 36rem");
    expect(ruleIn(compact, ".gate-action-bar .export-templates")).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    const description = ruleIn(compact, ".gate-action-bar .export-template-text span");
    expect(description).toContain("clip: rect(0, 0, 0, 0);");
    expect(description).not.toContain("display: none");
  });

  it("keeps the export controls on one line with touch-size targets", () => {
    const compact = containerRules("inline-size < 36rem");
    expect(ruleIn(compact, ".gate-action-bar .export-action")).toContain("flex-direction: row;");
    expect(ruleIn(compact, ".gate-action-bar .export-action .button")).toContain(
      "min-height: 44px;",
    );
    expect(ruleIn(compact, ".gate-action-bar .export-template-option")).toContain(
      "min-height: 44px;",
    );
  });
});
