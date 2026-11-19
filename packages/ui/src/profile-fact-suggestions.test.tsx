import { factSuggestionTarget } from "@draft-loop/domain/fact-suggestion";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CanonicalCandidateProfileFactResult, CapabilityPort } from "./bridge.js";
import { createFactSuggestionCapabilities } from "./fact-suggestions-capabilities.js";
import {
  type FactSuggestionView,
  normalizeFactSuggestionAcceptResult,
  normalizeFactSuggestionListResult,
  validateFactSuggestionAcceptInput,
  validateFactSuggestionRejectInput,
} from "./fact-suggestions-contract.js";
import {
  ProfileFactSuggestions,
  type ProfileFactSuggestionsState,
  ProfileSuggestionsNote,
  ReviewProfileSuggestionsPrompt,
} from "./profile-fact-suggestions.js";
import {
  acceptOutcomeMessage,
  editedChange,
  factSuggestionCard,
} from "./profile-fact-suggestions-model.js";

const provenance = {
  storeId: "store-1",
  knowledgeBaseId: "ckb-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};
const role: CanonicalCandidateProfileFactResult = {
  id: "fact-role",
  category: "role",
  field: "title",
  value: "Platform engineer",
  provenance: [provenance],
};

function suggestion(overrides: Partial<FactSuggestionView> = {}): FactSuggestionView {
  return {
    id: "fsg_correct001",
    profileId: "profile-1",
    change: { kind: "correct", value: "Staff platform engineer" },
    target: factSuggestionTarget(role as never),
    quote: "I was promoted to staff in March.",
    speaker: "candidate",
    origin: { kind: "review-edit", applicationId: "app-1", round: 2 },
    status: "pending",
    createdAt: "2026-11-19T10:00:00.000Z",
    ...overrides,
  };
}

function state(overrides: Partial<ProfileFactSuggestionsState> = {}): ProfileFactSuggestionsState {
  return {
    suggestions: [suggestion()],
    pending: 1,
    problem: undefined,
    message: undefined,
    busy: false,
    accept: () => undefined,
    reject: () => undefined,
    ...overrides,
  };
}

describe("suggested career profile updates", () => {
  it("shows a card with before and after, the quote, who said it and where", () => {
    const html = renderToStaticMarkup(
      <ProfileFactSuggestions state={state()} facts={[role]} locale="en" />,
    );
    expect(html).toContain("Suggested updates");
    expect(html).toContain("(1)");
    expect(html).toContain("Correct a fact");
    expect(html).toContain("Title: Platform engineer");
    expect(html).toContain("Title: Staff platform engineer");
    expect(html).toContain("I was promoted to staff in March.");
    expect(html).toContain("You said");
    expect(html).toContain("Your edit in review round 2 of an application, 19 Nov 2026");
    expect(html).toContain(">Accept<");
    expect(html).toContain(">Edit and accept<");
    expect(html).toContain(">Reject<");
  });

  it("shows nothing while there is nothing to decide", () => {
    expect(
      renderToStaticMarkup(
        <ProfileFactSuggestions state={state({ suggestions: [] })} facts={[role]} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ProfileFactSuggestions state={state({ suggestions: undefined })} facts={[role]} />,
      ),
    ).toBe("");
  });

  it("blocks decisions while the page has unsaved edits", () => {
    const html = renderToStaticMarkup(
      <ProfileFactSuggestions state={state()} facts={[role]} disabled />,
    );
    expect(html).toContain("Save or discard your edits first");
    expect(html.match(/disabled=""/gu)?.length).toBe(3);
  });

  it("offers editing only for a change that carries a value", () => {
    const retire = factSuggestionCard(
      suggestion({ change: { kind: "retire" }, speaker: "coach" }),
      [role],
    );
    expect(retire.editableValue).toBeUndefined();
    expect(retire.after).toBe("Removed from your profile");
    expect(retire.speaker).toBe("Your coach said");
    const add = factSuggestionCard(
      suggestion({
        change: { kind: "add", category: "skill", field: "language", value: "Rust" },
        target: undefined,
        origin: { kind: "agent" },
      }),
      [role],
    );
    expect(add.before).toBe("Not in your profile now");
    expect(add.after).toBe("Skill · Language: Rust");
    expect(add.editableValue).toBe("Rust");
  });

  it("says the fact is gone when the target changed", () => {
    const card = factSuggestionCard(suggestion(), [{ ...role, value: "Engineer" }]);
    expect(card.before).toBe("Not in your profile now");
  });

  it("sends an edit only when the person changed the value", () => {
    expect(editedChange(suggestion(), " Staff platform engineer ")).toBeUndefined();
    expect(editedChange(suggestion(), "")).toBeUndefined();
    expect(editedChange(suggestion(), "Principal engineer")).toEqual({
      kind: "correct",
      value: "Principal engineer",
    });
    expect(editedChange(suggestion({ change: { kind: "confirm" } }), "x")).toBeUndefined();
  });

  it("words the accept outcome by applied and stale counts", () => {
    expect(acceptOutcomeMessage(1, 0)).toBe("Accepted. Your profile now holds the change.");
    expect(acceptOutcomeMessage(0, 1)).toBe(
      "That fact changed first, so the suggestion no longer applies.",
    );
    expect(acceptOutcomeMessage(2, 1)).toContain("1 no longer applied");
  });

  it("validates commands and results at the bridge", () => {
    expect(
      validateFactSuggestionAcceptInput({
        workspaceId: "w",
        profileId: "p",
        items: [{ id: "fsg_correct001", edit: { kind: "correct", value: "x" } }],
      }),
    ).toEqual({
      workspaceId: "w",
      profileId: "p",
      items: [{ id: "fsg_correct001", edit: { kind: "correct", value: "x" } }],
    });
    expect(
      validateFactSuggestionAcceptInput({ workspaceId: "w", profileId: "p", items: [] }),
    ).toBeUndefined();
    expect(
      validateFactSuggestionAcceptInput({
        workspaceId: "w",
        profileId: "p",
        items: [{ id: "fsg_correct001", edit: { kind: "correct", value: 3 } }],
      }),
    ).toBeUndefined();
    expect(
      validateFactSuggestionRejectInput({ workspaceId: "w", profileId: "p", suggestionId: "x" }),
    ).toBeUndefined();
    expect(
      normalizeFactSuggestionListResult({
        workspaceId: "w",
        profileId: "profile-1",
        pending: 1,
        suggestions: [{ ...suggestion(), dedupeKey: "dropped" }],
      })?.suggestions[0],
    ).toEqual(suggestion());
    expect(
      normalizeFactSuggestionListResult({
        workspaceId: "w",
        profileId: "profile-1",
        pending: 1,
        suggestions: [{ ...suggestion(), speaker: "boss" }],
      }),
    ).toBeUndefined();
    expect(
      normalizeFactSuggestionAcceptResult({
        applied: ["fsg_correct001"],
        stale: [],
        profile: { version: 3, status: "reviewed" },
      }),
    ).toEqual({
      applied: ["fsg_correct001"],
      stale: [],
      profile: { version: 3, status: "reviewed" },
    });
    expect(
      normalizeFactSuggestionAcceptResult({ applied: [], stale: [], profile: { version: 0 } }),
    ).toBeUndefined();
  });

  it("offers the capabilities only when the host serves all three commands", async () => {
    const executed: unknown[] = [];
    const port = (capabilities: readonly string[]): CapabilityPort =>
      ({
        capabilities,
        hasCapability: (name: string) => capabilities.includes(name),
        execute: async (command: unknown) => {
          executed.push(command);
          return { ok: true, value: { suggestionId: "fsg_correct001" } };
        },
      }) as unknown as CapabilityPort;
    const unwrap = <Value,>(result: { ok: boolean; value?: Value }) => result.value as Value;
    expect(
      createFactSuggestionCapabilities(
        port(["fact-suggestions.list", "fact-suggestions.accept"]),
        unwrap as never,
      ),
    ).toBeUndefined();
    const capabilities = createFactSuggestionCapabilities(
      port(["fact-suggestions.list", "fact-suggestions.accept", "fact-suggestions.reject"]),
      unwrap as never,
    );
    await capabilities?.rejectFactSuggestion("w", "p", "fsg_correct001");
    expect(executed).toEqual([
      {
        type: "fact-suggestions.reject",
        input: { workspaceId: "w", profileId: "p", suggestionId: "fsg_correct001" },
      },
    ]);
  });
});

describe("Home's suggested update count", () => {
  it("says how many suggested updates wait", () => {
    const one = renderToStaticMarkup(
      <ProfileSuggestionsNote count={1} onAction={() => undefined} />,
    );
    expect(one).toContain("1 suggested profile update waits for you.");
    expect(
      renderToStaticMarkup(<ProfileSuggestionsNote count={3} onAction={() => undefined} />),
    ).toContain("3 suggested profile updates wait for you.");
  });
});

describe("the end-of-review prompt", () => {
  it("says how many facts changed and opens the profile", () => {
    const html = renderToStaticMarkup(
      <ReviewProfileSuggestionsPrompt pending={2} onOpenProfile={() => undefined} />,
    );
    expect(html).toContain("You changed 2 facts in this CV. Save them to your profile?");
    expect(html).toContain("Review suggested updates");
    expect(renderToStaticMarkup(<ReviewProfileSuggestionsPrompt pending={1} />)).toContain(
      "Open Career profile to review the suggested updates.",
    );
  });
});
