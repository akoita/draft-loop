import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WritingPolicyPanel } from "./policy.js";
import type { WritingPolicy } from "./policy-model.js";

const policy: WritingPolicy = {
  checksum: "c".repeat(64),
  version: "sha256:cccccccccccc",
  createdAt: "2026-10-23T08:00:00.000Z",
  priorChecksum: null,
  content: "Keep each bullet to one sentence.",
};

const render = (props: Partial<Parameters<typeof WritingPolicyPanel>[0]>) =>
  renderToStaticMarkup(
    <WritingPolicyPanel
      policy={policy}
      text={policy.content}
      problems={[]}
      busy={false}
      onChange={() => {}}
      onSave={() => {}}
      {...props}
    />,
  );

describe("writing policy panel", () => {
  it("shows the saved policy and its version, with nothing to save", () => {
    const html = render({});

    expect(html).toContain("Runs follow version sha256:cccccccccccc");
    expect(html).toContain(">Keep each bullet to one sentence.</textarea>");
    expect(html).toContain('disabled="">Saved</button>');
  });

  it("offers a new version once the text changes, and shows what to fix", () => {
    const html = render({
      text: "Use British spelling.",
      problems: ["The writing policy is larger than 64 KiB; shorten it."],
    });

    expect(html).toContain(">Save as a new version</button>");
    expect(html).toContain(
      'role="alert">The writing policy is larger than 64 KiB; shorten it.</p>',
    );
  });

  it("says when there is no policy yet", () => {
    expect(render({ policy: undefined, text: "" })).toContain("No writing policy yet");
  });
});
