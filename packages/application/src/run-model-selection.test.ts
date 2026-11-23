import { describe, expect, it } from "vitest";

import { promptTemplateVersion } from "./author-adjudication.js";
import { newRunPromptVersion } from "./run-model-selection.js";

describe("new run prompt versions", () => {
  it("records the current version when no evaluation pin is set", () => {
    expect(newRunPromptVersion("author", {})).toBe(promptTemplateVersion("author"));
    expect(newRunPromptVersion("critic", { DRAFT_LOOP_EVAL_CRITIC_PROMPT_VERSION: " " })).toBe(
      promptTemplateVersion("critic"),
    );
  });

  it("starts on the previous version when an evaluation pin names it", () => {
    expect(
      newRunPromptVersion("author", { DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION: "cli-author-v21" }),
    ).toBe("cli-author-v21");
    expect(
      newRunPromptVersion("critic", { DRAFT_LOOP_EVAL_CRITIC_PROMPT_VERSION: "cli-critic-v11" }),
    ).toBe("cli-critic-v11");
  });

  it("refuses a version outside the pinnable pair", () => {
    expect(() =>
      newRunPromptVersion("author", { DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION: "cli-author-v9" }),
    ).toThrow(/DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION/u);
  });
});
