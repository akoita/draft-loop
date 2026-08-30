import { readFile } from "node:fs/promises";

import { defaultRequiredSections } from "@draft-loop/application";
import { Command } from "commander";
import packageJson from "../package.json";

import { independentReviewLines } from "./independent-review.js";
import { generateSanitizedPilotReport } from "./pilot-report.js";
import {
  type AddKnowledgeSourceDirectoryMembersResult,
  type ApplicationIo,
  type ApplicationService,
  type ApplyKnowledgeSourceDirectoryMemberMoveResult,
  type ApplyKnowledgeSourceDirectoryReconciliationResult,
  type ApplyKnowledgeSourceDirectoryRefreshResult,
  type ApplyKnowledgeSourceDirectoryRootRebindResult,
  applicationService,
  type CandidateKnowledgeSourceManifest,
  type CandidateKnowledgeSourceWriteResult,
  type CandidateKnowledgeStoreService,
  type CandidateKnowledgeStoreView,
  type CanonicalCandidateProfilePatch,
  type ImportKnowledgeSourceDirectoryResult,
  type KnowledgeBaseLifecycleReadinessResult,
  type KnowledgeSourceDuplicateGroup,
  type KnowledgeSourceOriginRebindResult,
  type KnowledgeSourceOriginRefreshResult,
  type KnowledgeSourceOriginStatusResult,
  type KnowledgeSourceRefreshStateResult,
  type KnowledgeSourceRetirementResult,
  knowledgeService,
  type OpportunityDraftPatch,
  type OpportunitySourceInput,
  type PreviewKnowledgeSourceDirectoryMovedCandidatesResult,
  type PreviewKnowledgeSourceDirectoryReconciliationResult,
  type PreviewKnowledgeSourceDirectoryRefreshResult,
  type PreviewKnowledgeSourceDirectoryRootRebindResult,
  type RunWritingPolicyProjection,
  runPilot,
  type StatusCommand,
  safeErrorMessage,
  type WorkspaceDescriptor,
  type WritingPolicyVersionMetadata,
  type WritingPolicyVersionView,
  workspaceRoot,
} from "./workflow.js";

type DirectoryIngestionOptions = {
  readonly maxDepth?: number;
  readonly maxScannedEntries?: number;
  readonly maxAcceptedFiles?: number;
  readonly maxAcceptedBytes?: number;
  readonly maxSourceBytes?: number;
  readonly maxChunkCharacters?: number;
};

function numberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received ${value}.`);
  }
  return parsed;
}

function integerOption(value: string): number {
  const parsed = numberOption(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer, received ${value}.`);
  }
  return parsed;
}

function positiveIntegerOption(value: string): number {
  const parsed = integerOption(value);
  if (parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function repeatedStringOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function directoryIngestionOptions(
  options: Record<string, unknown>,
): DirectoryIngestionOptions | undefined {
  const normalized: DirectoryIngestionOptions = {
    ...(typeof options.maxDepth === "number" ? { maxDepth: options.maxDepth } : {}),
    ...(typeof options.maxScannedEntries === "number"
      ? { maxScannedEntries: options.maxScannedEntries }
      : {}),
    ...(typeof options.maxAcceptedFiles === "number"
      ? { maxAcceptedFiles: options.maxAcceptedFiles }
      : {}),
    ...(typeof options.maxAcceptedBytes === "number"
      ? { maxAcceptedBytes: options.maxAcceptedBytes }
      : {}),
    ...(typeof options.maxSourceBytes === "number"
      ? { maxSourceBytes: options.maxSourceBytes }
      : {}),
    ...(typeof options.maxChunkCharacters === "number"
      ? { maxChunkCharacters: options.maxChunkCharacters }
      : {}),
  };
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function boolOption(options: Record<string, unknown>, key: string): boolean {
  return options[key] === true;
}

const writingPolicyChecksumPattern = /^[a-f0-9]{64}$/u;

function writingPolicyChecksumOption(value: string): string {
  if (!writingPolicyChecksumPattern.test(value)) {
    throw new Error("Writing policy checksum must be a lowercase SHA-256 checksum.");
  }
  return value;
}

function requireWritingPolicyApi<T extends (...arguments_: never[]) => unknown>(
  api: T | undefined,
  operation: string,
): T {
  if (typeof api !== "function") {
    throw new Error(`Writing policy ${operation} is unsupported by this application service.`);
  }
  return api;
}

function writingPolicyMetadataLine(label: string, metadata: WritingPolicyVersionMetadata): string {
  return [
    label === "" ? "writing-policy" : `writing-policy ${label}`,
    `version=${metadata.version}`,
    `checksum=${metadata.checksum}`,
    `schemaVersion=${metadata.schemaVersion}`,
    `createdAt=${metadata.createdAt}`,
    `priorChecksum=${metadata.priorChecksum ?? "none"}`,
  ].join(" ");
}

function writeWritingPolicyVersion(
  io: ApplicationIo,
  version: WritingPolicyVersionView,
  includeContent = false,
): void {
  io.write(writingPolicyMetadataLine("", version));
  if (!includeContent) return;
  const content = version.policy?.content;
  if (typeof content !== "string") {
    throw new Error("The application service did not return writing policy content.");
  }
  io.write(content);
}

function writeRunWritingPolicy(
  io: ApplicationIo,
  projection: RunWritingPolicyProjection | undefined,
): void {
  if (projection === undefined) return;
  io.write(`writing-policy lineage=${projection.lineage.kind}`);
  io.write(writingPolicyMetadataLine("effective", projection.effective));
  if (projection.base !== undefined) {
    io.write(writingPolicyMetadataLine("base", projection.base));
  } else if (projection.lineage.kind === "opportunity-override") {
    io.write(
      `writing-policy base version=${projection.lineage.base.version} checksum=${projection.lineage.base.checksum}`,
    );
  }
  if (projection.override !== undefined) {
    io.write(writingPolicyMetadataLine("override", projection.override));
  } else if (projection.lineage.kind === "opportunity-override") {
    io.write(
      `writing-policy override version=${projection.lineage.override.version} checksum=${projection.lineage.override.checksum}`,
    );
  }
}

async function configureAndWritePolicy(
  service: ApplicationService,
  io: ApplicationIo,
  sourcePath: string,
  root: string,
  activate: boolean,
): Promise<void> {
  const configured = await service.configureWritingPolicy(
    {
      root,
      sourcePath,
      ...(activate ? {} : { activate: false }),
    },
    io,
  );
  let imported: WritingPolicyVersionView | undefined = activate
    ? configured.activeWritingPolicy
    : undefined;
  if (imported === undefined) {
    const listWritingPolicyVersions = requireWritingPolicyApi(
      service.listWritingPolicyVersions,
      "history",
    );
    const history = await listWritingPolicyVersions({ root });
    imported = history.at(-1);
  }
  if (imported === undefined) {
    throw new Error("The application service did not return the imported writing policy version.");
  }
  writeWritingPolicyVersion(io, imported);
}

/** Status lines are user-facing output, so they go to stdout rather than stderr. */
const stdoutIo: ApplicationIo = {
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
};

export interface CliDependencies {
  /** The application boundary the commands drive; replaced in tests. */
  readonly service?: ApplicationService;
  /** The candidate-knowledge boundary the path-explicit controls drive; replaced in tests. */
  readonly knowledgeService?: CandidateKnowledgeStoreService;
  /** Where status lines are written; replaced in tests. */
  readonly io?: ApplicationIo;
}

function writeKnowledgeStoreView(
  io: ApplicationIo,
  action: string,
  view: CandidateKnowledgeStoreView,
): void {
  io.write(`knowledge store ${action}: ${view.store.id}`);
  for (const knowledgeBase of [...view.knowledgeBases].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    io.write(
      `knowledge base ${knowledgeBase.id} state=${knowledgeBase.state} default=${knowledgeBase.isDefault}`,
    );
  }
}

function writeKnowledgeBaseReadiness(
  io: ApplicationIo,
  readiness: KnowledgeBaseLifecycleReadinessResult,
): void {
  io.write(
    `knowledge base ${readiness.knowledgeBaseId} state=${readiness.state} sources=${readiness.sources.length}`,
  );
  for (const source of readiness.sources) {
    const reasons = source.reasons.length === 0 ? "none" : source.reasons.join(",");
    io.write(
      `source ${source.sourceId} version=${source.latestVersionId} status=${source.status} reasons=${reasons}`,
    );
  }
}

const maximumKnowledgeInspectionItems = 256;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(io: ApplicationIo, value: unknown): void {
  io.write(JSON.stringify(value));
}

async function readJsonObject(path: string, label: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} must be a readable JSON file.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
  return value as Record<string, unknown>;
}

function writeKnowledgeSourceManifests(
  io: ApplicationIo,
  knowledgeBaseId: string,
  manifests: readonly CandidateKnowledgeSourceManifest[],
): void {
  const ordered = [...manifests].sort((left, right) =>
    lexicalCompare(left.source.id, right.source.id),
  );
  const sources = ordered.slice(0, maximumKnowledgeInspectionItems).map((manifest) => {
    const versions = [...manifest.versions].sort(
      (left, right) => left.version - right.version || lexicalCompare(left.id, right.id),
    );
    return {
      sourceId: manifest.source.id,
      kind: manifest.source.kind,
      versionCount: versions.length,
      versionIds: versions.slice(0, maximumKnowledgeInspectionItems).map((version) => version.id),
      versionIdsTruncated: versions.length > maximumKnowledgeInspectionItems,
    };
  });
  writeJson(io, {
    knowledgeBaseId,
    sourceCount: ordered.length,
    sources,
    sourcesTruncated: ordered.length > maximumKnowledgeInspectionItems,
  });
}

function writeKnowledgeSourceDuplicateGroups(
  io: ApplicationIo,
  knowledgeBaseId: string,
  groups: readonly KnowledgeSourceDuplicateGroup[],
): void {
  const ordered = groups
    .map((group) => ({
      ...group,
      members: [...group.members].sort(
        (left, right) =>
          lexicalCompare(left.sourceId, right.sourceId) ||
          lexicalCompare(left.versionId, right.versionId),
      ),
    }))
    .sort((left, right) => {
      const leftKey = left.members
        .map((member) => `${member.sourceId}\u0000${member.versionId}`)
        .join("\u0001");
      const rightKey = right.members
        .map((member) => `${member.sourceId}\u0000${member.versionId}`)
        .join("\u0001");
      return lexicalCompare(leftKey, rightKey);
    });
  const duplicateGroups = ordered.slice(0, maximumKnowledgeInspectionItems).map((group) => ({
    memberCount: group.members.length,
    members: group.members.slice(0, maximumKnowledgeInspectionItems),
    membersTruncated: group.members.length > maximumKnowledgeInspectionItems,
  }));
  writeJson(io, {
    knowledgeBaseId,
    groupCount: ordered.length,
    groups: duplicateGroups,
    groupsTruncated: ordered.length > maximumKnowledgeInspectionItems,
  });
}

function writeKnowledgeSourceWriteResult(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: CandidateKnowledgeSourceWriteResult,
  expectedKind: "file" | "url",
  expectedSourceId?: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.created !== "boolean" ||
    typeof result.source !== "object" ||
    result.source === null ||
    result.source.knowledgeBaseId !== knowledgeBaseId ||
    typeof result.source.id !== "string" ||
    result.source.id.trim() === "" ||
    (expectedSourceId !== undefined && result.source.id !== expectedSourceId) ||
    result.source.kind !== expectedKind ||
    !Array.isArray(result.versions) ||
    result.versions.length === 0
  ) {
    throw new Error("The candidate knowledge source write result was invalid.");
  }
  const versions = [...result.versions].sort(
    (left, right) => right.version - left.version || lexicalCompare(left.id, right.id),
  );
  const latest = versions[0];
  if (
    latest === undefined ||
    typeof latest.id !== "string" ||
    latest.id.trim() === "" ||
    latest.sourceId !== result.source.id ||
    !Number.isSafeInteger(latest.version) ||
    latest.version < 1
  ) {
    throw new Error("The candidate knowledge source write result was invalid.");
  }
  writeJson(io, {
    knowledgeBaseId,
    sourceId: result.source.id,
    kind: result.source.kind,
    versionId: latest.id,
    version: latest.version,
    created: result.created,
  });
}

function writeKnowledgeSourceDirectoryImport(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: ImportKnowledgeSourceDirectoryResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    (result.status !== "complete" && result.status !== "partial") ||
    !Array.isArray(result.sources) ||
    ![result.scannedEntryCount, result.discoveredFileCount, result.skippedEntryCount].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount ||
    result.discoveredFileCount < result.sources.length ||
    (result.status === "complete" && result.discoveredFileCount !== result.sources.length)
  ) {
    throw new Error("The candidate knowledge source directory result was invalid.");
  }
  const hasDirectoryId = Object.hasOwn(result, "directoryId");
  if (
    (result.status === "complete" &&
      (typeof result.directoryId !== "string" || result.directoryId.trim() === "")) ||
    (result.status === "partial" && hasDirectoryId)
  ) {
    throw new Error("The candidate knowledge source directory result was invalid.");
  }

  const sourceIds = new Set<string>();
  for (const manifest of result.sources) {
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      typeof manifest.created !== "boolean" ||
      typeof manifest.source !== "object" ||
      manifest.source === null ||
      typeof manifest.source.id !== "string" ||
      manifest.source.id.trim() === "" ||
      sourceIds.has(manifest.source.id) ||
      manifest.source.knowledgeBaseId !== knowledgeBaseId ||
      manifest.source.kind !== "file" ||
      !Array.isArray(manifest.versions) ||
      manifest.versions.length === 0
    ) {
      throw new Error("The candidate knowledge source directory result was invalid.");
    }
    sourceIds.add(manifest.source.id);
    const versionIds = new Set<string>();
    for (const version of manifest.versions) {
      if (
        typeof version !== "object" ||
        version === null ||
        typeof version.id !== "string" ||
        version.id.trim() === "" ||
        versionIds.has(version.id) ||
        version.sourceId !== manifest.source.id ||
        !Number.isSafeInteger(version.version) ||
        version.version < 1
      ) {
        throw new Error("The candidate knowledge source directory result was invalid.");
      }
      versionIds.add(version.id);
    }
  }

  const ordered = [...result.sources].sort((left, right) =>
    lexicalCompare(left.source.id, right.source.id),
  );
  const sources = ordered.slice(0, maximumKnowledgeInspectionItems).map((manifest) => {
    const latest = [...manifest.versions].sort(
      (left, right) => right.version - left.version || lexicalCompare(left.id, right.id),
    )[0];
    return {
      sourceId: manifest.source.id,
      versionId: latest.id,
      version: latest.version,
      created: manifest.created,
    };
  });
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      status: result.status,
      ...(result.status === "complete" ? { directoryId: result.directoryId } : {}),
      scannedEntryCount: result.scannedEntryCount,
      discoveredFileCount: result.discoveredFileCount,
      skippedEntryCount: result.skippedEntryCount,
      sourceCount: ordered.length,
      sources,
      sourcesTruncated: ordered.length > maximumKnowledgeInspectionItems,
    }),
  );
}

function writeKnowledgeSourceDirectoryRootRebind(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  result:
    | PreviewKnowledgeSourceDirectoryRootRebindResult
    | ApplyKnowledgeSourceDirectoryRootRebindResult,
  expectedStatuses: readonly ("current" | "ready" | "rebound")[],
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !expectedStatuses.includes(result.status) ||
    ![
      result.memberCount,
      result.scannedEntryCount,
      result.discoveredFileCount,
      result.skippedEntryCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    result.memberCount !== result.discoveredFileCount ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount
  ) {
    throw new Error("The candidate knowledge source directory root rebind result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      checkedAt: result.checkedAt,
      status: result.status,
      memberCount: result.memberCount,
      scannedEntryCount: result.scannedEntryCount,
      discoveredFileCount: result.discoveredFileCount,
      skippedEntryCount: result.skippedEntryCount,
    }),
  );
}

function writeKnowledgeSourceDirectoryRefresh(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  result: PreviewKnowledgeSourceDirectoryRefreshResult | ApplyKnowledgeSourceDirectoryRefreshResult,
  phase: "preview" | "apply",
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !Array.isArray(result.members) ||
    ![
      result.newSourceCount,
      result.scannedEntryCount,
      result.discoveredFileCount,
      result.skippedEntryCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    result.newSourceCount > result.discoveredFileCount ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount
  ) {
    throw new Error("The candidate knowledge source directory refresh result was invalid.");
  }

  const memberIds = new Set<string>();
  const memberStatuses = new Map<string, string>();
  for (const member of result.members) {
    if (
      typeof member !== "object" ||
      member === null ||
      typeof member.sourceId !== "string" ||
      member.sourceId.trim() === "" ||
      memberIds.has(member.sourceId) ||
      !["current", "changed", "missing", "retired", "origin-conflict"].includes(member.status)
    ) {
      throw new Error("The candidate knowledge source directory refresh result was invalid.");
    }
    memberIds.add(member.sourceId);
    memberStatuses.set(member.sourceId, member.status);
  }

  const hasStatus = Object.hasOwn(result, "status");
  if (
    phase === "preview" &&
    (hasStatus ||
      Object.hasOwn(result, "refreshedSourceIds") ||
      Object.hasOwn(result, "failedSourceId") ||
      Object.hasOwn(result, "failedStatus"))
  ) {
    throw new Error("The candidate knowledge source directory refresh result was invalid.");
  }
  if (
    phase === "apply" &&
    (!hasStatus ||
      !["complete", "partial"].includes(
        (result as ApplyKnowledgeSourceDirectoryRefreshResult).status,
      ))
  ) {
    throw new Error("The candidate knowledge source directory refresh result was invalid.");
  }

  const orderedMembers = [...result.members].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  );
  const projection: Record<string, unknown> = {
    knowledgeBaseId,
    directoryId,
    checkedAt: result.checkedAt,
    members: orderedMembers
      .slice(0, maximumKnowledgeInspectionItems)
      .map(({ sourceId, status }) => ({ sourceId, status })),
    memberCount: orderedMembers.length,
    membersTruncated: orderedMembers.length > maximumKnowledgeInspectionItems,
    newSourceCount: result.newSourceCount,
    scannedEntryCount: result.scannedEntryCount,
    discoveredFileCount: result.discoveredFileCount,
    skippedEntryCount: result.skippedEntryCount,
  };

  if (phase === "apply") {
    const applyResult = result as ApplyKnowledgeSourceDirectoryRefreshResult;
    if (!Array.isArray(applyResult.refreshedSourceIds)) {
      throw new Error("The candidate knowledge source directory refresh result was invalid.");
    }
    const refreshedSourceIds = new Set<string>();
    for (const sourceId of applyResult.refreshedSourceIds) {
      if (
        typeof sourceId !== "string" ||
        sourceId.trim() === "" ||
        refreshedSourceIds.has(sourceId) ||
        !memberIds.has(sourceId) ||
        memberStatuses.get(sourceId) !== "changed"
      ) {
        throw new Error("The candidate knowledge source directory refresh result was invalid.");
      }
      refreshedSourceIds.add(sourceId);
    }
    const orderedRefreshedSourceIds = [...refreshedSourceIds].sort(lexicalCompare);
    projection.status = applyResult.status;
    projection.refreshedSourceIds = orderedRefreshedSourceIds.slice(
      0,
      maximumKnowledgeInspectionItems,
    );
    projection.refreshedSourceCount = orderedRefreshedSourceIds.length;
    projection.refreshedSourceIdsTruncated =
      orderedRefreshedSourceIds.length > maximumKnowledgeInspectionItems;
    const hasFailedSourceId = Object.hasOwn(applyResult, "failedSourceId");
    const hasFailedStatus = Object.hasOwn(applyResult, "failedStatus");
    if (applyResult.status === "complete") {
      if (hasFailedSourceId || hasFailedStatus) {
        throw new Error("The candidate knowledge source directory refresh result was invalid.");
      }
    } else if (
      !hasFailedSourceId ||
      !hasFailedStatus ||
      typeof applyResult.failedSourceId !== "string" ||
      applyResult.failedSourceId.trim() === "" ||
      !memberIds.has(applyResult.failedSourceId) ||
      memberStatuses.get(applyResult.failedSourceId) !== "changed" ||
      refreshedSourceIds.has(applyResult.failedSourceId) ||
      applyResult.failedStatus !== "changed"
    ) {
      throw new Error("The candidate knowledge source directory refresh result was invalid.");
    } else {
      projection.failedSourceId = applyResult.failedSourceId;
      projection.failedStatus = applyResult.failedStatus;
    }
  }
  writeJson(io, Object.freeze(projection));
}

function writeKnowledgeSourceDirectoryAddMembers(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  result: AddKnowledgeSourceDirectoryMembersResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !Array.isArray(result.members) ||
    !["complete", "partial"].includes(result.status) ||
    !Array.isArray(result.addedSourceIds) ||
    ![
      result.newSourceCount,
      result.scannedEntryCount,
      result.discoveredFileCount,
      result.skippedEntryCount,
      result.addedSourceCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    result.newSourceCount > result.discoveredFileCount ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount ||
    result.addedSourceCount !== result.addedSourceIds.length ||
    result.addedSourceCount > result.newSourceCount ||
    (result.status === "complete" && result.addedSourceCount !== result.newSourceCount) ||
    (result.status === "partial" && result.addedSourceCount >= result.newSourceCount)
  ) {
    throw new Error("The candidate knowledge source directory add-members result was invalid.");
  }

  const memberIds = new Set<string>();
  for (const member of result.members) {
    if (
      typeof member !== "object" ||
      member === null ||
      typeof member.sourceId !== "string" ||
      member.sourceId.trim() === "" ||
      memberIds.has(member.sourceId) ||
      !["current", "changed", "missing", "retired", "origin-conflict"].includes(member.status)
    ) {
      throw new Error("The candidate knowledge source directory add-members result was invalid.");
    }
    memberIds.add(member.sourceId);
  }

  const addedSourceIds = new Set<string>();
  for (const sourceId of result.addedSourceIds) {
    if (
      typeof sourceId !== "string" ||
      sourceId.trim() === "" ||
      addedSourceIds.has(sourceId) ||
      memberIds.has(sourceId)
    ) {
      throw new Error("The candidate knowledge source directory add-members result was invalid.");
    }
    addedSourceIds.add(sourceId);
  }

  const orderedMembers = [...result.members].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  );
  const orderedAddedSourceIds = [...addedSourceIds].sort(lexicalCompare);
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      checkedAt: result.checkedAt,
      members: orderedMembers
        .slice(0, maximumKnowledgeInspectionItems)
        .map(({ sourceId, status }) => ({ sourceId, status })),
      memberCount: orderedMembers.length,
      membersTruncated: orderedMembers.length > maximumKnowledgeInspectionItems,
      newSourceCount: result.newSourceCount,
      scannedEntryCount: result.scannedEntryCount,
      discoveredFileCount: result.discoveredFileCount,
      skippedEntryCount: result.skippedEntryCount,
      status: result.status,
      addedSourceIds: orderedAddedSourceIds.slice(0, maximumKnowledgeInspectionItems),
      addedSourceCount: orderedAddedSourceIds.length,
      addedSourceIdsTruncated: orderedAddedSourceIds.length > maximumKnowledgeInspectionItems,
    }),
  );
}

function writeKnowledgeSourceDirectoryMovedCandidates(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  result: PreviewKnowledgeSourceDirectoryMovedCandidatesResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !Array.isArray(result.candidates) ||
    !Number.isSafeInteger(result.candidateCount) ||
    result.candidateCount < 0 ||
    result.candidateCount !== result.candidates.length ||
    ![
      result.newSourceCount,
      result.scannedEntryCount,
      result.discoveredFileCount,
      result.skippedEntryCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    result.newSourceCount > result.discoveredFileCount ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount
  ) {
    throw new Error("The candidate knowledge source directory moved-candidate result was invalid.");
  }

  const sourceIds = new Set<string>();
  for (const candidate of result.candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.sourceId !== "string" ||
      candidate.sourceId.trim() === "" ||
      sourceIds.has(candidate.sourceId) ||
      candidate.status !== "moved-candidate"
    ) {
      throw new Error(
        "The candidate knowledge source directory moved-candidate result was invalid.",
      );
    }
    sourceIds.add(candidate.sourceId);
  }

  const ordered = [...result.candidates].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  );
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      checkedAt: result.checkedAt,
      candidates: ordered.slice(0, maximumKnowledgeInspectionItems).map(({ sourceId, status }) => ({
        sourceId,
        status,
      })),
      candidateCount: result.candidateCount,
      candidatesTruncated: result.candidateCount > maximumKnowledgeInspectionItems,
      newSourceCount: result.newSourceCount,
      scannedEntryCount: result.scannedEntryCount,
      discoveredFileCount: result.discoveredFileCount,
      skippedEntryCount: result.skippedEntryCount,
    }),
  );
}

function writeKnowledgeSourceDirectoryReconciliationPreview(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  result: PreviewKnowledgeSourceDirectoryReconciliationResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !Array.isArray(result.members) ||
    !["complete", "incomplete"].includes(result.scanStatus) ||
    ![
      result.currentCount,
      result.changedCount,
      result.alreadyRetiredCount,
      result.conflictedCount,
      result.movedCandidateCount,
      result.missingCount,
      result.newSourceCount,
      result.scannedEntryCount,
      result.discoveredFileCount,
      result.skippedEntryCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    result.newSourceCount > result.discoveredFileCount ||
    result.discoveredFileCount + result.skippedEntryCount > result.scannedEntryCount ||
    (result.scanStatus === "complete") !== (result.skippedEntryCount === 0) ||
    Object.hasOwn(result, "status") ||
    Object.hasOwn(result, "retiredSourceIds") ||
    Object.hasOwn(result, "alreadyRetiredSourceIds") ||
    Object.hasOwn(result, "failedSourceId") ||
    Object.hasOwn(result, "failedStatus") ||
    Object.hasOwn(result, "retiredSourceCount") ||
    Object.hasOwn(result, "retiredSourceIdsTruncated") ||
    Object.hasOwn(result, "alreadyRetiredSourceCount") ||
    Object.hasOwn(result, "alreadyRetiredSourceIdsTruncated")
  ) {
    throw new Error("The candidate knowledge source directory reconciliation result was invalid.");
  }

  const memberIds = new Set<string>();
  const observedCounts = {
    current: 0,
    changed: 0,
    "already-retired": 0,
    conflicted: 0,
    "moved-candidate": 0,
    missing: 0,
  };
  for (const member of result.members) {
    if (
      typeof member !== "object" ||
      member === null ||
      typeof member.sourceId !== "string" ||
      member.sourceId.trim() === "" ||
      memberIds.has(member.sourceId)
    ) {
      throw new Error(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
    switch (member.status) {
      case "current":
      case "changed":
      case "already-retired":
      case "conflicted":
      case "moved-candidate":
      case "missing":
        break;
      default:
        throw new Error(
          "The candidate knowledge source directory reconciliation result was invalid.",
        );
    }
    memberIds.add(member.sourceId);
    const status = member.status as keyof typeof observedCounts;
    observedCounts[status] += 1;
  }

  const expectedCounts = [
    result.currentCount,
    result.changedCount,
    result.alreadyRetiredCount,
    result.conflictedCount,
    result.movedCandidateCount,
    result.missingCount,
  ];
  const actualCounts = [
    observedCounts.current,
    observedCounts.changed,
    observedCounts["already-retired"],
    observedCounts.conflicted,
    observedCounts["moved-candidate"],
    observedCounts.missing,
  ];
  if (
    result.members.length !== expectedCounts.reduce((sum, count) => sum + count, 0) ||
    expectedCounts.some((count, index) => count !== actualCounts[index])
  ) {
    throw new Error("The candidate knowledge source directory reconciliation result was invalid.");
  }

  const orderedMembers = [...result.members].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  );
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      checkedAt: result.checkedAt,
      members: orderedMembers
        .slice(0, maximumKnowledgeInspectionItems)
        .map(({ sourceId, status }) => ({ sourceId, status })),
      memberCount: orderedMembers.length,
      membersTruncated: orderedMembers.length > maximumKnowledgeInspectionItems,
      currentCount: result.currentCount,
      changedCount: result.changedCount,
      alreadyRetiredCount: result.alreadyRetiredCount,
      conflictedCount: result.conflictedCount,
      movedCandidateCount: result.movedCandidateCount,
      missingCount: result.missingCount,
      newSourceCount: result.newSourceCount,
      scanStatus: result.scanStatus,
      scannedEntryCount: result.scannedEntryCount,
      discoveredFileCount: result.discoveredFileCount,
      skippedEntryCount: result.skippedEntryCount,
    }),
  );
}

function writeKnowledgeSourceDirectoryReconciliationApply(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  approvedRetirementSourceIds: readonly string[],
  result: ApplyKnowledgeSourceDirectoryReconciliationResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !["applied", "current", "partial"].includes(result.status) ||
    !Array.isArray(result.retiredSourceIds) ||
    !Array.isArray(result.alreadyRetiredSourceIds) ||
    Object.hasOwn(result, "members") ||
    Object.hasOwn(result, "memberCount") ||
    Object.hasOwn(result, "membersTruncated") ||
    Object.hasOwn(result, "currentCount") ||
    Object.hasOwn(result, "changedCount") ||
    Object.hasOwn(result, "alreadyRetiredCount") ||
    Object.hasOwn(result, "conflictedCount") ||
    Object.hasOwn(result, "movedCandidateCount") ||
    Object.hasOwn(result, "missingCount") ||
    Object.hasOwn(result, "newSourceCount") ||
    Object.hasOwn(result, "scanStatus") ||
    Object.hasOwn(result, "scannedEntryCount") ||
    Object.hasOwn(result, "discoveredFileCount") ||
    Object.hasOwn(result, "skippedEntryCount") ||
    Object.hasOwn(result, "retiredSourceCount") ||
    Object.hasOwn(result, "retiredSourceIdsTruncated") ||
    Object.hasOwn(result, "alreadyRetiredSourceCount") ||
    Object.hasOwn(result, "alreadyRetiredSourceIdsTruncated") ||
    Object.hasOwn(result, "failedStatus")
  ) {
    throw new Error("The candidate knowledge source directory reconciliation result was invalid.");
  }

  const approvedSourceIds = new Set(approvedRetirementSourceIds);

  const retiredSourceIds = new Set<string>();
  for (const sourceId of result.retiredSourceIds) {
    if (
      typeof sourceId !== "string" ||
      sourceId.trim() === "" ||
      retiredSourceIds.has(sourceId) ||
      !approvedSourceIds.has(sourceId)
    ) {
      throw new Error(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
    retiredSourceIds.add(sourceId);
  }
  const alreadyRetiredSourceIds = new Set<string>();
  for (const sourceId of result.alreadyRetiredSourceIds) {
    if (
      typeof sourceId !== "string" ||
      sourceId.trim() === "" ||
      alreadyRetiredSourceIds.has(sourceId) ||
      retiredSourceIds.has(sourceId) ||
      !approvedSourceIds.has(sourceId)
    ) {
      throw new Error(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
    alreadyRetiredSourceIds.add(sourceId);
  }

  const hasFailedSourceId = Object.hasOwn(result, "failedSourceId");
  if (result.status === "partial") {
    if (
      !hasFailedSourceId ||
      typeof result.failedSourceId !== "string" ||
      result.failedSourceId.trim() === "" ||
      !approvedSourceIds.has(result.failedSourceId) ||
      retiredSourceIds.has(result.failedSourceId) ||
      alreadyRetiredSourceIds.has(result.failedSourceId)
    ) {
      throw new Error(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
  } else if (
    hasFailedSourceId ||
    (result.status === "applied" && result.retiredSourceIds.length === 0) ||
    (result.status === "current" && result.retiredSourceIds.length !== 0)
  ) {
    throw new Error("The candidate knowledge source directory reconciliation result was invalid.");
  }

  const orderedRetiredSourceIds = [...retiredSourceIds].sort(lexicalCompare);
  const orderedAlreadyRetiredSourceIds = [...alreadyRetiredSourceIds].sort(lexicalCompare);
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      checkedAt: result.checkedAt,
      status: result.status,
      retiredSourceIds: orderedRetiredSourceIds.slice(0, maximumKnowledgeInspectionItems),
      retiredSourceCount: orderedRetiredSourceIds.length,
      retiredSourceIdsTruncated: orderedRetiredSourceIds.length > maximumKnowledgeInspectionItems,
      alreadyRetiredSourceIds: orderedAlreadyRetiredSourceIds.slice(
        0,
        maximumKnowledgeInspectionItems,
      ),
      alreadyRetiredSourceCount: orderedAlreadyRetiredSourceIds.length,
      alreadyRetiredSourceIdsTruncated:
        orderedAlreadyRetiredSourceIds.length > maximumKnowledgeInspectionItems,
      ...(result.status === "partial" ? { failedSourceId: result.failedSourceId } : {}),
    }),
  );
}

function writeKnowledgeSourceDirectoryMemberMove(
  io: ApplicationIo,
  knowledgeBaseId: string,
  directoryId: string,
  sourceId: string,
  result: ApplyKnowledgeSourceDirectoryMemberMoveResult,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.directoryId !== directoryId ||
    result.sourceId !== sourceId ||
    typeof result.sourceId !== "string" ||
    result.sourceId.trim() === "" ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !["moved", "current"].includes(result.status)
  ) {
    throw new Error("The candidate knowledge source directory member move result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      directoryId,
      sourceId,
      checkedAt: result.checkedAt,
      status: result.status,
    }),
  );
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && isoTimestampPattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isOptionalIsoTimestamp(value: unknown): value is string | undefined {
  return value === undefined || isValidIsoTimestamp(value);
}

function isOptionalVersionId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}

function writeKnowledgeSourceOriginStatus(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: KnowledgeSourceOriginStatusResult,
  expectedSourceId: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.sourceId !== expectedSourceId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !["unbound", "current", "changed", "missing", "inaccessible"].includes(result.status)
  ) {
    throw new Error("The candidate knowledge source origin status result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      sourceId: expectedSourceId,
      checkedAt: result.checkedAt,
      status: result.status,
    }),
  );
}

function writeKnowledgeSourceRefreshState(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: KnowledgeSourceRefreshStateResult,
  expectedSourceId: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.sourceId !== expectedSourceId ||
    !["unobserved", "stale", "current", "changed", "missing", "inaccessible", "unbound"].includes(
      result.status,
    ) ||
    !isOptionalIsoTimestamp(result.checkedAt) ||
    !isOptionalIsoTimestamp(result.lastRefreshedAt) ||
    !isOptionalVersionId(result.observedVersionId) ||
    !isOptionalVersionId(result.lastRefreshedVersionId)
  ) {
    throw new Error("The candidate knowledge source refresh state result was invalid.");
  }
  const hasCheckedAt = result.checkedAt !== undefined;
  const hasObservedVersionId = result.observedVersionId !== undefined;
  const hasLastRefreshedAt = result.lastRefreshedAt !== undefined;
  const hasLastRefreshedVersionId = result.lastRefreshedVersionId !== undefined;
  if (
    hasCheckedAt !== hasObservedVersionId ||
    hasLastRefreshedAt !== hasLastRefreshedVersionId ||
    (result.status === "unobserved"
      ? hasCheckedAt || hasObservedVersionId || hasLastRefreshedAt || hasLastRefreshedVersionId
      : !hasCheckedAt || !hasObservedVersionId) ||
    (hasLastRefreshedAt &&
      Date.parse(result.lastRefreshedAt as string) > Date.parse(result.checkedAt as string))
  ) {
    throw new Error("The candidate knowledge source refresh state result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      sourceId: expectedSourceId,
      status: result.status,
      ...(result.checkedAt === undefined ? {} : { checkedAt: result.checkedAt }),
      ...(result.observedVersionId === undefined
        ? {}
        : { observedVersionId: result.observedVersionId }),
      ...(result.lastRefreshedAt === undefined ? {} : { lastRefreshedAt: result.lastRefreshedAt }),
      ...(result.lastRefreshedVersionId === undefined
        ? {}
        : { lastRefreshedVersionId: result.lastRefreshedVersionId }),
    }),
  );
}

function writeKnowledgeSourceOriginRefresh(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: KnowledgeSourceOriginRefreshResult,
  expectedSourceId: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.sourceId !== expectedSourceId ||
    !isValidIsoTimestamp(result.checkedAt) ||
    !["unbound", "current", "refreshed", "missing", "inaccessible"].includes(result.status) ||
    !isOptionalVersionId(result.versionId)
  ) {
    throw new Error("The candidate knowledge source refresh result was invalid.");
  }
  if (
    (result.status === "refreshed" && result.versionId === undefined) ||
    (result.status !== "refreshed" && result.versionId !== undefined)
  ) {
    throw new Error("The candidate knowledge source refresh result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      sourceId: expectedSourceId,
      checkedAt: result.checkedAt,
      status: result.status,
      ...(result.versionId === undefined ? {} : { versionId: result.versionId }),
    }),
  );
}

function writeKnowledgeSourceOriginRebind(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: KnowledgeSourceOriginRebindResult,
  expectedSourceId: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.sourceId !== expectedSourceId ||
    !["current", "rebound"].includes(result.status) ||
    !isValidIsoTimestamp(result.boundAt)
  ) {
    throw new Error("The candidate knowledge source rebind result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      sourceId: expectedSourceId,
      status: result.status,
      boundAt: result.boundAt,
    }),
  );
}

function writeKnowledgeSourceRetirement(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: KnowledgeSourceRetirementResult,
  expectedSourceId: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    result.sourceId !== expectedSourceId ||
    !["active", "retired"].includes(result.status)
  ) {
    throw new Error("The candidate knowledge source retirement result was invalid.");
  }
  const hasRetiredAt = Object.hasOwn(result, "retiredAt");
  const hasReason = Object.hasOwn(result, "reason");
  if (result.status === "active") {
    if (hasRetiredAt || hasReason) {
      throw new Error("The candidate knowledge source retirement result was invalid.");
    }
    writeJson(
      io,
      Object.freeze({
        knowledgeBaseId,
        sourceId: expectedSourceId,
        status: result.status,
      }),
    );
    return;
  }
  if (
    !hasRetiredAt ||
    !hasReason ||
    !isValidIsoTimestamp(result.retiredAt) ||
    result.reason !== "user-requested"
  ) {
    throw new Error("The candidate knowledge source retirement result was invalid.");
  }
  writeJson(
    io,
    Object.freeze({
      knowledgeBaseId,
      sourceId: expectedSourceId,
      status: result.status,
      retiredAt: result.retiredAt,
      reason: result.reason,
    }),
  );
}

function writeManagedKnowledgeInventory(
  io: ApplicationIo,
  inventory: Awaited<
    ReturnType<CandidateKnowledgeStoreService["inspectManagedCandidateKnowledgeFiles"]>
  >,
): void {
  writeJson(io, {
    schemaVersion: inventory.schemaVersion,
    verifiedManagedFileCount: inventory.verifiedManagedFileCount,
    scannedEntryCount: inventory.scannedEntryCount,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: inventory.unknownEntries.intakeShapedFilesAtSourcesRoot,
      opaqueEntriesAtSourcesRoot: inventory.unknownEntries.opaqueEntriesAtSourcesRoot,
      entriesInsideManagedSourceDirectories:
        inventory.unknownEntries.entriesInsideManagedSourceDirectories,
      symbolicLinks: inventory.unknownEntries.symbolicLinks,
      otherEntries: inventory.unknownEntries.otherEntries,
    },
    complete: inventory.complete,
    scanLimitReached: inventory.scanLimitReached,
  });
}

function writePortableKnowledgeBackupResult(
  io: ApplicationIo,
  result: Awaited<
    ReturnType<
      | CandidateKnowledgeStoreService["exportCandidateKnowledgeStore"]
      | CandidateKnowledgeStoreService["inspectCandidateKnowledgeBackup"]
    >
  >,
): void {
  writeJson(io, result);
}

function writeKnowledgeSelection(io: ApplicationIo, descriptor: WorkspaceDescriptor): void {
  const selections = descriptor.candidateKnowledgeSelection;
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error("The candidate knowledge selection was not persisted.");
  }
  io.write("knowledge selection configured:");
  for (const selection of [...selections].sort((left, right) => {
    const storeOrder = left.storeId.localeCompare(right.storeId);
    return storeOrder !== 0
      ? storeOrder
      : left.knowledgeBaseId.localeCompare(right.knowledgeBaseId);
  })) {
    io.write(`store ${selection.storeId} knowledge-base ${selection.knowledgeBaseId}`);
  }
}

export function createCli(dependencies: CliDependencies = {}): Command {
  const service = dependencies.service ?? applicationService;
  const candidateKnowledge = dependencies.knowledgeService ?? knowledgeService;
  const io = dependencies.io ?? stdoutIo;

  /** Reports the recorded independence claim, including that there is none. */
  const writeIndependentReview = async (statusCommand: StatusCommand): Promise<void> => {
    const record = await service.readIndependentReview(statusCommand);
    for (const line of independentReviewLines(record)) io.write(line);
  };

  const command = new Command()
    .name("draft-loop")
    .description("Local-first CV drafting and review workspace")
    .enablePositionalOptions()
    .version(packageJson.version)
    .showHelpAfterError();

  command
    .command("init")
    .description("Create a local workspace manifest")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("-j, --job-description <path>", "local job description file")
    .requiredOption("-s, --sources <path>", "local source directory")
    .option("--language <language>", "output language", "en")
    .option("--instructions <text>", "candidate instructions")
    .option("--truthfulness-policy <text>", "truthfulness policy")
    .option("--author-company <company>", "author provider company", "anthropic")
    .option("--author-model <model>", "exact author model id", "claude-sonnet-4-5")
    .option("--critic-company <company>", "critic provider company", "openai")
    .option("--critic-model <model>", "exact critic model id", "gpt-5.6-luna")
    .option(
      "--author-lineage <lineage>",
      "weights the author descends from; defaults to <company>:<model>",
    )
    .option(
      "--critic-lineage <lineage>",
      "weights the critic descends from; defaults to <company>:<model>",
    )
    .option(
      "--independence-override-rationale <text>",
      "why one lineage on both sides is acceptable; recorded with every run",
    )
    .option(
      "--local-endpoint <url>",
      "loopback base URL of the local model server, used when a company is 'local'",
    )
    .option(
      "--required-sections <sections>",
      "comma-separated required output sections",
      defaultRequiredSections.join(","),
    )
    .option("--max-rounds <number>", "maximum author/critic rounds", integerOption, 3)
    .option("--max-cost-usd <number>", "maximum estimated provider cost", numberOption)
    .option("--max-duration-ms <number>", "maximum run duration", integerOption)
    .option("--max-words <number>", "maximum output words", integerOption)
    .option("--max-characters <number>", "maximum output characters", integerOption)
    .option("--fixture", "use deterministic offline agents")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.initialize({
        root: workspaceRoot(workspace),
        jobDescription: options.jobDescription as string,
        sources: options.sources as string,
        language: options.language as string,
        ...(options.instructions === undefined
          ? {}
          : { instructions: options.instructions as string }),
        ...(options.truthfulnessPolicy === undefined
          ? {}
          : { truthfulnessPolicy: options.truthfulnessPolicy as string }),
        authorCompany: options.authorCompany as string,
        authorModel: options.authorModel as string,
        criticCompany: options.criticCompany as string,
        criticModel: options.criticModel as string,
        ...(options.authorLineage === undefined
          ? {}
          : { authorLineage: options.authorLineage as string }),
        ...(options.criticLineage === undefined
          ? {}
          : { criticLineage: options.criticLineage as string }),
        ...(options.independenceOverrideRationale === undefined
          ? {}
          : { independenceOverrideRationale: options.independenceOverrideRationale as string }),
        ...(options.localEndpoint === undefined
          ? {}
          : { localEndpoint: options.localEndpoint as string }),
        requiredSections: (options.requiredSections as string)
          .split(",")
          .map((section) => section.trim())
          .filter((section) => section !== ""),
        maxRounds: options.maxRounds as number,
        ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd as number }),
        ...(options.maxDurationMs === undefined
          ? {}
          : { maxDurationMs: options.maxDurationMs as number }),
        ...(options.maxWords === undefined ? {} : { maxWords: options.maxWords as number }),
        ...(options.maxCharacters === undefined
          ? {}
          : { maxCharacters: options.maxCharacters as number }),
        fixtureMode: boolOption(options, "fixture"),
      });
    });

  command
    .command("pilot")
    .description("Run the offline phase-0 pilot against synthetic fixture data")
    .argument("[workspace]", "new pilot workspace directory", "./draft-loop-pilot")
    .action(async (workspace: string) => {
      await runPilot(workspaceRoot(workspace));
    });

  command
    .command("pilot-report")
    .description(
      "Generate the sanitized consented-pilot summary from a private case file held outside the repository",
    )
    .argument("<case-file>", "path to the private consented case file")
    .argument(
      "[output]",
      "where to write the sanitized Markdown summary (default: next to the case file)",
    )
    .action(async (caseFile: string, output: string | undefined) => {
      await generateSanitizedPilotReport({
        casePath: caseFile,
        ...(output === undefined ? {} : { outputPath: output }),
      });
    });

  command
    .command("open")
    .description("Open a workspace and show its safe status")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (workspace: string) => {
      const root = workspaceRoot(workspace);
      await service.readWorkspace(root);
      await service.status({ root }, io);
      const readRunPolicy = requireWritingPolicyApi(service.readRunWritingPolicy, "run reads");
      writeRunWritingPolicy(io, await readRunPolicy({ root }));
      await writeIndependentReview({ root });
    });

  command
    .command("start")
    .description("Ingest local inputs and start a run, optionally from one reviewed opportunity")
    .argument("[workspace]", "workspace directory", ".")
    .option("--opportunity-brief-id <id>", "exact reviewed opportunity brief id")
    .option(
      "--opportunity-version <number>",
      "exact reviewed opportunity version",
      positiveIntegerOption,
    )
    .option(
      "--writing-policy-override <checksum>",
      "exact lowercase SHA-256 policy version for a reviewed opportunity",
      writingPolicyChecksumOption,
    )
    .option("--candidate-profile-id <id>", "exact reviewed candidate profile id")
    .option(
      "--candidate-profile-version <number>",
      "exact reviewed candidate profile version",
      positiveIntegerOption,
    )
    .option("--allow-provider-data", "explicitly approve transmission of sensitive material")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const hasBriefId = options.opportunityBriefId !== undefined;
      const hasVersion = options.opportunityVersion !== undefined;
      if (hasBriefId !== hasVersion) {
        throw new Error(
          "--opportunity-brief-id and --opportunity-version must be provided together.",
        );
      }
      const hasPolicyOverride = options.writingPolicyOverride !== undefined;
      if (hasPolicyOverride && !hasBriefId) {
        throw new Error(
          "--writing-policy-override requires --opportunity-brief-id and --opportunity-version.",
        );
      }
      const hasCandidateProfileId = options.candidateProfileId !== undefined;
      const hasCandidateProfileVersion = options.candidateProfileVersion !== undefined;
      if (hasCandidateProfileId !== hasCandidateProfileVersion) {
        throw new Error(
          "--candidate-profile-id and --candidate-profile-version must be provided together.",
        );
      }
      await service.start({
        root: workspaceRoot(workspace),
        ...(hasBriefId
          ? {
              opportunityBrief: {
                briefId: options.opportunityBriefId as string,
                version: options.opportunityVersion as number,
              },
            }
          : {}),
        ...(hasCandidateProfileId
          ? {
              candidateProfile: {
                profileId: options.candidateProfileId as string,
                version: options.candidateProfileVersion as number,
              },
            }
          : {}),
        ...(hasPolicyOverride
          ? { writingPolicyOverrideChecksum: options.writingPolicyOverride as string }
          : {}),
        allowProviderData: boolOption(options, "allowProviderData"),
      });
    });

  command
    .command("resume")
    .description("Resume the latest or selected interrupted run")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to resume")
    .option("--allow-provider-data", "explicitly approve transmission of sensitive material")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.resume({
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        allowProviderData: boolOption(options, "allowProviderData"),
      });
    });

  for (const [name, description, action] of [
    ["pause", "Pause an active run", "pause"],
    ["stop", "Stop an active run", "stop"],
    ["recover", "Return to review after a provider failure", "recover-review"],
    ["approve", "Approve a run awaiting review", "approve"],
    ["revise", "Request another author revision", "revision"],
  ] as const) {
    command
      .command(name)
      .description(description)
      .argument("[workspace]", "workspace directory", ".")
      .option("--run-id <id>", "run id to update")
      .action(async (workspace: string, options: Record<string, unknown>) => {
        await service.lifecycle({
          root: workspaceRoot(workspace),
          action,
          ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        });
      });
  }

  command
    .command("status")
    .description("Inspect a run without printing prompts or source content")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to inspect")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const statusCommand: StatusCommand = {
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
      };
      await service.status(statusCommand, io);
      const readRunPolicy = requireWritingPolicyApi(service.readRunWritingPolicy, "run reads");
      writeRunWritingPolicy(io, await readRunPolicy(statusCommand));
      await writeIndependentReview(statusCommand);
    });

  const policy = command
    .command("policy")
    .description("Import and inspect immutable writing-policy versions");

  policy
    .command("activate")
    .description("Import a local policy file and activate it for future runs")
    .argument("<file>", "local writing-policy file")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (file: string, workspace: string) => {
      await configureAndWritePolicy(service, io, file, workspaceRoot(workspace), true);
    });

  policy
    .command("import")
    .description("Import a local policy file without changing the active workspace policy")
    .argument("<file>", "local writing-policy file")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (file: string, workspace: string) => {
      await configureAndWritePolicy(service, io, file, workspaceRoot(workspace), false);
    });

  policy
    .command("current")
    .description("Show the active writing-policy metadata, or exact content with --content")
    .argument("[workspace]", "workspace directory", ".")
    .option("--content", "print the exact local policy content")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const getWritingPolicy = requireWritingPolicyApi(service.getWritingPolicy, "reads");
      const version = await getWritingPolicy({
        root: workspaceRoot(workspace),
        ...(boolOption(options, "content") ? { includeContent: true } : {}),
      });
      if (version === undefined) {
        io.write("No active writing policy.");
        return;
      }
      writeWritingPolicyVersion(io, version, boolOption(options, "content"));
    });

  policy
    .command("show")
    .description("Show one exact writing-policy version, or content with --content")
    .argument("<checksum>", "lowercase SHA-256 policy checksum")
    .argument("[workspace]", "workspace directory", ".")
    .option("--content", "print the exact local policy content")
    .action(async (checksum: string, workspace: string, options: Record<string, unknown>) => {
      const getWritingPolicy = requireWritingPolicyApi(service.getWritingPolicy, "reads");
      const version = await getWritingPolicy({
        root: workspaceRoot(workspace),
        checksum: writingPolicyChecksumOption(checksum),
        ...(boolOption(options, "content") ? { includeContent: true } : {}),
      });
      if (version === undefined) {
        io.write(`Writing policy ${checksum} was not found.`);
        return;
      }
      writeWritingPolicyVersion(io, version, boolOption(options, "content"));
    });

  policy
    .command("list")
    .description("List immutable writing-policy history without policy content")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (workspace: string) => {
      const listWritingPolicyVersions = requireWritingPolicyApi(
        service.listWritingPolicyVersions,
        "history",
      );
      const versions = await listWritingPolicyVersions({ root: workspaceRoot(workspace) });
      if (versions.length === 0) {
        io.write("No writing policy versions.");
        return;
      }
      for (const version of versions) writeWritingPolicyVersion(io, version);
    });

  command
    .command("export")
    .description("Render an approved artifact to a local document")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to export")
    .option("--output <path>", "local output path")
    .option("--format <format>", "output format: markdown, pdf, or docx", "markdown")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.export({
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        ...(options.output === undefined ? {} : { outputPath: options.output as string }),
        format: options.format as "markdown" | "pdf" | "docx",
      });
    });

  const opportunity = command
    .command("opportunity")
    .description("Create and review a versioned opportunity brief");

  opportunity
    .command("create")
    .description("Create one opportunity from approved source descriptors in a JSON file")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--input <path>", "JSON file containing id and sources")
    .option("--allow-provider-data", "explicitly approve structured provider extraction")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const input = await readJsonObject(options.input as string, "Opportunity input");
      if (typeof input.id !== "string" || !Array.isArray(input.sources)) {
        throw new Error("Opportunity input requires an id and sources array.");
      }
      const record = await service.createOpportunity({
        root: workspaceRoot(workspace),
        id: input.id,
        sources: input.sources as OpportunitySourceInput[],
        ...(typeof input.createdAt === "string" ? { createdAt: input.createdAt } : {}),
        allowProviderData: boolOption(options, "allowProviderData"),
      });
      writeJson(io, record);
    });

  opportunity
    .command("get")
    .description("Read the latest or an exact opportunity version")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--brief-id <id>", "opportunity brief id")
    .option("--version <number>", "exact version; omit to reload latest", integerOption)
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const record = await service.getOpportunity({
        root: workspaceRoot(workspace),
        briefId: options.briefId as string,
        ...(options.version === undefined ? {} : { version: options.version as number }),
      });
      writeJson(io, record ?? null);
    });

  opportunity
    .command("list")
    .description("List immutable versions of an opportunity brief")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--brief-id <id>", "opportunity brief id")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      writeJson(
        io,
        await service.listOpportunityVersions({
          root: workspaceRoot(workspace),
          briefId: options.briefId as string,
        }),
      );
    });

  opportunity
    .command("edit")
    .description("Create an immutable edited draft version from the current latest version")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--brief-id <id>", "opportunity brief id")
    .requiredOption("--expected-version <number>", "latest version being edited", integerOption)
    .requiredOption("--patch <path>", "JSON file containing editable brief fields")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const patch = await readJsonObject(options.patch as string, "Opportunity patch");
      const record = await service.editOpportunity({
        root: workspaceRoot(workspace),
        briefId: options.briefId as string,
        expectedVersion: options.expectedVersion as number,
        patch: patch as OpportunityDraftPatch,
      });
      writeJson(io, record);
    });

  opportunity
    .command("review")
    .description("Create a reviewed version from the current complete draft")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--brief-id <id>", "opportunity brief id")
    .requiredOption(
      "--expected-version <number>",
      "latest draft version being reviewed",
      integerOption,
    )
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const record = await service.reviewOpportunity({
        root: workspaceRoot(workspace),
        briefId: options.briefId as string,
        expectedVersion: options.expectedVersion as number,
      });
      writeJson(io, record);
    });

  const profile = command
    .command("profile")
    .description("Derive and review an immutable canonical candidate profile");

  profile
    .command("derive")
    .description("Derive a canonical candidate profile from the configured knowledge selection")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--profile-id <id>", "canonical candidate profile id")
    .option("--allow-provider-data", "explicitly approve structured provider extraction")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const record = await service.deriveCanonicalCandidateProfile({
        root: workspaceRoot(workspace),
        profileId: options.profileId as string,
        allowProviderData: boolOption(options, "allowProviderData"),
      });
      writeJson(io, record);
    });

  profile
    .command("get")
    .description("Read the latest or an exact canonical candidate profile version")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--profile-id <id>", "canonical candidate profile id")
    .option("--version <number>", "exact version; omit to reload latest", integerOption)
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const record = await service.getCanonicalCandidateProfile({
        root: workspaceRoot(workspace),
        profileId: options.profileId as string,
        ...(options.version === undefined ? {} : { version: options.version as number }),
      });
      writeJson(io, record ?? null);
    });

  profile
    .command("list")
    .description("List immutable canonical candidate profile versions")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--profile-id <id>", "canonical candidate profile id")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      writeJson(
        io,
        await service.listCanonicalCandidateProfileVersions({
          root: workspaceRoot(workspace),
          profileId: options.profileId as string,
        }),
      );
    });

  profile
    .command("edit")
    .description("Create an immutable edited draft profile version")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--profile-id <id>", "canonical candidate profile id")
    .requiredOption("--expected-version <number>", "latest version being edited", integerOption)
    .requiredOption("--patch <path>", "JSON file containing editable profile fields")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const patch = await readJsonObject(
        options.patch as string,
        "Canonical candidate profile patch",
      );
      const record = await service.editCanonicalCandidateProfile({
        root: workspaceRoot(workspace),
        profileId: options.profileId as string,
        expectedVersion: options.expectedVersion as number,
        patch: patch as CanonicalCandidateProfilePatch,
      });
      writeJson(io, record);
    });

  profile
    .command("review")
    .description("Create a reviewed version from the current complete profile draft")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("--profile-id <id>", "canonical candidate profile id")
    .requiredOption(
      "--expected-version <number>",
      "latest draft version being reviewed",
      integerOption,
    )
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const record = await service.reviewCanonicalCandidateProfile({
        root: workspaceRoot(workspace),
        profileId: options.profileId as string,
        expectedVersion: options.expectedVersion as number,
      });
      writeJson(io, record);
    });

  const knowledge = command
    .command("knowledge")
    .description("Manage local candidate-knowledge stores and lifecycle readiness");
  const knowledgeStore = knowledge.command("store").description("Open and inspect a local store");

  knowledgeStore
    .command("init")
    .alias("create-default")
    .description("Initialize a local store with its default knowledge base")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .option("--display-name <name>", "default knowledge-base display name")
    .option("--description <text>", "default knowledge-base description")
    .action(async (storeRoot: string, options: Record<string, unknown>) => {
      const view = await candidateKnowledge.initializeStore({
        storeRoot,
        ...(options.displayName === undefined
          ? {}
          : { displayName: options.displayName as string }),
        ...(options.description === undefined
          ? {}
          : { description: options.description as string }),
      });
      writeKnowledgeStoreView(io, "initialized", view);
    });

  for (const [name, action] of [
    ["open", "opened"],
    ["list", "listed"],
  ] as const) {
    knowledgeStore
      .command(name)
      .description(name === "open" ? "Open a local store" : "List knowledge bases in a local store")
      .argument("<store-root>", "local candidate-knowledge store directory")
      .action(async (storeRoot: string) => {
        const view = await (name === "open"
          ? candidateKnowledge.openStore({ storeRoot })
          : candidateKnowledge.listKnowledgeBases({ storeRoot }));
        writeKnowledgeStoreView(io, action, view);
      });
  }

  knowledgeStore
    .command("inventory")
    .description("Inspect managed-file inventory counts without exposing local paths")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .action(async (storeRoot: string) => {
      writeManagedKnowledgeInventory(
        io,
        await candidateKnowledge.inspectManagedCandidateKnowledgeFiles({ storeRoot }),
      );
    });

  knowledgeStore
    .command("backup")
    .description("Export a verified portable backup to a new local directory")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<destination>", "new portable backup directory")
    .option("--yes", "approve writing the complete CKB backup to this destination")
    .action(async (storeRoot: string, destination: string, options: Record<string, unknown>) => {
      if (options.yes !== true) {
        throw new Error("knowledge store backup requires --yes destination approval.");
      }
      writePortableKnowledgeBackupResult(
        io,
        await candidateKnowledge.exportCandidateKnowledgeStore({
          storeRoot,
          destination,
          approved: true,
        }),
      );
    });

  knowledgeStore
    .command("inspect-backup")
    .description("Verify a portable backup before restore")
    .argument("<package-path>", "portable backup directory")
    .action(async (packagePath: string) => {
      writePortableKnowledgeBackupResult(
        io,
        await candidateKnowledge.inspectCandidateKnowledgeBackup({ packagePath }),
      );
    });

  knowledgeStore
    .command("restore")
    .description("Restore a verified portable backup into a new local store directory")
    .argument("<package-path>", "portable backup directory")
    .argument("<destination>", "new candidate-knowledge store directory")
    .requiredOption("--collision <policy>", "collision policy (must be fail-if-destination-exists)")
    .option("--yes", "approve restoring the complete CKB backup to this destination")
    .action(async (packagePath: string, destination: string, options: Record<string, unknown>) => {
      if (options.yes !== true) {
        throw new Error("knowledge store restore requires --yes destination approval.");
      }
      if (options.collision !== "fail-if-destination-exists") {
        throw new Error("knowledge store restore requires --collision fail-if-destination-exists.");
      }
      writeJson(
        io,
        await candidateKnowledge.restoreCandidateKnowledgeStore({
          packagePath,
          destination,
          collision: "fail-if-destination-exists",
          approved: true,
        }),
      );
    });

  const knowledgeBase = knowledge
    .command("base")
    .description("Create and maintain knowledge bases in a local store");
  knowledgeBase
    .command("create")
    .description("Create a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<display-name>", "knowledge-base display name")
    .option("--description <text>", "knowledge-base description")
    .action(async (storeRoot: string, displayName: string, options: Record<string, unknown>) => {
      const view = await candidateKnowledge.createKnowledgeBase({
        storeRoot,
        displayName,
        ...(options.description === undefined
          ? {}
          : { description: options.description as string }),
      });
      writeKnowledgeStoreView(io, "base-created", view);
    });

  knowledgeBase
    .command("rename")
    .description("Rename a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<display-name>", "new knowledge-base display name")
    .action(async (storeRoot: string, knowledgeBaseId: string, displayName: string) => {
      const view = await candidateKnowledge.renameKnowledgeBase({
        storeRoot,
        knowledgeBaseId,
        displayName,
      });
      writeKnowledgeStoreView(io, "base-renamed", view);
    });

  knowledgeBase
    .command("archive")
    .description("Archive a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .option("--confirm", "confirm archival, which may invalidate configured workspace selections")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, options: Record<string, unknown>) => {
        if (options.confirm !== true) {
          throw new Error("knowledge base archive requires --confirm.");
        }
        const view = await candidateKnowledge.archiveKnowledgeBase({
          storeRoot,
          knowledgeBaseId,
        });
        writeKnowledgeStoreView(io, "base-archived", view);
      },
    );

  knowledgeBase
    .command("delete-preview")
    .description("Preview confirmed deletion of one archived non-default knowledge base")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      writeJson(
        io,
        await candidateKnowledge.previewKnowledgeBaseDeletion({ storeRoot, knowledgeBaseId }),
      );
    });

  knowledgeBase
    .command("delete")
    .description("Delete an archived knowledge base using its exact preview token")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .requiredOption("--confirmation-token <token>", "exact token from delete-preview")
    .option("--yes", "approve deletion of the exact previewed data")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, options: Record<string, unknown>) => {
        if (options.yes !== true) {
          throw new Error("knowledge base deletion requires --yes explicit approval.");
        }
        writeJson(
          io,
          await candidateKnowledge.deleteKnowledgeBase({
            storeRoot,
            knowledgeBaseId,
            confirmationToken: options.confirmationToken as string,
            approved: true,
          }),
        );
      },
    );

  const knowledgeSource = knowledge
    .command("source")
    .description("Import, refresh, and inspect candidate knowledge sources");
  knowledgeSource
    .command("import")
    .description("Import one explicitly selected local source file")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-path>", "local source file path")
    .option("--display-name <name>", "optional source display name")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourcePath: string,
        options: Record<string, unknown>,
      ) => {
        const result = await candidateKnowledge.importKnowledgeSourceFile({
          storeRoot,
          knowledgeBaseId,
          sourcePath,
          ...(options.displayName === undefined
            ? {}
            : { displayName: options.displayName as string }),
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "file");
      },
    );

  knowledgeSource
    .command("import-directory")
    .description("Import an explicitly selected local directory recursively")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-path>", "local source directory path")
    .action(async (storeRoot: string, knowledgeBaseId: string, directoryPath: string) => {
      const result = await candidateKnowledge.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId,
        directoryPath,
      });
      writeKnowledgeSourceDirectoryImport(io, knowledgeBaseId, result);
    });

  knowledgeSource
    .command("directory-refresh-preview")
    .description("Preview one bounded directory refresh without changing stored state")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.previewKnowledgeSourceDirectoryRefresh({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryRefresh(io, knowledgeBaseId, directoryId, result, "preview");
      },
    );

  knowledgeSource
    .command("directory-refresh-apply")
    .description("Apply one bounded directory refresh after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .option("--confirm", "confirm applying the directory refresh")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source directory-refresh-apply requires --confirm.");
        }
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.applyKnowledgeSourceDirectoryRefresh({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryRefresh(io, knowledgeBaseId, directoryId, result, "apply");
      },
    );

  knowledgeSource
    .command("directory-add-members")
    .description("Add newly discovered directory members after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .option("--confirm", "confirm adding newly discovered directory members")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source directory-add-members requires --confirm.");
        }
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.addKnowledgeSourceDirectoryMembers({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryAddMembers(io, knowledgeBaseId, directoryId, result);
      },
    );

  knowledgeSource
    .command("directory-reconciliation-preview")
    .description("Preview directory reconciliation without changing stored state")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.previewKnowledgeSourceDirectoryReconciliation({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryReconciliationPreview(
          io,
          knowledgeBaseId,
          directoryId,
          result,
        );
      },
    );

  knowledgeSource
    .command("directory-reconciliation-apply")
    .description("Apply approved directory reconciliation retirements after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option(
      "--approved-retirement-source-id <source-id>",
      "approve retiring one opaque source id; repeat for each approved retirement",
      repeatedStringOption,
      [],
    )
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .option("--confirm", "confirm applying approved directory reconciliation retirements")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source directory-reconciliation-apply requires --confirm.");
        }
        const ingestionOptions = directoryIngestionOptions(options);
        const approvedRetirementSourceIds = Array.isArray(options.approvedRetirementSourceId)
          ? (options.approvedRetirementSourceId as string[])
          : [];
        const result = await candidateKnowledge.applyKnowledgeSourceDirectoryReconciliation({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          approvedRetirementSourceIds,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryReconciliationApply(
          io,
          knowledgeBaseId,
          directoryId,
          approvedRetirementSourceIds,
          result,
        );
      },
    );

  knowledgeSource
    .command("directory-moved-candidates")
    .description("Preview directory members whose origins appear to have moved")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        options: Record<string, unknown>,
      ) => {
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.previewKnowledgeSourceDirectoryMovedCandidates({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryMovedCandidates(io, knowledgeBaseId, directoryId, result);
      },
    );

  knowledgeSource
    .command("directory-member-move")
    .description("Move one directory member after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .argument("<source-id>", "opaque file source id")
    .option("--max-depth <number>", "maximum directory depth", integerOption)
    .option("--max-scanned-entries <number>", "maximum scanned directory entries", integerOption)
    .option("--max-accepted-files <number>", "maximum accepted directory files", integerOption)
    .option("--max-accepted-bytes <number>", "maximum accepted directory bytes", integerOption)
    .option("--max-source-bytes <number>", "maximum bytes per source file", integerOption)
    .option("--max-chunk-characters <number>", "maximum extracted chunk characters", integerOption)
    .option("--confirm", "confirm moving the directory member")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        sourceId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source directory-member-move requires --confirm.");
        }
        const ingestionOptions = directoryIngestionOptions(options);
        const result = await candidateKnowledge.applyKnowledgeSourceDirectoryMemberMove({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          sourceId,
          ...(ingestionOptions === undefined ? {} : { options: ingestionOptions }),
        });
        writeKnowledgeSourceDirectoryMemberMove(io, knowledgeBaseId, directoryId, sourceId, result);
      },
    );

  knowledgeSource
    .command("directory-rebind-preview")
    .description("Preview rebinding one directory root without changing stored state")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .argument("<directory-path>", "candidate local directory path")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        directoryPath: string,
      ) => {
        const result = await candidateKnowledge.previewKnowledgeSourceDirectoryRootRebind({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          directoryPath,
        });
        writeKnowledgeSourceDirectoryRootRebind(io, knowledgeBaseId, directoryId, result, [
          "current",
          "ready",
        ]);
      },
    );

  knowledgeSource
    .command("directory-rebind-apply")
    .description("Apply rebinding one directory root after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<directory-id>", "opaque directory id")
    .argument("<directory-path>", "candidate local directory path")
    .option("--confirm", "confirm the directory-root rebind")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        directoryId: string,
        directoryPath: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source directory-rebind-apply requires --confirm.");
        }
        const result = await candidateKnowledge.applyKnowledgeSourceDirectoryRootRebind({
          storeRoot,
          knowledgeBaseId,
          directoryId,
          directoryPath,
        });
        writeKnowledgeSourceDirectoryRootRebind(io, knowledgeBaseId, directoryId, result, [
          "current",
          "rebound",
        ]);
      },
    );

  knowledgeSource
    .command("import-url")
    .description("Import one explicitly approved URL into a local candidate-knowledge store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<url>", "source URL")
    .option("--approve", "approve retrieving and storing this URL")
    .option("--display-name <name>", "optional source display name")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        url: string,
        options: Record<string, unknown>,
      ) => {
        if (options.approve !== true) {
          throw new Error("knowledge source import-url requires --approve.");
        }
        const result = await candidateKnowledge.importKnowledgeSourceUrl({
          storeRoot,
          knowledgeBaseId,
          url,
          approved: true,
          ...(options.displayName === undefined
            ? {}
            : { displayName: options.displayName as string }),
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "url");
      },
    );

  knowledgeSource
    .command("append-file-version")
    .description("Append one explicitly selected local file as a source version")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque file source id")
    .argument("<source-path>", "local source file path")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, sourceId: string, sourcePath: string) => {
        const result = await candidateKnowledge.appendKnowledgeSourceFileVersion({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          sourcePath,
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "file", sourceId);
      },
    );

  knowledgeSource
    .command("origin-status")
    .description("Check one remembered local file origin without exposing its path")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .action(async (storeRoot: string, knowledgeBaseId: string, sourceId: string) => {
      const result = await candidateKnowledge.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId,
        sourceId,
      });
      writeKnowledgeSourceOriginStatus(io, knowledgeBaseId, result, sourceId);
    });

  knowledgeSource
    .command("refresh-state")
    .description("Read one path-free remembered source refresh state")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .action(async (storeRoot: string, knowledgeBaseId: string, sourceId: string) => {
      const result = await candidateKnowledge.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId,
        sourceId,
      });
      writeKnowledgeSourceRefreshState(io, knowledgeBaseId, result, sourceId);
    });

  knowledgeSource
    .command("refresh-file")
    .description("Refresh one remembered local file origin explicitly")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .action(async (storeRoot: string, knowledgeBaseId: string, sourceId: string) => {
      const result = await candidateKnowledge.refreshKnowledgeSourceFromOrigin({
        storeRoot,
        knowledgeBaseId,
        sourceId,
      });
      writeKnowledgeSourceOriginRefresh(io, knowledgeBaseId, result, sourceId);
    });

  knowledgeSource
    .command("refresh-url")
    .description("Refresh one explicitly approved URL source")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .option("--approve", "approve retrieving and storing this URL")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourceId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.approve !== true) {
          throw new Error("knowledge source refresh-url requires --approve.");
        }
        const result = await candidateKnowledge.refreshKnowledgeSourceUrl({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          approved: true,
        });
        writeKnowledgeSourceOriginRefresh(io, knowledgeBaseId, result, sourceId);
      },
    );

  knowledgeSource
    .command("rebind-file")
    .description("Rebind one file source to an explicitly selected local path")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque file source id")
    .argument("<source-path>", "local source file path")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, sourceId: string, sourcePath: string) => {
        const result = await candidateKnowledge.rebindKnowledgeSourceOrigin({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          sourcePath,
        });
        writeKnowledgeSourceOriginRebind(io, knowledgeBaseId, result, sourceId);
      },
    );

  knowledgeSource
    .command("retirement-state")
    .description("Read one path-free source retirement state")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .action(async (storeRoot: string, knowledgeBaseId: string, sourceId: string) => {
      const result = await candidateKnowledge.getKnowledgeSourceRetirement({
        storeRoot,
        knowledgeBaseId,
        sourceId,
      });
      writeKnowledgeSourceRetirement(io, knowledgeBaseId, result, sourceId);
    });

  knowledgeSource
    .command("retire")
    .description("Retire one source after explicit confirmation")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .option("--confirm", "confirm logical source retirement")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourceId: string,
        options: Record<string, unknown>,
      ) => {
        if (options.confirm !== true) {
          throw new Error("knowledge source retire requires --confirm.");
        }
        const result = await candidateKnowledge.retireKnowledgeSource({
          storeRoot,
          knowledgeBaseId,
          sourceId,
        });
        if (result.status !== "retired") {
          throw new Error("The candidate knowledge source retirement result was invalid.");
        }
        writeKnowledgeSourceRetirement(io, knowledgeBaseId, result, sourceId);
      },
    );

  knowledgeSource
    .command("list")
    .description("List source kinds and version identities")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      writeKnowledgeSourceManifests(
        io,
        knowledgeBaseId,
        await candidateKnowledge.listKnowledgeSourceManifests({ storeRoot, knowledgeBaseId }),
      );
    });

  knowledgeSource
    .command("duplicates")
    .description("List duplicate source/version identities")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      writeKnowledgeSourceDuplicateGroups(
        io,
        knowledgeBaseId,
        await candidateKnowledge.listKnowledgeSourceDuplicateGroups({ storeRoot, knowledgeBaseId }),
      );
    });

  const lifecycle = knowledge
    .command("lifecycle")
    .description("Inspect candidate-knowledge lifecycle state");
  lifecycle
    .command("readiness")
    .description("Report path-free lifecycle readiness for one knowledge base")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      const readiness = await candidateKnowledge.getKnowledgeBaseLifecycleReadiness({
        storeRoot,
        knowledgeBaseId,
      });
      writeKnowledgeBaseReadiness(io, readiness);
    });

  knowledge
    .command("select")
    .description("Persist an explicit local candidate-knowledge selection for a workspace")
    .argument("<workspace>", "workspace directory")
    .argument("[selection...]", "repeated <store-root> <knowledge-base-id> pairs")
    .option("--approve-combination", "approve combining more than one store/knowledge base")
    .action(async (workspace: string, selection: string[], options: Record<string, unknown>) => {
      if (selection.length === 0 || selection.length % 2 !== 0) {
        throw new Error(
          "knowledge select requires one or more <store-root> <knowledge-base-id> pairs.",
        );
      }

      const entries: {
        readonly storeRoot: string;
        readonly storeId: string;
        readonly knowledgeBaseId: string;
      }[] = [];
      for (let index = 0; index < selection.length; index += 2) {
        const storeRoot = selection[index];
        const knowledgeBaseId = selection[index + 1];
        if (storeRoot === undefined || knowledgeBaseId === undefined) {
          throw new Error(
            "knowledge select requires one or more <store-root> <knowledge-base-id> pairs.",
          );
        }
        const view = await candidateKnowledge.openStore({ storeRoot });
        if (typeof view.store.id !== "string" || view.store.id.trim() === "") {
          throw new Error("The candidate knowledge store identity could not be verified.");
        }
        entries.push({ storeRoot, storeId: view.store.id, knowledgeBaseId });
      }

      const descriptor = await service.configureKnowledgeSelection({
        root: workspaceRoot(workspace),
        entries,
        ...(options.approveCombination === true ? { combinationApproved: true } : {}),
      });
      writeKnowledgeSelection(io, descriptor);
    });

  return command;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  try {
    await createCli().parseAsync(argv);
  } catch (error) {
    console.error(`error: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}
