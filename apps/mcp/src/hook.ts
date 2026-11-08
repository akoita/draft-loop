import { readFile } from "node:fs/promises";

/**
 * The opt-in Claude Code Stop hook (#2025, #2555). When the turn just ended merged work and never
 * called `record_work`, it adds one advisory line; it never blocks the turn and never calls the
 * tool by itself. A push to a feature branch, or merging main into one, is not shipped work.
 */

export const stopHookAdvice =
  "This turn merged work without a DraftLoop record_work call. If it is a user-visible feature worth a CV line, record it with /log-work.";

/** A pull request merged from the shell, or a push straight to the default branch. */
const mergeCommand =
  /\bgh\s+pr\s+merge\b|\bgit\s+push\b[^\n;&|]*?(?:\s|:)(?:main|master)(?:\s|$|[;&|])/u;

/** A merge through a tool, such as the GitHub MCP server's `merge_pull_request`. */
const mergeTool = /merge_pull_request$/u;

interface TranscriptEntry {
  readonly type?: unknown;
  readonly message?: { readonly content?: unknown };
}

type Block = { readonly type?: unknown; readonly name?: unknown; readonly input?: unknown };

function blocks(entry: TranscriptEntry): readonly Block[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

/** A message the person typed, as opposed to a tool result the host sends back as a user turn. */
function isPersonTurn(entry: TranscriptEntry): boolean {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  return typeof content === "string" || blocks(entry).some((block) => block.type === "text");
}

/** Whether the last turn of a Claude Code transcript (JSON lines) merged without recording it. */
export function turnNeedsAdvice(transcript: string): boolean {
  const entries = transcript.split("\n").flatMap((line): TranscriptEntry[] => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as TranscriptEntry];
    } catch {
      return [];
    }
  });
  let start = 0;
  entries.forEach((entry, index) => {
    if (isPersonTurn(entry)) start = index;
  });
  const uses = entries
    .slice(start)
    .filter((entry) => entry.type === "assistant")
    .flatMap(blocks)
    .filter((block) => block.type === "tool_use");
  const shipped = uses.some((block) => {
    if (typeof block.name === "string" && mergeTool.test(block.name)) return true;
    const command = (block.input as { readonly command?: unknown } | undefined)?.command;
    return typeof command === "string" && mergeCommand.test(command);
  });
  const recorded = uses.some(
    (block) => typeof block.name === "string" && block.name.endsWith("record_work"),
  );
  return shipped && !recorded;
}

/** What the hook prints for its input: a JSON line with the advice, or nothing. */
export async function runStopHook(input: string): Promise<string> {
  let transcriptPath: unknown;
  let active: unknown;
  try {
    const parsed = JSON.parse(input) as { transcript_path?: unknown; stop_hook_active?: unknown };
    transcriptPath = parsed.transcript_path;
    active = parsed.stop_hook_active;
  } catch {
    return "";
  }
  if (active === true || typeof transcriptPath !== "string") return "";
  const transcript = await readFile(transcriptPath, "utf8").catch(() => "");
  return turnNeedsAdvice(transcript) ? JSON.stringify({ systemMessage: stopHookAdvice }) : "";
}
