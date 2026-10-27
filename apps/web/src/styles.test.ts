import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("the web stylesheet beside the shared screens", () => {
  it("spaces only the web's own submit buttons, not a shared dialog's", () => {
    expect(styles).toContain('form button[type="submit"]:where(:not(.button)) {');
    expect(styles).not.toMatch(/form button\[type="submit"\] \{/u);
  });
});
