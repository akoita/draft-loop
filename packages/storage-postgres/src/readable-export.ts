/**
 * A person's readable copy of one record (#3036): their documents under their own names, each job
 * application in its own folder with the job text, saved letters and exported drafts, their
 * profile, work journal and consent history. Every file is built from an allow list of fields, so
 * storage locations, counters, checksums, tenant ids and agent token ids never appear. The record
 * archive (`record-archive.ts`) stays the complete copy for operators.
 */
import type { BlobStoragePort } from "@draft-loop/storage";
import { StorageSecurityError } from "@draft-loop/storage/errors";
import type {
  ReadableRecordExport,
  ReadableRecordExports,
  RecordArchiveFile,
  RecordArchiveRequest,
} from "@draft-loop/storage/record-archive";

import { hostedWorkspaceReference, workspaceReferenceBlobs } from "./hosted-application-ports.js";
import type { PostgresTenantStorage } from "./postgres-storage.js";
import {
  type ArchiveObject,
  integrityFailure,
  type RecordArchiveRows,
  readChecked,
} from "./record-archive.js";
import type { SqlRow } from "./sql-client.js";

export const readableExportFormat = "draft-loop-readable-export";
export const readableExportFormatVersion = 1;

/** One file before it is written: text, or a stored document read and checked when reached. */
type PlannedFile =
  | { readonly path: string; readonly text: string }
  | { readonly path: string; readonly object: ArchiveObject };

const encoder = new TextEncoder();

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function day(value: unknown): string {
  const at = text(value);
  return at === undefined ? "undated" : at.slice(0, 10);
}

/** A name that is safe as one path segment on Windows, macOS and Linux. */
export function readableName(name: string, fallback: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+|[\s.]+$/gu, "")
    .slice(0, 100)
    .trim();
  return cleaned === "" ? fallback : cleaned;
}

/** Hands out names within one folder, adding " (2)", " (3)" before the extension to repeats. */
function uniqueNames() {
  const taken = new Set<string>();
  return (name: string): string => {
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${extension}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

const extensions: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/json": ".json",
  "text/markdown": ".md",
  "text/plain": ".txt",
  "text/html": ".html",
};

function withExtension(name: string, mediaType: unknown): string {
  const extension = typeof mediaType === "string" ? extensions[mediaType.split(";")[0] ?? ""] : "";
  if (extension === undefined || extension === "") return name;
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

function documentFiles(rows: RecordArchiveRows, blobs: BlobStoragePort): PlannedFile[] {
  const managed = new Map(
    (rows.get("candidate_knowledge_managed_source_versions") ?? []).map((row) => [
      String(row.version_id),
      row,
    ]),
  );
  const latest = new Map<string, SqlRow>();
  for (const version of rows.get("candidate_knowledge_source_versions") ?? []) {
    if (!managed.has(String(version.id))) continue;
    const current = latest.get(String(version.source_id));
    if (current === undefined || Number(version.version) > Number(current.version)) {
      latest.set(String(version.source_id), version);
    }
  }
  const name = uniqueNames();
  const files: PlannedFile[] = [];
  for (const source of rows.get("candidate_knowledge_sources") ?? []) {
    const version = latest.get(String(source.id));
    const stored = version === undefined ? undefined : managed.get(String(version.id));
    if (version === undefined || stored === undefined) continue;
    const fileName = withExtension(
      readableName(String(source.display_name), "document"),
      version.media_type,
    );
    files.push({
      path: `documents/${name(fileName)}`,
      object: {
        blobs,
        reference: {
          location: String(stored.blob_location),
          checksum: String(version.checksum),
          sizeBytes: Number(version.size_bytes),
        },
      },
    });
  }
  return files;
}

function jobText(row: SqlRow): string {
  const source = record(json(row.job_source_json));
  const lines = [`# ${String(row.name)}`, ""];
  if (source?.kind === "stored-text" && text(source.text) !== undefined) {
    lines.push(String(source.text));
  } else if (source?.kind === "approved-url") {
    lines.push(`Job page: ${String(source.url)}`);
    const page = text(record(source.page)?.text) ?? text(record(source.firstPage)?.text);
    if (page !== undefined) lines.push("", page);
  } else {
    lines.push("The job description was not stored with this application.");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const draftTitles: Readonly<Record<string, string>> = {
  "cover-letter": "Cover letter",
  "interview-questions": "Interview questions",
  "interview-guide": "Interview guide",
};

/** A saved cover letter or interview set as Markdown: each item's question and text only. */
function draftText(row: SqlRow): string {
  const draft = record(json(row.draft));
  const title = draftTitles[String(row.kind)] ?? "Saved draft";
  const lines = [`# ${title}`, "", `Saved ${day(row.created_at)}.`];
  for (const item of Array.isArray(draft?.items) ? draft.items : []) {
    const entry = record(item);
    const body = text(entry?.text);
    if (body === undefined) continue;
    const question = text(entry?.question);
    lines.push("");
    if (question !== undefined) lines.push(`## ${question}`, "");
    lines.push(body);
    const trap = text(entry?.trap);
    if (trap !== undefined) lines.push("", `Avoid: ${trap}`);
  }
  return `${lines.join("\n")}\n`;
}

/** When a row was made, as a file name can hold it: `2026-11-17 14.05` in UTC. */
function stamp(value: unknown): string {
  const at = text(value);
  if (at === undefined || at.length < 16) return day(value);
  return `${at.slice(0, 10)} ${at.slice(11, 13)}.${at.slice(14, 16)}`;
}

/** An exported CV as `CV 2026-11-17 14.05.pdf`: the stored name is an internal id. */
function exportName(row: SqlRow): string {
  const location = String(row.output_path);
  const base = location.slice(location.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return readableName(`CV ${stamp(row.created_at)}${extension}`, "CV");
}

function applicationFiles(
  rows: RecordArchiveRows,
  exportBlobs: BlobStoragePort,
  workspaceReference: string,
): PlannedFile[] {
  const files: PlannedFile[] = [];
  const folderName = uniqueNames();
  const folders = new Map<
    string,
    { readonly path: string; readonly name: (n: string) => string }
  >();
  for (const application of rows.get("applications") ?? []) {
    const path = `applications/${folderName(readableName(String(application.name), "Job application"))}`;
    folders.set(String(application.application_id), { path, name: uniqueNames() });
    files.push({ path: `${path}/job.md`, text: jobText(application) });
  }
  const looseNames = uniqueNames();
  const folderOf = (applicationId: unknown) =>
    folders.get(String(applicationId)) ?? { path: "other drafts", name: looseNames };

  for (const draft of rows.get("application_material_drafts") ?? []) {
    const folder = folderOf(draft.application_id);
    const title = (draftTitles[String(draft.kind)] ?? "Saved draft").toLowerCase();
    files.push({
      path: `${folder.path}/${folder.name(`${title} ${day(draft.created_at)}.md`)}`,
      text: draftText(draft),
    });
  }

  const applicationOfRun = new Map(
    (rows.get("application_run_bindings") ?? []).map((row) => [
      String(row.run_id),
      String(row.application_id),
    ]),
  );
  for (const row of rows.get("exports") ?? []) {
    const sizeBytes = record(json(row.payload_json))?.sizeBytes;
    if (
      row.status !== "completed" ||
      typeof row.output_path !== "string" ||
      typeof row.output_checksum !== "string" ||
      typeof sizeBytes !== "number"
    ) {
      continue;
    }
    if (!row.output_path.startsWith(`${workspaceReference}/`)) {
      throw new StorageSecurityError("An export is stored outside its record's workspace.");
    }
    const folder = folderOf(applicationOfRun.get(String(row.run_id)));
    files.push({
      path: `${folder.path}/exports/${folder.name(exportName(row))}`,
      object: {
        blobs: exportBlobs,
        reference: { location: row.output_path, checksum: row.output_checksum, sizeBytes },
      },
    });
  }
  return files;
}

function consentHistory(rows: RecordArchiveRows): unknown[] {
  return (rows.get("consent_events") ?? []).map((row) => ({
    kind: row.kind,
    action: row.action,
    basis: row.basis,
    recordedBy: row.recorded_by,
    ...(Array.isArray(row.providers) && row.providers.length > 0
      ? { providers: row.providers }
      : {}),
    ...(text(row.note) === undefined ? {} : { note: row.note }),
    recordedAt: row.recorded_at,
  }));
}

interface ProfileFact {
  readonly category: string;
  readonly field: string;
  readonly value: string;
  readonly quotes: readonly string[];
}

interface ReadableProfile {
  readonly status: unknown;
  readonly updatedAt: unknown;
  readonly reviewedAt?: unknown;
  readonly facts: readonly ProfileFact[];
}

/**
 * The latest version of each career profile, as its facts: category, field, value and the quotes
 * they rest on. Fact, subject and source ids, the model and its prompt version are left out.
 */
function profiles(rows: RecordArchiveRows): ReadableProfile[] {
  const latest = new Map<string, SqlRow>();
  for (const row of rows.get("canonical_candidate_profile_versions") ?? []) {
    const current = latest.get(String(row.profile_id));
    if (current === undefined || Number(row.version) > Number(current.version)) {
      latest.set(String(row.profile_id), row);
    }
  }
  return [...latest.values()].map((row) => {
    const payload = record(json(row.payload_json));
    const facts: ProfileFact[] = [];
    for (const item of Array.isArray(payload?.facts) ? payload.facts : []) {
      const fact = record(item);
      const value = text(fact?.value);
      if (fact === undefined || value === undefined) continue;
      const quotes = (Array.isArray(fact.provenance) ? fact.provenance : [])
        .map((source) => text(record(source)?.quote))
        .filter((quote): quote is string => quote !== undefined && quote !== value);
      facts.push({
        category: text(fact.category) ?? "other",
        field: text(fact.field) ?? "",
        value,
        quotes: [...new Set(quotes)],
      });
    }
    return {
      status: row.status,
      updatedAt: row.updated_at,
      ...(text(row.reviewed_at) === undefined ? {} : { reviewedAt: row.reviewed_at }),
      facts,
    };
  });
}

const profileSections: readonly (readonly [string, string])[] = [
  ["employer", "Employers"],
  ["role", "Roles"],
  ["date", "Dates"],
  ["project", "Projects"],
  ["achievement", "Achievements"],
  ["skill", "Skills"],
  ["education", "Education"],
  ["certification", "Certifications"],
  ["language", "Languages"],
  ["approved-link", "Links"],
];

/** The career profile as Markdown: one section per kind of fact, each with its quotes. */
function profileText(profile: ReadableProfile): string {
  const known = new Set(profileSections.map(([category]) => category));
  const sections: (readonly [string, string])[] = [...profileSections];
  for (const fact of profile.facts) {
    if (!known.has(fact.category)) {
      known.add(fact.category);
      sections.push([fact.category, fact.category]);
    }
  }
  const lines = [
    "# Career profile",
    "",
    `Updated ${day(profile.updatedAt)}${profile.status === "reviewed" ? ", reviewed" : ", not yet reviewed"}.`,
  ];
  for (const [category, title] of sections) {
    const facts = profile.facts.filter((fact) => fact.category === category);
    if (facts.length === 0) continue;
    lines.push("", `## ${title}`, "");
    for (const fact of facts) {
      const label = fact.field === "" || fact.field === category ? "" : `${fact.field}: `;
      lines.push(`- ${label}${fact.value.replace(/\s+/gu, " ")}`);
      for (const quote of fact.quotes) lines.push(`  > ${quote.replace(/\s+/gu, " ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The journal's kept notes, content fields only: no token ids, screening or tenant. */
function journalNotes(rows: RecordArchiveRows): Readonly<Record<string, unknown>>[] {
  const notes: Readonly<Record<string, unknown>>[] = [];
  for (const row of rows.get("work_journal_notes") ?? []) {
    if (row.status === "discarded" || row.status === "merged") continue;
    const content = record(record(json(row.note))?.content);
    if (content === undefined) continue;
    notes.push({
      status: row.status,
      createdAt: row.created_at,
      title: content.title,
      summary: content.summary,
      period: content.period,
      project: record(content.project)?.name,
      technologies: content.technologies,
      category: content.category,
      role: content.candidate_role,
      links: content.links,
      metrics: content.metrics,
    });
  }
  return notes;
}

function journalText(notes: readonly Readonly<Record<string, unknown>>[]): string {
  const lines = ["# Work journal"];
  for (const note of notes) {
    lines.push("", `## ${String(note.title)}`, "");
    const project = text(note.project);
    if (project !== undefined) lines.push(`Project: ${project}`);
    if (Array.isArray(note.technologies) && note.technologies.length > 0) {
      lines.push(`Technologies: ${note.technologies.join(", ")}`);
    }
    lines.push(
      `Noted ${day(note.createdAt)}${note.status === "pending" ? ", not yet approved" : ""}.`,
    );
    lines.push("", String(note.summary));
  }
  return `${lines.join("\n")}\n`;
}

function readme(createdAt: string, paths: readonly string[]): string {
  const has = (prefix: string) => paths.some((path) => path.startsWith(prefix));
  const rows: [string, string][] = [
    ["account.json", "When this copy was made and when the job search started."],
    ["consent-history.json", "Every consent you gave or withdrew, and when."],
  ];
  if (has("profile.md"))
    rows.push([
      "profile.md, profile.json",
      "Your career profile: each fact and the words it comes from.",
    ]);
  if (has("documents/"))
    rows.push(["documents/", "The files you added, under the names you gave them."]);
  if (has("applications/")) {
    rows.push([
      "applications/",
      "One folder per job application: the job text, saved letters and interview material, and exported drafts.",
    ]);
  }
  if (has("journal.md")) rows.push(["journal.md, journal.json", "Your work journal's notes."]);
  return [
    "# Your DraftLoop data",
    "",
    `This copy was made on ${createdAt.slice(0, 10)}. It holds what you added and what DraftLoop made for you.`,
    "",
    "| File or folder | What it holds |",
    "| --- | --- |",
    ...rows.map(([path, what]) => `| ${path} | ${what} |`),
    "",
  ].join("\n");
}

export interface PostgresReadableExportsOptions {
  /** One tenant's storage, borrowed. */
  readonly storage: PostgresTenantStorage;
  /** The tenant the storage was opened for. */
  readonly tenantId: string;
  /** The tenant's blob storage: managed source bytes and exported documents. */
  readonly blobs: BlobStoragePort;
  readonly now?: () => Date;
}

/**
 * Readable exports over one tenant's rows and objects. Preparing reads the record from one
 * snapshot and checks that every document it will copy exists; each document is checked against
 * its recorded checksum again as it is written.
 */
export function openPostgresReadableExports(
  options: PostgresReadableExportsOptions,
): ReadableRecordExports {
  const { storage, tenantId, blobs } = options;
  const exportBlobs = workspaceReferenceBlobs(blobs);
  const now = options.now ?? (() => new Date());
  // JSON built from product fields can still quote the tenant id, for example inside a profile.
  const scrub = (value: string) => value.replaceAll(tenantId, "account");
  const jsonFile = (path: string, value: unknown): PlannedFile => ({
    path,
    text: scrub(`${JSON.stringify(value, null, 2)}\n`),
  });

  return {
    prepare: async (request: RecordArchiveRequest): Promise<ReadableRecordExport> => {
      const workspaceReference = hostedWorkspaceReference(tenantId, request.workspaceId);
      const rows = await storage.readRecordArchiveRows({
        historyId: request.historyId,
        workspaceReference,
        workspaceId: request.workspaceId,
        knowledgeScope: request.knowledgeScope,
      });
      const createdAt = now().toISOString();
      const planned: PlannedFile[] = [
        jsonFile("account.json", {
          format: readableExportFormat,
          formatVersion: readableExportFormatVersion,
          exportedAt: createdAt,
          jobSearch: { startedAt: rows.get("workspaces")?.[0]?.created_at ?? null },
        }),
        jsonFile("consent-history.json", consentHistory(rows)),
      ];
      const profileList = profiles(rows);
      if (profileList.length > 0) {
        planned.push({
          path: "profile.md",
          text: profileList.map(profileText).join("\n"),
        });
        planned.push(jsonFile("profile.json", profileList));
      }
      planned.push(...documentFiles(rows, blobs));
      planned.push(...applicationFiles(rows, exportBlobs, workspaceReference));
      const notes = journalNotes(rows);
      if (notes.length > 0) {
        planned.push({ path: "journal.md", text: scrub(journalText(notes)) });
        planned.push(jsonFile("journal.json", notes));
      }
      for (const file of planned) {
        if ("object" in file && !(await file.object.blobs.exists(file.object.reference))) {
          throw integrityFailure();
        }
      }
      const files: PlannedFile[] = [
        {
          path: "README.md",
          text: readme(
            createdAt,
            planned.map((file) => file.path),
          ),
        },
        ...planned.map((file) => ("text" in file ? { ...file, text: scrub(file.text) } : file)),
      ];
      return {
        createdAt,
        fileCount: files.length,
        files: async function* (): AsyncGenerator<RecordArchiveFile> {
          for (const file of files) {
            yield {
              path: file.path,
              content: "text" in file ? encoder.encode(file.text) : await readChecked(file.object),
            };
          }
        },
      };
    },
  };
}
