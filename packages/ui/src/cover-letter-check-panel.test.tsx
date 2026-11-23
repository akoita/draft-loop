import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  type BridgeCommand,
  type BridgeResult,
  createCapabilityPort,
  type NativeBridge,
} from "./bridge.js";
import { createCoverLetterCheckCapability } from "./cover-letter-check-capabilities.js";
import {
  type CoverLetterCheckView,
  normalizeCoverLetterCheckResult,
} from "./cover-letter-check-contract.js";
import {
  CoverLetterCheckPanel,
  CoverLetterCheckPanelView,
  type CoverLetterCheckState,
  coverLetterCheckBlock,
  runCoverLetterCheck,
} from "./cover-letter-check-panel.js";

// An invented letter and record.
const letter = "I led a team of 40 analysts.\n\nI am a highly motivated self-starter.";

const check: CoverLetterCheckView = {
  claims: {
    status: "checked",
    reason: null,
    checkedSentences: 2,
    findings: [
      {
        paragraph: 0,
        sentence: "I led a team of 40 analysts.",
        about: "candidate",
        reason: "number_not_in_fact",
        numbers: ["40"],
        closestFact: { factId: "f1", text: "role title: Data Analyst" },
      },
    ],
  },
  requirements: {
    source: "kit",
    total: 3,
    unanswered: [
      {
        requirementId: "r2",
        text: "Kubernetes operations",
        facts: [{ factId: "k", text: "skill tool: Kubernetes operations" }],
      },
    ],
  },
  wording: [
    {
      code: "empty_superlative",
      paragraph: 1,
      sentence: "I am a highly motivated self-starter.",
      match: "highly motivated",
    },
    { code: "word_count", paragraph: null, sentence: null, match: "13" },
  ],
};

const render = (state: CoverLetterCheckState, text = letter) =>
  renderToStaticMarkup(
    <CoverLetterCheckPanelView text={text} state={state} onCheck={() => undefined} />,
  );

describe("Check my letter panel", () => {
  it("says before the press that the letter goes to the model once and is not kept", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain("Check my letter</button>");
    expect(html).toContain("sends this text once to Anthropic&#x27;s model");
    expect(html).toContain("Redakloop does not keep the letter");
    expect(html).not.toContain("Claims your approved facts do not support");
  });

  it("shows the three groups with the closest fact, the kit's fact and the wording", () => {
    const html = render({ kind: "done", check });
    expect(html).toContain("Claims your approved facts do not support");
    expect(html).toContain("No approved fact states 40.");
    expect(html).toContain("Closest approved fact: role title: Data Analyst");
    expect(html).toContain("Requirements not answered yet");
    expect(html).toContain("From your writing kit&#x27;s 3 requirements.");
    expect(html).toContain("Approved fact that proves it: skill tool: Kubernetes operations");
    expect(html).toContain("Praise with no fact behind it");
    expect(html).toContain("Length: 13 words; aim for 250 to 350");
  });

  it("says why the claim check was skipped and still shows the other groups", () => {
    const html = render({
      kind: "done",
      check: {
        ...check,
        claims: {
          status: "skipped",
          reason: "model_calls_paused",
          checkedSentences: 0,
          findings: [],
        },
      },
    });
    expect(html).toContain("The claim check is paused for a short while.");
    expect(html).toContain("Requirements not answered yet");
  });

  it("disables the press for an empty or too long letter, and while checking", () => {
    expect(coverLetterCheckBlock("  ")).toBe("empty");
    expect(coverLetterCheckBlock("a".repeat(8_001))).toBe("too_long");
    expect(coverLetterCheckBlock(letter)).toBeUndefined();
    expect(render({ kind: "idle" }, "a".repeat(8_001))).toContain("longer than 8,000 characters");
    expect(render({ kind: "checking" })).toContain("disabled");
    expect(render({ kind: "checking" })).toContain("Checking…");
  });

  it("turns a failed check into a retry message", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const state = await runCoverLetterCheck(failing, letter);
    expect(state).toEqual({ kind: "failed" });
    expect(render(state)).toContain("The check did not finish.");
    expect(await runCoverLetterCheck(async () => check, letter)).toEqual({ kind: "done", check });
  });

  it("renders with a host check without calling it", () => {
    const host = vi.fn(async () => check);
    renderToStaticMarkup(<CoverLetterCheckPanel text={letter} check={host} />);
    expect(host).not.toHaveBeenCalled();
  });
});

describe("Check my letter capability", () => {
  it("is absent without the command and sends the letter through the port with it", async () => {
    const commands: BridgeCommand[] = [];
    const bridge = (capabilities: readonly string[]): NativeBridge => ({
      capabilities: capabilities as NativeBridge["capabilities"],
      invoke: async (command) => {
        commands.push(command);
        return { ok: true, value: { workspaceId: "w1", applicationId: "app_1", check } };
      },
    });
    const unwrap = <Value,>(result: BridgeResult<Value>): Value => {
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    const without = createCapabilityPort(bridge([]));
    expect(createCoverLetterCheckCapability(without, unwrap)).toBeUndefined();

    const port = createCapabilityPort(bridge(["application.check-cover-letter"]));
    const checkLetter = createCoverLetterCheckCapability(port, unwrap);
    expect(await checkLetter?.("w1", "app_1", letter)).toEqual(check);
    expect(commands).toEqual([
      {
        type: "application.check-cover-letter",
        input: { workspaceId: "w1", applicationId: "app_1", text: letter },
      },
    ]);
  });

  it("refuses a malformed answer", () => {
    expect(
      normalizeCoverLetterCheckResult({
        workspaceId: "w1",
        applicationId: "app_1",
        check: { ...check, wording: [{ code: "invented" }] },
      }),
    ).toBeUndefined();
  });
});
