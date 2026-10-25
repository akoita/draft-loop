import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { maximumWritingPolicyContentBytes } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  WritingPolicyEditAction,
  WritingPolicyEditor,
  WritingPolicyEditorView,
  type WritingPolicyEditorViewProps,
  writingPolicyByteLength,
} from "./writing-policy-editor.js";

const policy = [
  "# Policy",
  "",
  "Tone: warm",
  "Verbosity: concise",
  "Page target: two-page",
  "",
  "- No em dashes.",
  "",
].join("\n");

function render(overrides: Partial<WritingPolicyEditorViewProps> = {}): string {
  return renderToStaticMarkup(
    <WritingPolicyEditorView
      load="ready"
      text={policy}
      isDefaultTemplate={false}
      savedVersion="sha256:aaaaaaaaaaaa"
      saving={false}
      dirty={false}
      onTextChange={() => undefined}
      onSave={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  );
}

function selectedOption(html: string, label: string): string | undefined {
  const field = html.split("<label").find((part) => part.includes(`<span>${label}</span>`));
  return field?.match(/<option value="([^"]*)" selected=""/u)?.[1];
}

describe("WritingPolicyEditorView", () => {
  it("shows a loading state without the form", () => {
    const html = render({ load: "loading", text: "" });
    expect(html).toContain("Loading the writing policy");
    expect(html).not.toContain("<form");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("explains a failed load and offers a retry", () => {
    const html = render({ load: "failed", loadMessage: "The writing policy could not be read." });
    expect(html).toContain("The writing policy could not be read.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("<form");
  });

  it("shows the current version, the full text and selectors that mirror it", () => {
    const html = render();
    expect(html).toContain("Editing version sha256:aaaaaaaaaaaa");
    expect(html).toContain("earlier versions stay in the history");
    expect(html).toContain("# Policy");
    expect(html).toContain("- No em dashes.");
    expect(selectedOption(html, "Tone")).toBe("warm");
    expect(selectedOption(html, "Verbosity")).toBe("concise");
    expect(selectedOption(html, "Page target")).toBe("two-page");
    expect(html).toContain('placeholder="en-GB"');
    expect(html).toContain('aria-label="Policy text"');
    expect(html).toContain("Save new version");
  });

  it("selects Not set for an absent directive and fills the spelling locale from the text", () => {
    const html = render({ text: "Spelling locale: en-GB\n- Be kind.\n" });
    expect(selectedOption(html, "Tone")).toBe("");
    expect(html).toContain('value="en-GB"');
  });

  it("reads directives the way the application does, regardless of case or list marker", () => {
    const html = render({ text: "- TONE: Direct\n* verbosity : DETAILED\n" });
    expect(selectedOption(html, "Tone")).toBe("direct");
    expect(selectedOption(html, "Verbosity")).toBe("detailed");
  });

  it("surfaces an unrecognised written value instead of hiding it", () => {
    const html = render({ text: "Tone: sarcastic\n" });
    expect(html).toContain("sarcastic (not a valid choice)");
    expect(selectedOption(html, "Tone")).toBe("sarcastic");
  });

  it("says the starting template is not saved yet and allows saving it unedited", () => {
    const html = render({ isDefaultTemplate: true, savedVersion: null });
    expect(html).toContain("This workspace has no writing policy yet");
    expect(html).toContain("starting template");
    expect(html).toContain("Save as first version");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Save as first version/u);
  });

  it("disables saving until the text changes", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Save new version/u);
    expect(render({ dirty: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Save new version/u);
  });

  it("shows the application's validation message inline and keeps the text", () => {
    const html = render({
      dirty: true,
      saveError: "The writing policy contains an invalid Tone directive.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The writing policy contains an invalid Tone directive.");
    expect(html).toContain("Tone: warm");
  });

  it("locks the form and says so while saving", () => {
    const html = render({ dirty: true, saving: true });
    expect(html).toContain("Saving…");
    expect(html).toMatch(/<textarea[^>]*disabled=""/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Saving…/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel/u);
  });

  it("blocks an oversized policy before it reaches the host", () => {
    const html = render({ dirty: true, text: "a".repeat(maximumWritingPolicyContentBytes + 1) });
    expect(html).toContain("The writing policy is too large; use at most 64 KiB.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save new version/u);
  });

  it("counts bytes, not characters", () => {
    expect(writingPolicyByteLength("€")).toBe(3);
  });

  it("asks for a second close before discarding unsaved changes", () => {
    const html = render({ dirty: true, discardArmed: true });
    expect(html).toContain("Discard changes");
    expect(html).toContain("You have unsaved changes");
  });
});

describe("WritingPolicyEditor", () => {
  it("starts in the loading state before the policy has been read", () => {
    const html = renderToStaticMarkup(
      <WritingPolicyEditor
        workspaceId="ws-1"
        readPolicy={async () => {
          throw new Error("not reached in a static render");
        }}
        savePolicy={async () => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Loading the writing policy");
    expect(html).not.toContain("<form");
  });
});

describe("Edit policy entry point", () => {
  const props = {
    workspaceId: "ws-1",
    readPolicy: async () => {
      throw new Error("unused");
    },
    savePolicy: async () => undefined,
  };

  it("renders the button, closed, and disables it while the workspace is busy", () => {
    const html = renderToStaticMarkup(<WritingPolicyEditAction {...props} />);
    expect(html).toContain("Edit policy");
    expect(html).not.toContain('role="dialog"');
    expect(renderToStaticMarkup(<WritingPolicyEditAction {...props} disabled />)).toMatch(
      /<button[^>]*disabled=""[^>]*>Edit policy/u,
    );
  });

  it("sits on the Writing policy setup card beside the file import", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "collecting" as const,
      runId: "pending",
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onSelectFiles={() => undefined}
        writingPolicyAction={<WritingPolicyEditAction {...props} />}
      />,
    );
    const card = html.slice(html.indexOf("<strong>Writing policy</strong>"));
    expect(card.indexOf("Edit policy")).toBeGreaterThan(-1);
    expect(card.indexOf("Edit policy")).toBeLessThan(card.indexOf("Import opportunity override"));
    expect(html).toMatch(/Choose policy file|Replace policy/u);
  });

  it("omits the button when the host cannot edit policies", () => {
    const state = { ...createFixtureReviewState(), state: "collecting" as const, runId: "pending" };
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={state} onAction={() => undefined} onSelectFiles={() => undefined} />,
    );
    expect(html).not.toContain("Edit policy");
  });
});
