import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeApplicationModelProfiles } from "./application-contract.js";
import { applicationPairLabel } from "./application-model-pair.js";
import { appliedPairName } from "./model-editor-summary.js";
import { parseModelProfileReferences, projectModelProfileSupport } from "./model-profile-bridge.js";
import { ModelProfilePicker } from "./model-profile-picker.js";
import {
  modelProfileEffortChoices,
  modelProfileReferencesEqual,
  modelProfileSelectionsEqual,
  withModelProfileLevels,
} from "./model-profile-picker-state.js";

const balanced: ModelProfileReferences = {
  author: { id: "economy-anthropic-author", version: 1 },
  critic: { id: "balanced-openai-critic", version: 1 },
};
const writerHigh: ModelProfileReferences = {
  ...balanced,
  author: { ...balanced.author, effort: "high" },
};

function renderPicker(applied: ModelProfileReferences): string {
  return renderToStaticMarkup(
    <ModelProfilePicker
      workspaceId="workspace-1"
      generation={1}
      applied={applied}
      support={{
        status: "ready",
        workspaceId: "workspace-1",
        generation: 1,
        result: projectModelProfileSupport("workspace-1", {
          anthropic: "api-key",
          openai: "api-key",
        }),
      }}
      disabled={false}
      onApply={async () => true}
      onRetrySupport={() => undefined}
      isContextCurrent={() => true}
    />,
  );
}

describe("chosen reasoning levels on the shared screens", () => {
  it("names a preset with its changed levels so the cards still show where it started", () => {
    expect(withModelProfileLevels("Balanced", writerHigh)).toBe("Balanced · writer high");
    expect(
      withModelProfileLevels("Balanced", {
        author: { ...balanced.author, effort: "xhigh" },
        critic: { ...balanced.critic, effort: "max" },
      }),
    ).toBe("Balanced · writer extra high, reviewer max");
    expect(withModelProfileLevels("Balanced", balanced)).toBe("Balanced");
    expect(appliedPairName(writerHigh)).toBe("Balanced · writer high");
    expect(applicationPairLabel(writerHigh)).toBe("Preset Balanced · writer high");
  });

  it("matches a preset whatever its levels, but tells a changed level apart", () => {
    expect(modelProfileReferencesEqual(writerHigh, balanced)).toBe(true);
    expect(modelProfileSelectionsEqual(writerHigh, balanced)).toBe(false);
    expect(modelProfileSelectionsEqual(writerHigh, { ...writerHigh })).toBe(true);
  });

  it("offers each profile's levels with its own level as the default", () => {
    expect(modelProfileEffortChoices(balanced.critic, "critic")).toEqual({
      defaultEffort: "low",
      levels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(modelProfileEffortChoices({ id: "unknown", version: 1 }, "critic")).toBeNull();
  });

  it("shows the chosen level in the picker and on the checked preset card", () => {
    const html = renderPicker(writerHigh);
    expect(html).toContain('aria-label="Writer reasoning"');
    expect(html).toContain('aria-label="Reviewer reasoning"');
    expect(html).toMatch(/<option value="high" selected="">High<\/option>/);
    expect(html).toContain("Low (default)</option>");
    expect(html).toContain('<span class="model-preset-card-note"> · writer high</span>');
    // A chosen level never hides the pair's list-rate scenario.
    expect(html).not.toContain("not in the registered catalog");
    expect(html).toContain("More reasoning usually costs more");
  });

  it("carries a level across the bridges and refuses one no profile can use", () => {
    expect(parseModelProfileReferences(writerHigh)).toEqual(writerHigh);
    expect(() =>
      parseModelProfileReferences({ ...balanced, critic: { ...balanced.critic, effort: "none" } }),
    ).toThrow();
    expect(normalizeApplicationModelProfiles(writerHigh)).toEqual(writerHigh);
    expect(
      normalizeApplicationModelProfiles({
        ...balanced,
        author: { ...balanced.author, effort: "provider-default" },
      }),
    ).toBeUndefined();
  });
});
