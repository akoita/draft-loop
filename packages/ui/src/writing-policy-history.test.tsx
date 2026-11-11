import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WritingPolicyVersionMetadata } from "./model.js";
import { WritingPolicyEditorView } from "./writing-policy-editor.js";
import {
  diffPolicyLines,
  WritingPolicyHistoryView,
  type WritingPolicyHistoryViewProps,
} from "./writing-policy-history.js";

const version = (char: string, createdAt: string): WritingPolicyVersionMetadata => ({
  checksum: char.repeat(64),
  version: `sha256:${char.repeat(12)}`,
  schemaVersion: 1,
  createdAt,
  priorChecksum: null,
});

const older = version("a", "2026-10-20T08:00:00.000Z");
const active = version("b", "2026-10-22T08:00:00.000Z");
const activeContent = "# Policy\n\nTone: warm\n- No em dashes.\n";
const olderContent = "# Policy\n\nTone: formal\n- No em dashes.\n";

function render(overrides: Partial<WritingPolicyHistoryViewProps> = {}): string {
  return renderToStaticMarkup(
    <WritingPolicyHistoryView
      versions={[older, active]}
      activeChecksum={active.checksum}
      activeContent={activeContent}
      selectedChecksum={null}
      selected={{ status: "idle" }}
      onSelect={() => undefined}
      onRestore={() => undefined}
      {...overrides}
    />,
  );
}

describe("diffPolicyLines", () => {
  it("marks lines only in the version as added and lines only in the active policy as removed", () => {
    expect(diffPolicyLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "x" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
    ]);
    expect(diffPolicyLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });
});

describe("WritingPolicyHistoryView", () => {
  it("lists versions newest first and marks the active one", () => {
    const html = render();
    expect(html.indexOf(active.version)).toBeLessThan(html.indexOf(older.version));
    expect(html).toContain("Active");
    expect(html).toContain("Pick a version to read its text.");
    expect(html).not.toContain("Restore as new version");
  });

  it("says how many runs suggested a version, and nothing for one written by hand (#2670)", () => {
    const suggested = { ...active, suggestedFromRunCount: 3 };
    expect(render({ versions: [older, suggested] })).toContain("Suggested from 3 runs");
    expect(render({ versions: [older, { ...active, suggestedFromRunCount: 1 }] })).toContain(
      "Suggested from 1 run<",
    );
    expect(render()).not.toContain("Suggested from");
  });

  it("shows an earlier version's text with its differences and offers to restore it", () => {
    const html = render({
      selectedChecksum: older.checksum,
      selected: { status: "ready", checksum: older.checksum, content: olderContent },
    });
    expect(html).toContain("+ Tone: formal");
    expect(html).toContain("− Tone: warm");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Restore as new version/u);
    expect(html).not.toMatch(/disabled=""[^>]*>Restore as new version/u);
  });

  it("does not offer to restore the active version", () => {
    const html = render({
      selectedChecksum: active.checksum,
      selected: { status: "ready", checksum: active.checksum, content: activeContent },
    });
    expect(html).toContain("This is the active version future runs use.");
    expect(html).toMatch(/disabled=""[^>]*>Restore as new version/u);
  });

  it("shows a failed read", () => {
    const html = render({
      selectedChecksum: older.checksum,
      selected: { status: "failed", message: "The version could not be read." },
    });
    expect(html).toContain("The version could not be read.");
  });
});

describe("WritingPolicyEditorView history tab", () => {
  const base = {
    load: "ready" as const,
    text: activeContent,
    isDefaultTemplate: false,
    savedVersion: active.version,
    saving: false,
    dirty: false,
    onTextChange: () => undefined,
    onSave: () => undefined,
    onClose: () => undefined,
  };
  const history = {
    versions: [older, active],
    activeChecksum: active.checksum,
    selectedChecksum: null,
    selected: { status: "idle" } as const,
    onSelect: () => undefined,
    onRestore: () => undefined,
    onOpenChange: () => undefined,
  };

  it("offers a History tab with the version count and keeps the form on Edit", () => {
    const html = renderToStaticMarkup(
      <WritingPolicyEditorView {...base} history={{ ...history, open: false }} />,
    );
    expect(html).toContain("History (2)");
    expect(html).toContain("<form");
  });

  it("shows the history instead of the form when the tab is open", () => {
    const html = renderToStaticMarkup(
      <WritingPolicyEditorView {...base} history={{ ...history, open: true }} />,
    );
    expect(html).toContain("Writing policy versions");
    expect(html).not.toContain("<form");
  });

  it("hides the tab when there is no history", () => {
    const html = renderToStaticMarkup(
      <WritingPolicyEditorView {...base} history={{ ...history, versions: [], open: false }} />,
    );
    expect(html).not.toContain("History (");
  });
});
