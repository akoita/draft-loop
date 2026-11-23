import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import {
  type AnnotatedDraftView,
  normalizeAnnotatedDraftLoadResult,
} from "./cover-letter-annotated-contract.js";
import {
  CoverLetterAnnotatedPanel,
  type CoverLetterAnnotatedPanelProps,
} from "./cover-letter-annotated-screen.js";
import { createCoverLetterKitCapabilities } from "./cover-letter-kit-capabilities.js";
import { fixtureKit } from "./cover-letter-kit-fixture.test-support.js";

// Invented content only.
const draft: AnnotatedDraftView = {
  id: "amd_fixturedraft",
  createdAt: "2026-11-22T09:00:00.000Z",
  model: "claude-sonnet-5-5",
  paragraphs: [
    {
      text: "I am passionate about the analyst role at your new office.",
      facts: [],
      employerFacts: [{ findingId: "e1", text: "Opened an office in a fictional city" }],
    },
    {
      text: "At Fictional Ltd I cut month-end report time by 40%.",
      facts: [{ factId: "f1", text: "Cut month-end report time by 40% at Fictional Ltd" }],
      employerFacts: [],
    },
    { text: "Thank you for reading; I would be glad to talk.", facts: [], employerFacts: [] },
  ],
};

const props: CoverLetterAnnotatedPanelProps = {
  draft,
  kit: fixtureKit,
  loaded: true,
  rewrites: ["", "", ""],
  savedLetter: undefined,
  busy: false,
  problem: undefined,
  template: "modern",
  onPrepare: () => {},
  onRewrite: () => {},
  onSave: () => {},
  onTemplate: () => {},
  onDownload: () => {},
};

const render = (extra: Partial<CoverLetterAnnotatedPanelProps> = {}) =>
  renderToStaticMarkup(<CoverLetterAnnotatedPanel {...props} {...extra} />);

describe("the annotated draft screen", () => {
  it("offers to draft one only on the person's press, once the saved one is read", () => {
    const html = render({ draft: undefined });
    expect(html).toContain("Prepare the annotated draft");
    expect(html).toContain("Only your version is saved and downloaded.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("I accept the risk");
    expect(render({ draft: undefined, loaded: false })).toContain("disabled");
  });

  it("shows each paragraph with its note above the person's box", () => {
    const html = render();
    expect(html).toContain("Drafted by claude-sonnet-5-5 on 22 Nov 2026.");
    const modelAt = html.indexOf("cut month-end report time");
    const boxAt = html.indexOf("Your paragraph 2");
    // The drafted paragraph comes first, so a phone stacks it above the person's box.
    expect(modelAt).toBeGreaterThan(-1);
    expect(boxAt).toBeGreaterThan(modelAt);
    expect(html.match(/<textarea/g)).toHaveLength(3);
    expect(html).toContain("Answers requirement 1: Builds SQL reporting for finance teams");
    expect(html).toContain("Opens the letter");
    expect(html).toContain("Closes the letter");
    expect(html).toContain("Cut month-end report time by 40% at Fictional Ltd");
    expect(html).toContain("Opened an office in a fictional city");
    expect(html).toContain("No fact cited: add nothing new here.");
    expect(html).toContain("Say this your way");
    expect(html).toContain('<mark class="cover-letter-annotated-generic">passionate about</mark>');
    expect(html).toContain("<dt>Generic phrases</dt><dd>“passionate about”</dd>");
    expect(html).toContain("A meter here shows how much of it is in your own words.");
    expect(html).toMatch(/disabled="">Save my letter/);
  });

  it("measures the person's own words and flags generic phrases in their box", () => {
    const html = render({
      rewrites: [
        "Your new office is close to home, and I am thrilled to apply.",
        "I cut month-end report time by 40% for my team.",
        "",
      ],
    });
    expect(html).toContain("In your own words: ");
    expect(html).toContain("<meter");
    expect(html).toContain("Generic in yours: “I am thrilled to”");
    expect(html).toContain("Not saved yet");
    expect(html).not.toMatch(/disabled="">Save my letter/);
  });

  it("keeps the Check my letter slot under the person's column", () => {
    const html = render({
      rewrites: ["Mine.", "", ""],
      checkPanel: <aside data-slot="check">Check</aside>,
    });
    expect(html.indexOf('data-slot="check"')).toBeGreaterThan(html.indexOf("Download PDF"));
  });
});

describe("the annotated draft commands", () => {
  const unwrap = <Value,>(result: { ok: boolean; value?: Value }) => result.value as Value;
  const bridge = (capabilities: readonly string[]): NativeBridge => ({
    capabilities: capabilities as NativeBridge["capabilities"],
    invoke: async () => ({ ok: true, value: {} }) as never,
  });

  it("are offered with the kit's only when the host serves them", () => {
    const all = createCoverLetterKitCapabilities(
      createCapabilityPort(bridge(bridgeCapabilities)),
      unwrap as never,
    );
    expect(all?.draft).toBeDefined();
    const kitOnly = createCoverLetterKitCapabilities(
      createCapabilityPort(
        bridge(bridgeCapabilities.filter((command) => !command.endsWith("-draft"))),
      ),
      unwrap as never,
    );
    expect(kitOnly).toBeDefined();
    expect(kitOnly?.draft).toBeUndefined();
  });

  it("validate their input and read a draft back, dropping a malformed one", () => {
    const scope = { workspaceId: "owner", applicationId: "app_fixture0001" };
    expect(validateBridgeCommand({ type: "cover-letter-kit.load-draft", input: scope })).toEqual({
      type: "cover-letter-kit.load-draft",
      input: scope,
    });
    expect(() =>
      validateBridgeCommand({ type: "cover-letter-kit.prepare-draft", input: { scope } }),
    ).toThrow();
    expect(normalizeAnnotatedDraftLoadResult({ draft })).toEqual({ draft });
    expect(normalizeAnnotatedDraftLoadResult({ draft: null })).toEqual({ draft: null });
    expect(
      normalizeAnnotatedDraftLoadResult({ draft: { ...draft, paragraphs: [] } }),
    ).toBeUndefined();
  });
});
