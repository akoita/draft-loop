import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

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
});
