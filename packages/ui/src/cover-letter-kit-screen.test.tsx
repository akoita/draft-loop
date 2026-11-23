import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { CoverLetterCheckPanel } from "./cover-letter-check-panel.js";
import { AnnotatedDraftComingSoon, CoverLetterHelpChoice } from "./cover-letter-help.js";
import { createCoverLetterKitCapabilities } from "./cover-letter-kit-capabilities.js";
import { normalizeCoverLetterKitLoadResult } from "./cover-letter-kit-contract.js";
import { fixtureKit } from "./cover-letter-kit-fixture.test-support.js";
import { CoverLetterKitPanel, type CoverLetterKitPanelProps } from "./cover-letter-kit-screen.js";

const props: CoverLetterKitPanelProps = {
  kit: fixtureKit,
  loaded: true,
  text: "",
  savedLetter: undefined,
  busy: false,
  problem: undefined,
  template: "modern",
  onPrepare: () => {},
  onText: () => {},
  onSave: () => {},
  onTemplate: () => {},
  onDownload: () => {},
};

const render = (extra: Partial<CoverLetterKitPanelProps> = {}) =>
  renderToStaticMarkup(<CoverLetterKitPanel {...props} {...extra} />);

describe("the help choice", () => {
  it("asks how much help, with the kit recommended and the annotated draft not ready", () => {
    const html = renderToStaticMarkup(<CoverLetterHelpChoice value="kit" onChange={() => {}} />);
    expect(html).toContain("<legend>How much help do you want?</legend>");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/checked="" value="kit"/);
    expect(html).toContain('Writing kit<span class="cover-letter-help-badge">Recommended');
    expect(html).toContain("Annotated draft<span");
    expect(html).toContain("Coming soon");
    expect(html).toContain("Full draft");
    expect(renderToStaticMarkup(<AnnotatedDraftComingSoon onUseKit={() => {}} />)).toContain(
      "Use the writing kit",
    );
  });
});

describe("the kit screen", () => {
  it("offers to prepare a kit before there is one, once the saved one is read", () => {
    const html = render({ kit: undefined });
    expect(html).toContain("Prepare my writing kit");
    expect(html).toContain("It holds notes, not sentences");
    expect(html).not.toContain("<textarea");
    expect(render({ kit: undefined, loaded: false })).toContain("disabled");
  });

  it("shows the kit beside an editor for the person's own letter", () => {
    const html = render({ text: "Dear team,\n\nMy own words." });
    const kitAt = html.indexOf("Requirements to answer");
    const editorAt = html.indexOf("<textarea");
    // The kit comes first, so a phone stacks it above the editor.
    expect(kitAt).toBeGreaterThan(-1);
    expect(editorAt).toBeGreaterThan(kitAt);
    expect(html).toContain("Builds SQL reporting for finance teams");
    expect(html).toContain("Cut month-end report time by 40% at Fictional Ltd");
    expect(html).toContain("Lead with the 40% faster month-end reports");
    expect(html).toContain("Answers requirement 1");
    expect(html).toContain("Uses: Led three analysts on the pricing review · Opened an office");
    expect(html).toContain("Published 2 Oct 2026");
    expect(html).toContain("<li>passionate about</li>");
    expect(html).toContain("5 words · Not saved yet");
    expect(html).toContain("Save my letter");
    expect(html).toContain("Download Word");
    expect(html).toContain("Download PDF");
    expect(html).not.toContain("AI draft");
  });

  it("saves only a changed letter and keeps the Check my letter slot under the editor", () => {
    const saved = {
      id: "amd_fixtureown01",
      createdAt: "2026-11-21T10:00:00.000Z",
      paragraphs: ["Dear team,", "My own words."],
    };
    const html = render({
      text: "Dear team,\n\nMy own words.",
      savedLetter: saved,
      checkPanel: <aside data-slot="check">Check</aside>,
    });
    expect(html).toMatch(/disabled="">Save my letter/);
    expect(html).toContain("Saved 21 Nov 2026");
    expect(html.indexOf('data-slot="check"')).toBeGreaterThan(html.indexOf("Download PDF"));
    expect(render({ text: "Changed.", savedLetter: saved })).toContain("Unsaved changes");
  });
});

describe("Check my letter under the editor", () => {
  it("checks the letter as the editor holds it, after the download buttons", () => {
    const text = "Dear team,\n\nMy own words.";
    const html = render({
      text,
      checkPanel: (
        <CoverLetterCheckPanel
          text={text}
          check={async () => {
            throw new Error("not called while rendering");
          }}
        />
      ),
    });
    const editorAt = html.indexOf("<textarea");
    const checkAt = html.indexOf("Check my letter</h3>");
    expect(checkAt).toBeGreaterThan(html.indexOf("Download PDF"));
    expect(checkAt).toBeGreaterThan(editorAt);
    expect(html.slice(checkAt)).toContain("sends this text once to Anthropic");
  });
});

describe("the kit commands", () => {
  it("are offered only when the host serves every one of them", () => {
    const bridge = (capabilities: readonly string[]): NativeBridge => ({
      capabilities: capabilities as NativeBridge["capabilities"],
      invoke: async () => ({ ok: true, value: {} }) as never,
    });
    expect(
      createCoverLetterKitCapabilities(createCapabilityPort(bridge(bridgeCapabilities)), (r) => {
        if (!r.ok) throw new Error(r.error.message);
        return r.value;
      }),
    ).toBeDefined();
    expect(
      createCoverLetterKitCapabilities(
        createCapabilityPort(bridge(["cover-letter-kit.load", "cover-letter-kit.prepare"])),
        (r) => (r.ok ? r.value : undefined) as never,
      ),
    ).toBeUndefined();
  });

  it("validate their inputs and refuse a letter with no paragraph", () => {
    const scope = { workspaceId: "owner", applicationId: "app_fixture0001" };
    expect(validateBridgeCommand({ type: "cover-letter-kit.load", input: scope })).toEqual({
      type: "cover-letter-kit.load",
      input: scope,
    });
    expect(() =>
      validateBridgeCommand({
        type: "cover-letter-kit.save-letter",
        input: { ...scope, basedOn: "amd_fixturekit01", paragraphs: [] },
      }),
    ).toThrow();
    expect(() =>
      validateBridgeCommand({
        type: "cover-letter-kit.download-letter",
        input: { ...scope, letterId: "amd_x", format: "odt", template: "modern" },
      }),
    ).toThrow();
  });

  it("read a kit and a letter back, and drop a malformed one", () => {
    expect(normalizeCoverLetterKitLoadResult({ kit: fixtureKit, letter: null })).toEqual({
      kit: fixtureKit,
      letter: null,
    });
    expect(
      normalizeCoverLetterKitLoadResult({ kit: { ...fixtureKit, extra: true }, letter: null }),
    ).toBeUndefined();
  });
});
