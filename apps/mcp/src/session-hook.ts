import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import type { WorkJournalNoteListItem } from "@draft-loop/schemas/work-journal";

import type { JournalHookMode } from "./hook.js";

/**
 * The Claude Code SessionStart hook (#3310). When a session opens in a git repository, it counts
 * the changes merged on the default branch since the newest work journal note for that project,
 * and tells the agent to offer `/redakloop:log-work` when some are missing. That catches work
 * merged elsewhere: in a cloud session, on GitHub or from another agent. It records nothing and
 * never fails the session.
 */

/** What the hook needs from the machine and the server, so tests can stand in for both. */
export interface SessionStartDependencies {
  /** Runs git in `cwd` and returns its trimmed standard output; throws when git fails. */
  readonly git: (cwd: string, args: readonly string[]) => Promise<string>;
  /** The notes the server holds for one project, newest first or in any order. */
  readonly listWork: (project: string) => Promise<readonly WorkJournalNoteListItem[]>;
  readonly now?: () => Date;
}

/** Without a note for the project, the hook looks this far back: the `/log-work` default. */
const defaultLookbackDays = 14;
/** It never looks further back than this, so an old note does not flood the session. */
const maximumLookbackDays = 30;
/** Session starts that open a fresh conversation; a resume or a compaction stays quiet. */
const freshSources = new Set(["startup", "clear"]);

const execFileAsync = promisify(execFile);

/** Git through the system binary, with a short timeout so a slow disk never holds the session. */
export async function systemGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: 5_000 });
  return stdout.trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The default branch as git names it locally: `origin/HEAD`'s target, else `main` or `master`. */
async function defaultBranch(
  git: SessionStartDependencies["git"],
  cwd: string,
): Promise<string | undefined> {
  const remoteHead = await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(
    () => "",
  );
  if (remoteHead !== "") return remoteHead;
  for (const branch of ["main", "master"]) {
    const found = await git(cwd, ["rev-parse", "--verify", "--quiet", branch]).then(
      () => true,
      () => false,
    );
    if (found) return branch;
  }
  return undefined;
}

/** The day to count merges from: the newest note's day for this project, within the bounds. */
export function catchUpSince(
  project: string,
  notes: readonly WorkJournalNoteListItem[],
  now: Date,
): string {
  const wanted = project.toLowerCase();
  const newest = notes
    .filter((note) => note.project.toLowerCase() === wanted)
    .map((note) => note.created_at)
    .sort()
    .at(-1);
  const floor = daysBefore(now, maximumLookbackDays);
  const since = newest === undefined ? daysBefore(now, defaultLookbackDays) : new Date(newest);
  return isoDate(Number.isNaN(since.getTime()) || since < floor ? floor : since);
}

/** The line the agent reads when merged changes are missing from the journal. */
export function catchUpContext(count: number, branch: string, project: string, since: string) {
  const changes = count === 1 ? "1 change was" : `${count} changes were`;
  return `${changes} merged on ${branch} in ${project} since ${since}, after the newest Redakloop work journal note for this project. When it fits, offer the candidate to run /redakloop:log-work since ${since}; it records only notable work, and each note waits for their review. Record nothing unless they agree.`;
}

/** The line the person sees instead, in advise mode. */
export function catchUpAdvice(count: number, branch: string, since: string): string {
  const changes = count === 1 ? "1 change" : `${count} changes`;
  return `${changes} merged on ${branch} since ${since} may be missing from your Redakloop work journal: run /redakloop:log-work since ${since} to record the notable ones.`;
}

/** What the hook prints for its input: a JSON line for the agent or the person, or nothing. */
export async function runSessionStartHook(
  input: string,
  mode: JournalHookMode,
  dependencies: SessionStartDependencies,
): Promise<string> {
  if (mode === "off") return "";
  let cwd: unknown;
  let source: unknown;
  try {
    const parsed = JSON.parse(input) as { cwd?: unknown; source?: unknown };
    cwd = parsed.cwd;
    source = parsed.source;
  } catch {
    return "";
  }
  if (typeof cwd !== "string" || (typeof source === "string" && !freshSources.has(source))) {
    return "";
  }
  const top = await dependencies.git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "");
  if (top === "") return "";
  const branch = await defaultBranch(dependencies.git, top);
  if (branch === undefined) return "";
  const project = basename(top);
  // No token, intake off or an unreachable server: the session starts as if no hook were there.
  const notes = await dependencies.listWork(project).catch(() => undefined);
  if (notes === undefined) return "";
  const since = catchUpSince(project, notes, dependencies.now?.() ?? new Date());
  const counted = await dependencies
    .git(top, ["rev-list", "--count", "--first-parent", `--since=${since}`, branch])
    .catch(() => "0");
  const count = Number.parseInt(counted, 10);
  if (!Number.isInteger(count) || count <= 0) return "";
  if (mode === "advise") {
    return JSON.stringify({ systemMessage: catchUpAdvice(count, branch, since) });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: catchUpContext(count, branch, project, since),
    },
  });
}
