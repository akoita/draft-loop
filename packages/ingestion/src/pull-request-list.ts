/**
 * A pull request list the candidate exported themselves (#2261), turned into Markdown career
 * evidence. DraftLoop makes no network call: the person runs, for example,
 *
 *   gh search prs --author=@me --merged --json title,body,closedAt,url,repository
 *
 * and uploads the JSON it prints, or a CSV with the columns `title,body,closedAt,url,repository`.
 * The Markdown groups the pull requests by repository under `# Pull requests`, one `###` heading
 * each, with its date and link, so a fact drawn from one cites the source and quotes its link,
 * and sensitivity rules can match a repository's heading.
 */

export const pullRequestListMediaTypes = ["application/json", "text/csv"] as const;
export type PullRequestListMediaType = (typeof pullRequestListMediaTypes)[number];

export const pullRequestListHeading = "Pull requests";

/** The most pull requests one file may hold. */
export const maximumPullRequestListEntries = 2_000;

const maximumTitleLength = 300;
const maximumBodyLength = 4_000;

export interface PullRequestEntry {
  readonly title: string;
  readonly body: string;
  /** The day it was merged or closed, `YYYY-MM-DD`, when the file gives one. */
  readonly date?: string;
  readonly url: string;
  /** `owner/name`, from the file or else from the link. */
  readonly repository: string;
}

export function isPullRequestListMediaType(value: string): value is PullRequestListMediaType {
  return (pullRequestListMediaTypes as readonly string[]).includes(value);
}

const pullRequestUrl =
  /^https:\/\/[A-Za-z0-9.-]+\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/\d+\/?$/u;

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\r\n?/gu, "\n").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1).trimEnd()}…` : cleaned;
}

function repositoryName(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ["nameWithOwner", "fullName", "full_name", "name"]) {
      const name = record[key];
      if (typeof name === "string" && name.trim() !== "") return name.trim();
    }
  }
  return undefined;
}

function day(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function entry(raw: Readonly<Record<string, unknown>>): PullRequestEntry | undefined {
  const title = text(raw.title, maximumTitleLength);
  const url = text(raw.url ?? raw.html_url, 500);
  if (title === undefined || title === "" || url === undefined) return undefined;
  const fromUrl = pullRequestUrl.exec(url)?.[1];
  if (fromUrl === undefined) return undefined;
  const repository = repositoryName(raw.repository) ?? fromUrl;
  const date = day(raw.closedAt ?? raw.mergedAt ?? raw.merged_at ?? raw.closed_at);
  return {
    title,
    body: text(raw.body, maximumBodyLength) ?? "",
    ...(date === undefined ? {} : { date }),
    url,
    repository: repository.includes("/") ? repository : fromUrl,
  };
}

function entries(rows: readonly unknown[]): readonly PullRequestEntry[] | undefined {
  if (rows.length === 0 || rows.length > maximumPullRequestListEntries) return undefined;
  const parsed: PullRequestEntry[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
    const item = entry(row as Record<string, unknown>);
    if (item === undefined) return undefined;
    parsed.push(item);
  }
  return parsed;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes (doubled) and line breaks. */
function csvRows(content: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) return undefined;
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** The file's pull requests, or `undefined` when it is not a pull request list. */
export function parsePullRequestList(
  content: string,
  mediaType: PullRequestListMediaType,
): readonly PullRequestEntry[] | undefined {
  const source = content.replace(/^﻿/u, "");
  if (mediaType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return undefined;
    }
    return Array.isArray(parsed) ? entries(parsed) : undefined;
  }
  const rows = csvRows(source);
  const header = rows?.[0]?.map((cell) => cell.trim());
  if (rows === undefined || header === undefined || !header.includes("title")) return undefined;
  if (!header.includes("url")) return undefined;
  return entries(
    rows
      .slice(1)
      .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]))),
  );
}

/** Keeps a line of the file from starting a Markdown heading, list or fence of its own. */
function inline(value: string): string {
  return value.replace(/\s+/gu, " ").replace(/^[#>*+\-`~|]+\s*/u, "");
}

function bodyLines(body: string): string {
  return body
    .split("\n")
    .map((line) => line.replace(/^(\s{0,3})(#{1,6}|`{3,}|~{3,})/u, "$1\\$2"))
    .join("\n");
}

/** The Markdown evidence: one section per repository, one heading per pull request. */
export function pullRequestListMarkdown(list: readonly PullRequestEntry[]): string {
  const byRepository = new Map<string, PullRequestEntry[]>();
  for (const item of list) {
    const group = byRepository.get(item.repository);
    if (group === undefined) byRepository.set(item.repository, [item]);
    else group.push(item);
  }
  const lines = [
    `# ${pullRequestListHeading}`,
    "",
    "Merged pull requests the candidate exported themselves, grouped by repository.",
  ];
  for (const repository of [...byRepository.keys()].sort()) {
    lines.push("", `## ${inline(repository)}`);
    const group = [...(byRepository.get(repository) ?? [])].sort((left, right) =>
      (right.date ?? "").localeCompare(left.date ?? ""),
    );
    for (const item of group) {
      lines.push("", `### ${inline(item.title)}`, "");
      if (item.date !== undefined) lines.push(`- Merged: ${item.date}`);
      lines.push(`- Repository: ${inline(item.repository)}`, `- Link: ${item.url}`);
      if (item.body !== "") lines.push("", bodyLines(item.body));
    }
  }
  return `${lines.join("\n")}\n`;
}
