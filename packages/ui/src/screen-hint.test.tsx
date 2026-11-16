import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type DisplayMode, DisplayPreferenceProvider } from "./display-preference.js";
import { type HintedScreen, ScreenHint } from "./screen-hint.js";

function render(mode: DisplayMode | null, screen: HintedScreen, onOpenGuide?: () => void) {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider value={{ preference: { mode, guideHidden: false } }}>
      <ScreenHint screen={screen} onOpenGuide={onOpenGuide} />
    </DisplayPreferenceProvider>,
  );
}

describe("the hint on each guided screen", () => {
  it("says what to do on each screen, only for Guided", () => {
    const screens: HintedScreen[] = ["evidence", "profile", "new-application", "review"];
    const hints = screens.map((screen) => render("guided", screen));
    for (const hint of hints) expect(hint).toMatch(/^<p class="screen-hint"><span>.+<\/span>/);
    expect(new Set(hints).size).toBe(4);
    expect(hints.at(3)).toContain("Accept or reject each one, then select Approve artifact.");
    for (const mode of ["standard", "everything", null] as const) {
      expect(render(mode, "review")).toBe("");
    }
  });

  it("links back to Getting started where Home is one step away", () => {
    expect(render("guided", "evidence", () => undefined)).toContain(
      ">Back to Getting started</button>",
    );
    expect(render("guided", "evidence")).not.toContain("<button");
  });
});
