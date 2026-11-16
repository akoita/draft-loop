import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DisplayChoiceCard,
  type DisplayMode,
  DisplayPreferenceProvider,
} from "./display-preference.js";
import { FirstRunQuestion } from "./first-run-question.js";

function render(mode: DisplayMode | null, choose?: () => void) {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider
      value={{
        preference: { mode, guideHidden: false },
        ...(choose === undefined ? {} : { choose }),
      }}
    >
      <FirstRunQuestion />
    </DisplayPreferenceProvider>,
  );
}

describe("the first-run question on Home", () => {
  it("asks a person who never chose, with two answers and Decide later", () => {
    const html = render(null, () => undefined);
    expect(html).toContain("<h2>How would you like to start?</h2>");
    expect(html).toContain("<strong>Guide me step by step</strong>");
    expect(html).toContain("<strong>I know apps like this</strong>");
    expect(html).toContain("We show every screen and option, including advanced ones.");
    expect(html).toContain(">Decide later</button>");
    expect(html).toContain("You can change this any time in Workspace settings.");
  });

  it("never comes back once answered, and is absent when the host keeps no preference", () => {
    for (const mode of ["guided", "standard", "everything"] as const) {
      expect(render(mode, () => undefined)).toBe("");
    }
    expect(render(null)).toBe("");
  });
});

/** The buttons of a rendered card, found by walking its element tree. */
function buttons(node: ReactNode): ReactElement<{ onClick: () => void; children: ReactNode }>[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(buttons);
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  const own = element.type === "button" ? [element as never] : [];
  return [...own, ...buttons(element.props.children)];
}

describe("each answer", () => {
  it("saves guided, everything, or standard for Decide later", () => {
    const chosen: DisplayMode[] = [];
    const card = DisplayChoiceCard({
      heading: "How would you like to start?",
      current: null,
      quietLabel: "Decide later",
      wording: "first-run",
      onChoose: (mode) => chosen.push(mode),
    });
    for (const button of buttons(card)) button.props.onClick();
    expect(chosen).toEqual(["guided", "everything", "standard"]);
  });
});
