import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApplicationMaterialView,
  type ApplicationMaterialViewProps,
} from "./application-material.js";
import type { ApplicationMaterialDraft } from "./application-material-model.js";
import { CoverLetterRiskChoice } from "./cover-letter-risk.js";
import { isUneditedModelLetter } from "./cover-letter-risk-model.js";

// An invented letter.
const paragraph = {
  question: "",
  text: "At Example Ledger I moved forty pipelines to a new warehouse.",
  citations: [{ fact_id: "m", text: "achievement: moved 40 pipelines" }],
};
const letter: ApplicationMaterialDraft = {
  id: "amd_fixture0001",
  kind: "cover-letter",
  items: [paragraph],
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "application-material-v11",
  cost_usd: 0.03,
};

const props: ApplicationMaterialViewProps = {
  kind: "cover-letter",
  draft: undefined,
  versions: [],
  problem: undefined,
  busy: false,
  guidance: {},
  onGuidance: () => {},
  models: [],
  modelId: undefined,
  onModel: () => {},
  samples: undefined,
  samplesSaved: true,
  onSamples: () => {},
  onSaveSamples: () => {},
  collapsed: false,
  onToggle: () => {},
  onKind: () => {},
  onDraft: () => {},
  onDownload: () => {},
  onSelect: () => {},
  onDelete: () => {},
};

describe("the cover letter risk warning", () => {
  it("tells the candidate to write the letter themselves, on the letter tab only", () => {
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} />);
    expect(html).toContain("Write the letter yourself.");
    expect(html).toContain("AI-detection tools often spot a letter written entirely by AI");
    const guide = renderToStaticMarkup(
      <ApplicationMaterialView {...props} kind="interview-guide" />,
    );
    expect(guide).not.toContain("Write the letter yourself.");
  });

  it("labels a saved letter that is still the model's text", () => {
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} draft={letter} />);
    expect(html).toContain("AI draft: rewrite before sending");
    const edited = {
      ...letter,
      based_on: "amd_fixture0000",
      items: [{ ...paragraph, edited: true }],
    };
    const mine = renderToStaticMarkup(<ApplicationMaterialView {...props} draft={edited} />);
    expect(mine).not.toContain("AI draft: rewrite before sending");
  });

  it("asks the candidate to accept the risk before a full letter is drafted", () => {
    const html = renderToStaticMarkup(
      <CoverLetterRiskChoice busy={false} onAccept={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("This letter is written by AI.");
    expect(html).toContain("I accept the risk, draft it");
    expect(html).toContain("Not now");
  });
});

describe("which letters are still the model's", () => {
  it("counts drafts and critic revisions, not the candidate's edits or guides", () => {
    expect(isUneditedModelLetter(letter)).toBe(true);
    expect(
      isUneditedModelLetter({
        ...letter,
        based_on: "amd_fixture0000",
        critic_findings: [{ paragraph: 0, sentence: "x", reason: "y" }],
      }),
    ).toBe(true);
    expect(
      isUneditedModelLetter({
        ...letter,
        based_on: "amd_fixture0000",
        items: [{ ...paragraph, edited: true }],
      }),
    ).toBe(false);
    expect(isUneditedModelLetter({ ...letter, kind: "interview-guide" })).toBe(false);
  });
});
