import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { evidenceView } from "./home-model.js";
import { initialPageNavigation } from "./page-navigation.js";
import { startViewForFragment, workJournalFragment, workJournalPanelId } from "./shared-link.js";
import { WorkJournalPanel } from "./work-journal-panel.js";

describe("links into the shared screens", () => {
  it("opens Career evidence from the work journal link, with Back to Home", () => {
    const navigation = initialPageNavigation(startViewForFragment("#work-journal"));

    expect(navigation.view).toEqual(evidenceView);
    expect(navigation.history).toEqual([]);
    expect(navigation.visited).toEqual(["home", "evidence"]);
  });

  it("opens Home for any other fragment", () => {
    expect(startViewForFragment("")).toBeUndefined();
    expect(startViewForFragment("#career-evidence")).toBeUndefined();
    expect(initialPageNavigation(undefined).view.kind).toBe("home");
  });

  it("names the Work journal panel the fragment scrolls to", () => {
    const html = renderToStaticMarkup(
      <WorkJournalPanel
        intake
        notes={[]}
        problem={undefined}
        knowledgeBases={[]}
        onSetIntake={async () => undefined}
        onReview={async () => undefined}
      />,
    );

    expect(workJournalFragment).toBe(`#${workJournalPanelId}`);
    expect(html).toContain(`id="${workJournalPanelId}"`);
  });
});
