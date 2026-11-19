import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Fixes from the phone-width audit (#2937): tap targets (#2948), the start panel's buttons in dark
 * mode (#2949) and dialog gutters (#2950). A browser walk at 390px, light and dark, checked each
 * one; these checks keep the rules from being dropped.
 */
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const marker = "every control a finger taps gets at least 44px of hit area (#2948)";

function phoneBlock(): string {
  const comment = styles.indexOf(marker);
  expect(comment, "the phone tap-target block exists").toBeGreaterThanOrEqual(0);
  const start = styles.indexOf("@media (max-width: 640px) {", comment);
  expect(start).toBeGreaterThan(comment);
  return styles.slice(start);
}

describe("tap targets at phone width", () => {
  it("comes after every other rule, so it wins over the desktop sizes", () => {
    const after = styles.slice(styles.indexOf(marker));
    expect(after.match(/^\.[a-z]/gmu)).toBeNull();
  });

  it("gives buttons, selects and the small toolbar and card controls 44px of height", () => {
    const block = phoneBlock();
    const sizes = block.slice(0, block.indexOf("min-height: 44px;"));
    for (const selector of [
      ".button,",
      ".application-card-actions,",
      ".finding-actions",
      ".agent-setup button,",
      ".page-toolbar-lead .home-back,",
      ".workspace-title-edit-button,",
      "select {",
    ]) {
      expect(sizes).toContain(selector);
    }
  });

  it("makes icon-only buttons 44px wide", () => {
    expect(phoneBlock()).toMatch(
      /\.rail-button,\s*\.header-theme-toggle,\s*\.workspace-title-edit-button \{\s*min-width: 44px;/u,
    );
  });

  it("grows text-like actions without moving the layout", () => {
    expect(phoneBlock()).toMatch(
      /\.link-action,\s*\.career-flow-link \{\s*padding-block: 12px;\s*margin-block: -12px;/u,
    );
    expect(phoneBlock()).toMatch(/summary \{\s*padding-block: 12px;/u);
  });

  it("makes a segmented choice's options 44px tall", () => {
    expect(phoneBlock()).toMatch(/\.view-toggle-option \{\s*min-height: 44px;/u);
  });
});

describe("start panel buttons in dark mode (#2949)", () => {
  it("gives the blocked panel's actions a visible border and a solid fill", () => {
    const start = styles.indexOf(".start-checklist-blocked .start-check-action {");
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = styles.slice(start, styles.indexOf("}", start));
    expect(rule).toContain("border-color: var(--text-3);");
    expect(rule).toContain("background: var(--surface);");
  });
});

describe("dialogs at phone width (#2950)", () => {
  it("keeps a 16px gutter and 16px of padding, and wraps a segmented choice", () => {
    const block = phoneBlock();
    expect(block).toMatch(/\.modal-backdrop \{\s*padding: var\(--space-4\);/u);
    expect(block).toMatch(
      /\.boot-panel,\s*\.boot-panel\.model-editor-panel,\s*\.modal-card \{\s*padding-inline: var\(--space-4\);/u,
    );
    expect(block).toMatch(/\.boot-shell \{\s*padding-inline: 0;/u);
    expect(block).toMatch(/\.view-toggle \{\s*flex-wrap: wrap;\s*max-width: 100%;/u);
  });
});
