import { formatDateTime } from "./locale-format.js";
import type { WritingPolicyVersionMetadata } from "./model.js";

/** One line of a version compared with the active policy. */
export interface PolicyDiffLine {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/**
 * The lines that differ between the active policy and an earlier version, by longest common
 * subsequence. "removed" lines are in the active policy only; "added" lines are in the version
 * only, so restoring it brings them back. Policies are at most 64 KiB, so the table stays small.
 */
export function diffPolicyLines(active: string, version: string): readonly PolicyDiffLine[] {
  const before = active.split("\n");
  const after = version.split("\n");
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        before[i] === after[j]
          ? (table[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * columns + j] ?? 0, table[i * columns + j + 1] ?? 0);
    }
  }
  const lines: PolicyDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const left = before[i];
    const right = after[j];
    if (left !== undefined && right !== undefined && left === right) {
      lines.push({ kind: "same", text: left });
      i += 1;
      j += 1;
    } else if (
      right !== undefined &&
      (left === undefined ||
        (table[i * columns + j + 1] ?? 0) >= (table[(i + 1) * columns + j] ?? 0))
    ) {
      lines.push({ kind: "added", text: right });
      j += 1;
    } else if (left !== undefined) {
      lines.push({ kind: "removed", text: left });
      i += 1;
    }
  }
  return lines;
}

export type PolicyVersionLoad =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly checksum: string; readonly content: string };

export interface WritingPolicyHistoryViewProps {
  /** The workspace's versions, oldest first, as the review state carries them. */
  readonly versions: readonly WritingPolicyVersionMetadata[];
  /** The version future runs use, or null when none is saved. */
  readonly activeChecksum: string | null;
  /** The active policy's text, to compare a version with. */
  readonly activeContent: string;
  readonly selectedChecksum: string | null;
  readonly selected: PolicyVersionLoad;
  readonly onSelect: (checksum: string) => void;
  readonly onRestore: (content: string) => void;
}

function formatCreatedAt(createdAt: string): string {
  return formatDateTime(createdAt) ?? createdAt;
}

/** The policy's saved versions, newest first; picking one shows its text and how it differs. */
export function WritingPolicyHistoryView({
  versions,
  activeChecksum,
  activeContent,
  selectedChecksum,
  selected,
  onSelect,
  onRestore,
}: WritingPolicyHistoryViewProps) {
  const newestFirst = [...versions].reverse();
  const isActive = selectedChecksum !== null && selectedChecksum === activeChecksum;
  const ready = selected.status === "ready" && selected.checksum === selectedChecksum;
  const lines = ready ? diffPolicyLines(activeContent, selected.content) : [];
  const changed = lines.filter((line) => line.kind !== "same").length;
  return (
    <div className="policy-history">
      <ul className="policy-history-list" aria-label="Writing policy versions">
        {newestFirst.map((entry) => (
          <li key={entry.checksum}>
            <button
              className={`policy-history-item${entry.checksum === selectedChecksum ? " policy-history-item-selected" : ""}`}
              type="button"
              aria-pressed={entry.checksum === selectedChecksum}
              onClick={() => onSelect(entry.checksum)}
            >
              <span className="policy-history-version">{entry.version}</span>
              <span className="policy-history-date">{formatCreatedAt(entry.createdAt)}</span>
              {entry.checksum === activeChecksum ? (
                <span className="policy-history-active">Active</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {selectedChecksum === null ? (
        <p className="setup-note">Pick a version to read its text.</p>
      ) : null}
      {selectedChecksum !== null && selected.status === "loading" ? (
        <p className="setup-note" role="status">
          Loading the version…
        </p>
      ) : null}
      {selectedChecksum !== null && selected.status === "failed" ? (
        <p className="setup-blocker" role="alert">
          {selected.message}
        </p>
      ) : null}
      {ready ? (
        <>
          <p className="setup-note" role="status">
            {isActive
              ? "This is the active version future runs use."
              : changed === 0
                ? "Same text as the active version."
                : "Marked lines differ from the active version: + only in this version, − only in the active one."}
          </p>
          <pre className="policy-history-text">
            {lines.map((line, index) => (
              <span
                // Lines repeat, so their position is their identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: a static rendering of the diff
                key={index}
                className={`policy-diff-line policy-diff-${line.kind}`}
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
          <div className="approval-actions">
            <button
              className="button button-outline"
              type="button"
              disabled={isActive || changed === 0}
              onClick={() => onRestore(selected.content)}
            >
              Restore as new version
            </button>
            <span className="setup-note">
              Restoring puts this text in the editor; saving makes it a new version. Nothing is
              deleted.
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
