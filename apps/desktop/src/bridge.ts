/**
 * Renderer-safe contracts for the desktop capability boundary.
 *
 * This module deliberately contains no filesystem, shell, provider SDK, or
 * credential implementation. A packaged host can implement NativeBridge
 * behind this contract; the renderer only receives bounded, serializable
 * projections.
 */

import type { DesktopReviewState, ReviewAction } from "./model.js";

export const bridgeCapabilities = [
  "workspace.open",
  "workspace.create",
  "run.status",
  "run.start",
  "run.pause",
  "run.resume",
  "run.stop",
  "review.load",
  "review.dispatch",
  "file.select",
  "export.write",
  "credential.status",
  "credential.set",
  "credential.remove",
] as const;

export type BridgeCapability = (typeof bridgeCapabilities)[number];

export const supportedFileExtensions = [
  ".docx",
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".pdf",
  ".text",
  ".txt",
] as const;

export type SupportedFileExtension = (typeof supportedFileExtensions)[number];

export const supportedMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "text/markdown",
  "text/plain",
] as const;

export type SupportedMediaType = (typeof supportedMediaTypes)[number];

export const exportFormats = ["docx", "markdown", "pdf"] as const;
export type ExportFormat = (typeof exportFormats)[number];

export const credentialProviders = ["anthropic", "openai"] as const;
export type CredentialProvider = (typeof credentialProviders)[number];

export const runStates = [
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
  "awaiting-approval",
  "approved",
  "exported",
  "paused",
  "stopped",
  "budget-exhausted",
] as const;

export type BridgeRunState = (typeof runStates)[number];
export type RunApproval = "pending" | "approved" | "rejected";

export interface WorkspaceOpenInput {
  /** The native host owns the folder picker; no filesystem path crosses this API. */
  readonly selection?: "native-dialog";
}

export interface WorkspaceCreateInput {
  /** A display name only. The native host owns the destination folder picker. */
  readonly name: string;
}

export interface RunStatusInput {
  readonly workspaceId: string;
  readonly runId?: string;
}

export interface RunStartInput {
  readonly workspaceId: string;
}

export interface RunLifecycleInput {
  readonly workspaceId: string;
  readonly runId: string;
}

export interface ReviewLoadInput {
  readonly workspaceId?: string;
  readonly runId?: string;
}

export interface ReviewDispatchInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly action: ReviewAction;
}

export interface FileSelectInput {
  readonly workspaceId: string;
  readonly extensions?: readonly SupportedFileExtension[];
  readonly multiple?: boolean;
}

export interface ExportWriteInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  /** Workspace-relative and, when supplied, restricted to the exports folder. */
  readonly relativePath?: string;
}

export interface CredentialStatusInput {
  readonly provider: CredentialProvider;
}

/** The native host collects the value in its secure UI; no secret is accepted here. */
export interface CredentialSetInput {
  readonly provider: CredentialProvider;
}

export interface CredentialRemoveInput {
  readonly provider: CredentialProvider;
}

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceResult {
  readonly workspace: WorkspaceSummary;
}

export interface RunStatus {
  readonly workspaceId: string;
  readonly runId: string | null;
  readonly state: BridgeRunState;
  readonly round: number;
  readonly approval: RunApproval;
}

export type ReviewStateResult = DesktopReviewState;

export interface SelectedFile {
  readonly id: string;
  readonly name: string;
  readonly relativePath: string;
  readonly mediaType: SupportedMediaType;
  readonly byteLength: number;
}

export interface FileSelectResult {
  readonly files: readonly SelectedFile[];
}

export interface ExportResult {
  readonly exportId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  readonly relativePath: string;
}

export interface CredentialStatus {
  readonly provider: CredentialProvider;
  readonly configured: boolean;
}

export type CredentialResult = CredentialStatus;

export interface BridgeCommandInputMap {
  "workspace.open": WorkspaceOpenInput;
  "workspace.create": WorkspaceCreateInput;
  "run.status": RunStatusInput;
  "run.start": RunStartInput;
  "run.pause": RunLifecycleInput;
  "run.resume": RunLifecycleInput;
  "run.stop": RunLifecycleInput;
  "review.load": ReviewLoadInput;
  "review.dispatch": ReviewDispatchInput;
  "file.select": FileSelectInput;
  "export.write": ExportWriteInput;
  "credential.status": CredentialStatusInput;
  "credential.set": CredentialSetInput;
  "credential.remove": CredentialRemoveInput;
}

export interface BridgeCommandOutputMap {
  "workspace.open": WorkspaceResult;
  "workspace.create": WorkspaceResult;
  "run.status": RunStatus;
  "run.start": RunStatus;
  "run.pause": RunStatus;
  "run.resume": RunStatus;
  "run.stop": RunStatus;
  "review.load": ReviewStateResult;
  "review.dispatch": ReviewStateResult;
  "file.select": FileSelectResult;
  "export.write": ExportResult;
  "credential.status": CredentialStatus;
  "credential.set": CredentialResult;
  "credential.remove": CredentialResult;
}

export type BridgeCommandName = keyof BridgeCommandInputMap;

export type BridgeCommand = {
  [Name in BridgeCommandName]: {
    readonly type: Name;
    readonly input: BridgeCommandInputMap[Name];
  };
}[BridgeCommandName];

export type BridgeOutput<Command extends BridgeCommand> = BridgeCommandOutputMap[Command["type"]];

export type BridgeErrorCode =
  | "invalid-command"
  | "invalid-input"
  | "capability-unavailable"
  | "permission-denied"
  | "not-found"
  | "operation-failed";

export interface BridgeError {
  readonly code: BridgeErrorCode;
  readonly message: string;
  readonly capability?: BridgeCapability;
}

export type BridgeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: BridgeError };

export interface NativeBridge {
  /** Hosts may advertise only capabilities from bridgeCapabilities. */
  readonly capabilities: ReadonlySet<BridgeCapability> | readonly BridgeCapability[];
  readonly invoke: (command: BridgeCommand) => Promise<BridgeResult<unknown>>;
}

export interface CapabilityPort {
  readonly capabilities: readonly BridgeCapability[];
  readonly hasCapability: (capability: BridgeCapability) => boolean;
  readonly execute: <Command extends BridgeCommand>(
    command: Command,
  ) => Promise<BridgeResult<BridgeOutput<Command>>>;
}

const errorMessages: Readonly<Record<BridgeErrorCode, string>> = {
  "invalid-command": "The desktop command is not supported.",
  "invalid-input": "The desktop command input is invalid.",
  "capability-unavailable": "This desktop capability is unavailable in the current host.",
  "permission-denied": "The desktop host denied this operation.",
  "not-found": "The requested desktop resource was not found.",
  "operation-failed": "The desktop operation could not be completed.",
};

const fileMediaTypeByExtension: Readonly<Record<SupportedFileExtension, SupportedMediaType>> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".text": "text/plain",
  ".txt": "text/plain",
};

const exportExtensionByFormat: Readonly<Record<ExportFormat, string>> = {
  docx: ".docx",
  markdown: ".md",
  pdf: ".pdf",
};

const commandNames = new Set<BridgeCommandName>(bridgeCapabilities);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function invalidInput(): never {
  throw new BridgeValidationError("invalid-input");
}

function invalidCommand(): never {
  throw new BridgeValidationError("invalid-command");
}

function stringValue(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return invalidInput();
  }
  if ([...value].some((character) => character < " " || character === "\u007f")) {
    return invalidInput();
  }
  return value;
}

function identifier(value: unknown): string {
  const result = stringValue(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u.test(result)) {
    return invalidInput();
  }
  return result;
}

function workspaceName(value: unknown): string {
  const result = stringValue(value, 120);
  if (result.trim() !== result || result.includes("/") || result.includes("\\")) {
    return invalidInput();
  }
  return result;
}

function relativePath(value: unknown): string {
  const result = stringValue(value, 512);
  if (
    result.startsWith("/") ||
    result.includes("\\") ||
    /^[A-Za-z]:/u.test(result) ||
    result.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return invalidInput();
  }
  return result;
}

function pathSegment(value: unknown): string {
  const result = stringValue(value, 256);
  if (
    result === "." ||
    result === ".." ||
    result.includes("/") ||
    result.includes("\\") ||
    result.includes("\u0000")
  ) {
    return invalidInput();
  }
  return result;
}

function enumValue<Value extends string>(value: unknown, values: readonly Value[]): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    return invalidInput();
  }
  return value as Value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") {
    return invalidInput();
  }
  return value;
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return value === undefined ? undefined : booleanValue(value);
}

function optionalIdentifier(value: unknown): string | undefined {
  return value === undefined ? undefined : identifier(value);
}

function optionalRelativePath(value: unknown): string | undefined {
  return value === undefined ? undefined : relativePath(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalidInput();
  }
  return value;
}

function validateWorkspaceOpenInput(value: unknown): WorkspaceOpenInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["selection"])) return invalidInput();
  const selection = input.selection;
  if (selection !== undefined && selection !== "native-dialog") return invalidInput();
  return selection === undefined ? {} : { selection };
}

function validateWorkspaceCreateInput(value: unknown): WorkspaceCreateInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["name"])) return invalidInput();
  return { name: workspaceName(input.name) };
}

function validateRunStatusInput(value: unknown): RunStatusInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "runId"])) return invalidInput();
  const runId = optionalIdentifier(input.runId);
  return {
    workspaceId: identifier(input.workspaceId),
    ...(runId === undefined ? {} : { runId }),
  };
}

function validateRunStartInput(value: unknown): RunStartInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId"])) return invalidInput();
  return { workspaceId: identifier(input.workspaceId) };
}

function validateRunLifecycleInput(value: unknown): RunLifecycleInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "runId"])) return invalidInput();
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
  };
}

function validateReviewLoadInput(value: unknown): ReviewLoadInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "runId"])) return invalidInput();
  const workspaceId = optionalIdentifier(input.workspaceId);
  const runId = optionalIdentifier(input.runId);
  return {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(runId === undefined ? {} : { runId }),
  };
}

function validateReviewAction(value: unknown): ReviewAction {
  const action = requireRecord(value);
  if (typeof action.type !== "string") return invalidInput();
  switch (action.type) {
    case "finding-decision":
      if (!hasOnlyKeys(action, ["type", "findingId", "decision"])) return invalidInput();
      return {
        type: action.type,
        findingId: identifier(action.findingId),
        decision: enumValue(action.decision, [
          "pending",
          "accepted",
          "rejected",
          "deferred",
          "overridden",
        ] as const),
      };
    case "edit-block":
      if (!hasOnlyKeys(action, ["type", "blockId", "text"])) return invalidInput();
      return {
        type: action.type,
        blockId: identifier(action.blockId),
        text: stringValue(action.text, 20_000),
      };
    case "pause":
    case "resume":
    case "request-revision":
    case "approve":
    case "export":
      if (!hasOnlyKeys(action, ["type"])) return invalidInput();
      return { type: action.type };
    default:
      return invalidInput();
  }
}

function validateReviewDispatchInput(value: unknown): ReviewDispatchInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "runId", "action"])) return invalidInput();
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
    action: validateReviewAction(input.action),
  };
}

function validateFileSelectInput(value: unknown): FileSelectInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "extensions", "multiple"])) return invalidInput();
  const extensions = input.extensions;
  if (extensions !== undefined && !Array.isArray(extensions)) return invalidInput();
  const normalizedExtensions = extensions?.map((extension) =>
    enumValue(extension, supportedFileExtensions),
  );
  if (
    normalizedExtensions !== undefined &&
    new Set(normalizedExtensions).size !== normalizedExtensions.length
  ) {
    return invalidInput();
  }
  const multiple = optionalBooleanValue(input.multiple);
  return {
    workspaceId: identifier(input.workspaceId),
    ...(normalizedExtensions === undefined ? {} : { extensions: normalizedExtensions }),
    ...(multiple === undefined ? {} : { multiple }),
  };
}

function validateExportWriteInput(value: unknown): ExportWriteInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["workspaceId", "runId", "format", "relativePath"])) {
    return invalidInput();
  }
  const path = optionalRelativePath(input.relativePath);
  if (path !== undefined && !path.startsWith("exports/")) return invalidInput();
  const format = enumValue(input.format, exportFormats);
  if (path !== undefined && !path.toLowerCase().endsWith(exportExtensionByFormat[format])) {
    return invalidInput();
  }
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
    format,
    ...(path === undefined ? {} : { relativePath: path }),
  };
}

function validateCredentialInput(value: unknown): CredentialStatusInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, ["provider"])) return invalidInput();
  return { provider: enumValue(input.provider, credentialProviders) };
}

/** Parses untrusted renderer input into one of the allowlisted bridge commands. */
export function validateBridgeCommand(value: unknown): BridgeCommand {
  const command = requireRecord(value);
  if (typeof command.type !== "string" || !commandNames.has(command.type as BridgeCommandName)) {
    return invalidCommand();
  }
  switch (command.type as BridgeCommandName) {
    case "workspace.open":
      return { type: "workspace.open", input: validateWorkspaceOpenInput(command.input) };
    case "workspace.create":
      return { type: "workspace.create", input: validateWorkspaceCreateInput(command.input) };
    case "run.status":
      return { type: "run.status", input: validateRunStatusInput(command.input) };
    case "run.start":
      return { type: "run.start", input: validateRunStartInput(command.input) };
    case "run.pause":
      return { type: "run.pause", input: validateRunLifecycleInput(command.input) };
    case "run.resume":
      return { type: "run.resume", input: validateRunLifecycleInput(command.input) };
    case "run.stop":
      return { type: "run.stop", input: validateRunLifecycleInput(command.input) };
    case "review.load":
      return { type: "review.load", input: validateReviewLoadInput(command.input) };
    case "review.dispatch":
      return { type: "review.dispatch", input: validateReviewDispatchInput(command.input) };
    case "file.select":
      return { type: "file.select", input: validateFileSelectInput(command.input) };
    case "export.write":
      return { type: "export.write", input: validateExportWriteInput(command.input) };
    case "credential.status":
      return { type: "credential.status", input: validateCredentialInput(command.input) };
    case "credential.set":
      return { type: "credential.set", input: validateCredentialInput(command.input) };
    case "credential.remove":
      return { type: "credential.remove", input: validateCredentialInput(command.input) };
  }
}

export function bridgeError(code: BridgeErrorCode, capability?: BridgeCapability): BridgeError {
  return {
    code,
    message: errorMessages[code],
    ...(capability === undefined ? {} : { capability }),
  };
}

export function unavailableResult<Value>(capability: BridgeCapability): BridgeResult<Value> {
  return { ok: false, error: bridgeError("capability-unavailable", capability) };
}

/** Converts unknown host exceptions to content-free, stable errors. */
export function safeBridgeError(error: unknown, capability?: BridgeCapability): BridgeError {
  if (error instanceof BridgeValidationError) {
    return bridgeError(error.code, capability);
  }
  if (isRecord(error) && typeof error.code === "string") {
    const code = error.code;
    if (
      code === "invalid-command" ||
      code === "invalid-input" ||
      code === "capability-unavailable" ||
      code === "permission-denied" ||
      code === "not-found" ||
      code === "operation-failed"
    ) {
      return bridgeError(code, capability);
    }
  }
  return bridgeError("operation-failed", capability);
}

class BridgeValidationError extends Error {
  public readonly code: "invalid-command" | "invalid-input";

  public constructor(code: "invalid-command" | "invalid-input") {
    super(errorMessages[code]);
    this.name = "BridgeValidationError";
    this.code = code;
  }
}

function normalizeCapabilities(
  capabilities: ReadonlySet<BridgeCapability> | readonly BridgeCapability[],
): readonly BridgeCapability[] {
  const advertised = Array.from(capabilities);
  return Object.freeze(bridgeCapabilities.filter((capability) => advertised.includes(capability)));
}

function finiteInteger(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    return invalidInput();
  }
  return value;
}

function displayName(value: unknown): string {
  const result = stringValue(value, 120);
  if (result.trim() !== result || result.includes("\n") || result.includes("\r")) {
    return invalidInput();
  }
  return result;
}

function normalizeWorkspaceResult(value: unknown): WorkspaceResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, ["workspace"])) return invalidInput();
  const workspace = requireRecord(result.workspace);
  return {
    workspace: {
      id: identifier(workspace.id),
      name: displayName(workspace.name),
    },
  };
}

function normalizeRunStatus(value: unknown): RunStatus {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, ["workspaceId", "runId", "state", "round", "approval"])) {
    return invalidInput();
  }
  const runId = result.runId === null ? null : identifier(result.runId);
  return {
    workspaceId: identifier(result.workspaceId),
    runId,
    state: enumValue(result.state, runStates),
    round: finiteInteger(result.round, 1_000_000),
    approval: enumValue(result.approval, ["pending", "approved", "rejected"] as const),
  };
}

function normalizeReviewState(value: unknown): ReviewStateResult {
  if (!isRecord(value)) return invalidInput();
  if (
    typeof value.workspaceId !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.state !== "string" ||
    !(runStates as readonly string[]).includes(value.state)
  ) {
    return invalidInput();
  }
  return value as unknown as DesktopReviewState;
}

function normalizeFileResult(value: unknown): FileSelectResult {
  const result = requireRecord(value);
  if (
    !hasOnlyKeys(result, ["files"]) ||
    !Array.isArray(result.files) ||
    result.files.length > 100
  ) {
    return invalidInput();
  }
  return {
    files: result.files.map((item) => {
      const file = requireRecord(item);
      if (!hasOnlyKeys(file, ["id", "name", "relativePath", "mediaType", "byteLength"])) {
        return invalidInput();
      }
      const path = relativePath(file.relativePath);
      const name = pathSegment(file.name);
      const extension = `.${name.split(".").at(-1)?.toLowerCase() ?? ""}`;
      if (!supportedFileExtensions.includes(extension as SupportedFileExtension)) {
        return invalidInput();
      }
      const mediaType = enumValue(file.mediaType, supportedMediaTypes);
      if (fileMediaTypeByExtension[extension as SupportedFileExtension] !== mediaType) {
        return invalidInput();
      }
      return {
        id: identifier(file.id),
        name,
        relativePath: path,
        mediaType,
        byteLength: finiteInteger(file.byteLength, 2 ** 40),
      } satisfies SelectedFile;
    }),
  };
}

function normalizeExportResult(value: unknown): ExportResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, ["exportId", "workspaceId", "runId", "format", "relativePath"])) {
    return invalidInput();
  }
  const format = enumValue(result.format, exportFormats);
  const path = relativePath(result.relativePath);
  if (
    !path.startsWith("exports/") ||
    !path.toLowerCase().endsWith(exportExtensionByFormat[format])
  ) {
    return invalidInput();
  }
  return {
    exportId: identifier(result.exportId),
    workspaceId: identifier(result.workspaceId),
    runId: identifier(result.runId),
    format,
    relativePath: path,
  };
}

function normalizeCredentialResult(value: unknown): CredentialResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, ["provider", "configured"])) return invalidInput();
  return {
    provider: enumValue(result.provider, credentialProviders),
    configured: booleanValue(result.configured),
  };
}

function normalizeSuccess(command: BridgeCommandName, value: unknown): unknown {
  switch (command) {
    case "workspace.open":
    case "workspace.create":
      return normalizeWorkspaceResult(value);
    case "run.status":
    case "run.start":
    case "run.pause":
    case "run.resume":
    case "run.stop":
      return normalizeRunStatus(value);
    case "review.load":
    case "review.dispatch":
      return normalizeReviewState(value);
    case "file.select":
      return normalizeFileResult(value);
    case "export.write":
      return normalizeExportResult(value);
    case "credential.status":
    case "credential.set":
    case "credential.remove":
      return normalizeCredentialResult(value);
  }
}

function normalizeResponse(
  command: BridgeCommand,
  response: BridgeResult<unknown>,
): BridgeResult<unknown> {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    return { ok: false, error: bridgeError("operation-failed", command.type) };
  }
  if (!response.ok) {
    return { ok: false, error: safeBridgeError(response.error, command.type) };
  }
  try {
    return { ok: true, value: normalizeSuccess(command.type, response.value) };
  } catch (error) {
    return { ok: false, error: safeBridgeError(error, command.type) };
  }
}

export function createCapabilityPort(nativeBridge: NativeBridge): CapabilityPort {
  const capabilities = normalizeCapabilities(nativeBridge.capabilities);
  const capabilitySet = new Set<BridgeCapability>(capabilities);

  return Object.freeze({
    capabilities,
    hasCapability: (capability: BridgeCapability) => capabilitySet.has(capability),
    execute: async <Command extends BridgeCommand>(
      command: Command,
    ): Promise<BridgeResult<BridgeOutput<Command>>> => {
      let normalized: BridgeCommand;
      try {
        normalized = validateBridgeCommand(command);
      } catch (error) {
        return { ok: false, error: safeBridgeError(error) };
      }
      if (!capabilitySet.has(normalized.type)) {
        return unavailableResult(normalized.type) as BridgeResult<BridgeOutput<Command>>;
      }
      try {
        const response = await nativeBridge.invoke(normalized);
        return normalizeResponse(normalized, response) as BridgeResult<BridgeOutput<Command>>;
      } catch (error) {
        return {
          ok: false,
          error: safeBridgeError(error, normalized.type),
        };
      }
    },
  });
}
