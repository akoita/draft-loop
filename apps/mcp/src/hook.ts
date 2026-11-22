import { readFile } from "node:fs/promises";

/**
 * The Claude Code Stop hook (#2025, #2555, #3309). When the turn just ended merged work and never
 * looked at the work journal, it hands the work back to the agent once (`record`, the default), or
 * shows the person one advisory line (`advise`), or stays quiet (`off`). It never calls a tool by
 * itself, and a note still waits for the candidate's review. A push to a feature branch, or
 * merging main into one, is not shipped work.
 */

/** How the hook reacts to unrecorded merged work, from `REDAKLOOP_JOURNAL_HOOK`. */
export type JournalHookMode = "record" | "advise" | "off";

/** The mode `REDAKLOOP_JOURNAL_HOOK` names; anything else is the default, `record`. */
export function journalHookMode(value: string | undefined): JournalHookMode {
  const mode = value?.trim().toLowerCase();
  return mode === "advise" || mode === "off" ? mode : "record";
}

export const stopHookAdvice =
  "This turn merged work without a Redakloop record_work call. If it is a user-visible feature worth a CV line, record it with /log-work.";

/** What the agent reads when the hook hands the work back to it; it continues the turn once. */
export const stopHookRecordReason =
  "This turn merged work but did not check the Redakloop work journal. Call list_work for this project, then call record_work once for each user-visible feature, integration, migration or measured improvement that is not recorded yet, following draftloop://work-journal/guide. If nothing merged is notable, record nothing and say so in one line. The notes wait for the candidate's review.";

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
  // Calling list_work counts too: the agent looked and may have found nothing worth a note.
  const recorded = uses.some(
    (block) =>
      typeof block.name === "string" &&
      (block.name.endsWith("record_work") || block.name.endsWith("list_work")),
  );
  return shipped && !recorded;
}

/** What the hook prints for its input: a JSON line for the agent or the person, or nothing. */
export async function runStopHook(
  input: string,
  mode: JournalHookMode = "record",
): Promise<string> {
  if (mode === "off") return "";
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
  if (!turnNeedsAdvice(transcript)) return "";
  return mode === "advise"
    ? JSON.stringify({ systemMessage: stopHookAdvice })
    : JSON.stringify({ decision: "block", reason: stopHookRecordReason });
}
