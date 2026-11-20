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

  it("lets the two-column screens grow under the shell's bars on a wide window", () => {
    // The shell's `> .shell-screens > * { flex: none }` rule carries a :has() and outranked the
    // screens' own `flex: 1 1 auto`; with size containment they shrank to nothing and every wide
    // window showed only the top bar on prod 0.26.18. The grow rule repeats the same :has().
    const shell = ".shell:has(> .shell-screens:not([hidden]) .app-frame)";
    const flat = styles.replace(/\s+/gu, " ");
    expect(flat).toContain(`${shell} > .shell-screens > *,`);
    expect(flat).toContain(
      `${shell} > .shell-screens .shared-screens:has(.app-frame) { flex: 1 1 auto;`,
    );
  });

  it("keeps sign-in mode's account bar on screen however the screens scroll", () => {
    // Sign-in mode puts the screens inside `.records-screens`, which the child-only grow rule
    // missed: the frame took a whole window under the account bar, so scrolling a button into
    // view scrolled the hidden-overflow shell and the bar vanished until a reload on prod (#3197).
    const shell = ".shell:has(> .shell-screens:not([hidden]) .app-frame)";
    const flat = styles.replace(/\s+/gu, " ");
    expect(flat).toContain(`${shell} > .shell-screens > .records-screens > * {`);
    expect(flat).not.toContain(`${shell} > .shell-screens > .shared-screens:has(.app-frame)`);
    expect(rule(styles.replace(/\n {4}/gu, "\n"), shell)).toContain("overflow: clip;");
  });
});
