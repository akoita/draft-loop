export type DiffOpKind = "equal" | "insert" | "delete";

export interface DiffOp {
  readonly kind: DiffOpKind;
  readonly text: string;
}

/**
 * Token budget above which the quadratic alignment is skipped in favour of a whole-text
 * replacement, so a pathological draft cannot stall the caller.
 */
export const MAX_DIFF_TOKENS = 1500;

/** Alternating word and whitespace runs, so joining the tokens rebuilds the input verbatim. */
function tokenize(text: string): readonly string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

function wholeTextReplacement(previous: string, next: string): readonly DiffOp[] {
  const ops: DiffOp[] = [];
  if (previous !== "") ops.push({ kind: "delete", text: previous });
  if (next !== "") ops.push({ kind: "insert", text: next });
  return ops;
}

/**
 * Longest common subsequence length for every pair of token suffixes, laid out row-major
 * with one column per `next` start offset.
 */
function suffixLcsLengths(previous: readonly string[], next: readonly string[]): Int32Array {
  const width = next.length + 1;
  const lengths = new Int32Array((previous.length + 1) * width);
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        previous[i] === next[j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  return lengths;
}

function appendOp(ops: DiffOp[], kind: DiffOpKind, text: string): void {
  const last = ops[ops.length - 1];
  if (last !== undefined && last.kind === kind) {
    ops[ops.length - 1] = { kind, text: last.text + text };
    return;
  }
  ops.push({ kind, text });
}

/**
 * Aligns two drafts on word and whitespace runs so a revision can be rendered inline.
 * Concatenating the `equal` and `delete` texts reproduces `previous` exactly and the `equal`
 * and `insert` texts reproduce `next`; no two adjacent ops share a kind.
 */
export function diffWords(previous: string, next: string): readonly DiffOp[] {
  if (previous === next) return previous === "" ? [] : [{ kind: "equal", text: previous }];
  if (previous === "") return [{ kind: "insert", text: next }];
  if (next === "") return [{ kind: "delete", text: previous }];

  const previousTokens = tokenize(previous);
  const nextTokens = tokenize(next);
  if (previousTokens.length > MAX_DIFF_TOKENS || nextTokens.length > MAX_DIFF_TOKENS) {
    return wholeTextReplacement(previous, next);
  }

  const width = nextTokens.length + 1;
  const lengths = suffixLcsLengths(previousTokens, nextTokens);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < previousTokens.length && j < nextTokens.length) {
    if (previousTokens[i] === nextTokens[j]) {
      appendOp(ops, "equal", previousTokens[i] ?? "");
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) {
      appendOp(ops, "delete", previousTokens[i] ?? "");
      i += 1;
    } else {
      appendOp(ops, "insert", nextTokens[j] ?? "");
      j += 1;
    }
  }
  for (; i < previousTokens.length; i += 1) appendOp(ops, "delete", previousTokens[i] ?? "");
  for (; j < nextTokens.length; j += 1) appendOp(ops, "insert", nextTokens[j] ?? "");
  return ops;
}
