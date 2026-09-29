import type { AgentRole, ModelCompany } from "./index.js";
import {
  type ModelProfile,
  type ModelProfileThinking,
  modelProfileEfforts,
  modelProfileThinkingModes,
  modelProfileTiers,
} from "./model-profile.js";

export const maximumModelLineageLength = 200;

export interface ModelSelection {
  readonly company: ModelCompany;
  readonly modelId: string;
  readonly role: AgentRole;
  readonly promptTemplateVersion: string;
  /** The weights this selection descends from, as claimed by the operator. */
  readonly lineage?: string;
  /** The validated profile captured with this selection, when available. */
  readonly profile?: ModelProfile;
}

export interface ModelSelectionInput {
  readonly company?: string;
  readonly modelId?: string;
  readonly role?: AgentRole;
  readonly promptTemplateVersion?: string;
  readonly lineage?: string;
  readonly profile?: ModelProfile;
}

type ModelSelectionIssueCode = "missing-required-input" | "invalid-value";
type ReportModelSelectionIssue = (
  code: ModelSelectionIssueCode,
  field: string,
  message: string,
) => void;

const selectionProfileKeys = new Set([
  "id",
  "version",
  "provider",
  "modelId",
  "tier",
  "roles",
  "runtime",
  "knownLimits",
]);
const runtimeKeys = new Set(["effort", "maxOutputTokens", "thinking"]);
const knownLimitKeys = new Set(["maxOutputTokens", "contextWindowTokens"]);

/**
 * Fold away differences that are spelling rather than lineage.
 *
 * `Local-A`, `local-a `, and `local  a` are one claim, not three; without this
 * a typo would read as independence, which is the failure mode this whole
 * mechanism exists to avoid.
 */
export function normalizeLineageLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Validate a selection and report safe, path-specific issues to its caller. */
export function validateModelSelection(
  selection: unknown,
  role: AgentRole,
  field: string,
  reportIssue: ReportModelSelectionIssue,
): selection is ModelSelectionInput {
  if (!isRecord(selection)) {
    reportIssue("missing-required-input", field, `${role} model selection is required.`);
    return false;
  }

  if (!isNonEmptyString(selection.company)) {
    reportIssue("invalid-value", `${field}.company`, "a model company is required.");
  }
  if (!isNonEmptyString(selection.modelId)) {
    reportIssue("invalid-value", `${field}.modelId`, "an exact model id is required.");
  }
  if (selection.role !== role) {
    reportIssue("invalid-value", `${field}.role`, `must be the ${role} role.`);
  }
  if (!isNonEmptyString(selection.promptTemplateVersion)) {
    reportIssue(
      "invalid-value",
      `${field}.promptTemplateVersion`,
      "a prompt-template version is required.",
    );
  }
  if (selection.lineage !== undefined) {
    if (!isNonEmptyString(selection.lineage)) {
      reportIssue(
        "invalid-value",
        `${field}.lineage`,
        "must be a non-empty model lineage when provided.",
      );
    } else if (selection.lineage.trim().length > maximumModelLineageLength) {
      reportIssue(
        "invalid-value",
        `${field}.lineage`,
        `must be at most ${maximumModelLineageLength} characters.`,
      );
    }
  }

  if (selection.profile !== undefined) {
    const profileField = `${field}.profile`;
    if (validateModelProfile(selection.profile, profileField, reportIssue)) {
      if (
        isNonEmptyString(selection.company) &&
        selection.profile.provider.trim() !== selection.company.trim()
      ) {
        reportIssue(
          "invalid-value",
          `${profileField}.provider`,
          "must match the selected model company.",
        );
      }
      if (
        isNonEmptyString(selection.modelId) &&
        selection.profile.modelId.trim() !== selection.modelId.trim()
      ) {
        reportIssue(
          "invalid-value",
          `${profileField}.modelId`,
          "must match the selected exact model id.",
        );
      }
      if (
        (selection.role === "author" || selection.role === "critic") &&
        !selection.profile.roles.includes(selection.role)
      ) {
        reportIssue(
          "invalid-value",
          `${profileField}.roles`,
          "must include the selected model role.",
        );
      }
    }
  }

  return true;
}

/** Copy a validated selection into a detached context snapshot value. */
export function normalizeModelSelection(selection: ModelSelectionInput): ModelSelection {
  return {
    company: selection.company?.trim() as ModelCompany,
    modelId: selection.modelId?.trim() as string,
    role: selection.role as AgentRole,
    promptTemplateVersion: selection.promptTemplateVersion?.trim() as string,
    ...(isNonEmptyString(selection.lineage)
      ? { lineage: normalizeLineageLabel(selection.lineage) }
      : {}),
    ...(selection.profile === undefined
      ? {}
      : { profile: normalizeModelProfile(selection.profile) }),
  };
}

function normalizeModelProfile(profile: ModelProfile): ModelProfile {
  return {
    id: profile.id.trim(),
    version: profile.version,
    provider: profile.provider.trim(),
    modelId: profile.modelId.trim(),
    tier: profile.tier,
    roles: [...profile.roles],
    runtime: {
      effort: profile.runtime.effort,
      maxOutputTokens: profile.runtime.maxOutputTokens,
      thinking: normalizeThinking(profile.runtime.thinking),
    },
    knownLimits: {
      maxOutputTokens: profile.knownLimits.maxOutputTokens,
      ...(profile.knownLimits.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: profile.knownLimits.contextWindowTokens }),
    },
  };
}

function normalizeThinking(thinking: ModelProfileThinking): ModelProfileThinking {
  return thinking.mode === "budgeted"
    ? { mode: thinking.mode, maxTokens: thinking.maxTokens }
    : { mode: thinking.mode };
}

function validateModelProfile(
  value: unknown,
  field: string,
  reportIssue: ReportModelSelectionIssue,
): value is ModelProfile {
  if (!isRecord(value)) {
    reportIssue("invalid-value", field, "must be a model profile object.");
    return false;
  }

  let valid = true;
  const issue = (issueField: string, message: string): void => {
    valid = false;
    reportIssue("invalid-value", issueField, message);
  };

  reportUnexpectedKeys(value, selectionProfileKeys, field, issue);
  if (!isNonEmptyString(value.id)) issue(`${field}.id`, "must be a non-empty profile id.");
  if (!isPositiveSafeInteger(value.version)) {
    issue(`${field}.version`, "must be a positive safe integer.");
  }
  if (!isNonEmptyString(value.provider)) {
    issue(`${field}.provider`, "must be a non-empty provider identity.");
  }
  if (!isNonEmptyString(value.modelId)) {
    issue(`${field}.modelId`, "must be a non-empty exact model id.");
  }
  if (!isEnumValue(value.tier, modelProfileTiers)) {
    issue(`${field}.tier`, "must be a supported model profile tier.");
  }
  const rolesValid = validateProfileRoles(value.roles, `${field}.roles`, issue);
  const runtimeValid = validateProfileRuntime(value.runtime, `${field}.runtime`, issue);
  const limitsValid = validateKnownLimits(value.knownLimits, `${field}.knownLimits`, issue);

  if (runtimeValid && limitsValid && isRecord(value.runtime) && isRecord(value.knownLimits)) {
    if (
      isPositiveSafeInteger(value.runtime.maxOutputTokens) &&
      isPositiveSafeInteger(value.knownLimits.maxOutputTokens) &&
      value.runtime.maxOutputTokens > value.knownLimits.maxOutputTokens
    ) {
      issue(`${field}.runtime.maxOutputTokens`, "cannot exceed the known output limit.");
    }
    const thinking = value.runtime.thinking;
    if (
      isRecord(thinking) &&
      thinking.mode === "budgeted" &&
      isPositiveSafeInteger(thinking.maxTokens) &&
      isPositiveSafeInteger(value.runtime.maxOutputTokens) &&
      thinking.maxTokens > value.runtime.maxOutputTokens
    ) {
      issue(`${field}.runtime.thinking.maxTokens`, "cannot exceed the runtime output ceiling.");
    }
  }

  return valid && rolesValid;
}

function validateProfileRoles(
  value: unknown,
  field: string,
  issue: (field: string, message: string) => void,
): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    issue(field, "must contain at least one supported role.");
    return false;
  }

  let valid = true;
  const seen = new Set<string>();
  for (const [index, role] of value.entries()) {
    if (role !== "author" && role !== "critic") {
      issue(`${field}.${index}`, "must be an author or critic role.");
      valid = false;
    } else if (seen.has(role)) {
      issue(field, "roles must be unique.");
      valid = false;
    }
    seen.add(String(role));
  }
  return valid;
}

function validateProfileRuntime(
  value: unknown,
  field: string,
  issue: (field: string, message: string) => void,
): boolean {
  if (!isRecord(value)) {
    issue(field, "must be a runtime object.");
    return false;
  }

  let valid = true;
  const report = (issueField: string, message: string): void => {
    valid = false;
    issue(issueField, message);
  };
  reportUnexpectedKeys(value, runtimeKeys, field, report);
  if (!isEnumValue(value.effort, modelProfileEfforts)) {
    report(`${field}.effort`, "must be a supported runtime effort.");
  }
  if (!isPositiveSafeInteger(value.maxOutputTokens)) {
    report(`${field}.maxOutputTokens`, "must be a positive safe integer.");
  }

  const thinkingField = `${field}.thinking`;
  const thinking = value.thinking;
  if (!isRecord(thinking)) {
    report(thinkingField, "must be a thinking configuration object.");
    return valid;
  }
  if (!isEnumValue(thinking.mode, modelProfileThinkingModes)) {
    report(`${thinkingField}.mode`, "must be a supported thinking mode.");
  }
  const thinkingKeys = new Set(thinking.mode === "budgeted" ? ["mode", "maxTokens"] : ["mode"]);
  reportUnexpectedKeys(thinking, thinkingKeys, thinkingField, report);
  if (thinking.mode === "budgeted" && !isPositiveSafeInteger(thinking.maxTokens)) {
    report(`${thinkingField}.maxTokens`, "must be a positive safe integer.");
  }
  return valid;
}

function validateKnownLimits(
  value: unknown,
  field: string,
  issue: (field: string, message: string) => void,
): boolean {
  if (!isRecord(value)) {
    issue(field, "must be a known-limits object.");
    return false;
  }

  let valid = true;
  const report = (issueField: string, message: string): void => {
    valid = false;
    issue(issueField, message);
  };
  reportUnexpectedKeys(value, knownLimitKeys, field, report);
  if (!isPositiveSafeInteger(value.maxOutputTokens)) {
    report(`${field}.maxOutputTokens`, "must be a positive safe integer.");
  }
  if (
    value.contextWindowTokens !== undefined &&
    !isPositiveSafeInteger(value.contextWindowTokens)
  ) {
    report(`${field}.contextWindowTokens`, "must be a positive safe integer when provided.");
  }
  return valid;
}

function reportUnexpectedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  field: string,
  issue: (field: string, message: string) => void,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issue(`${field}.${key}`, "is not supported.");
  }
}

function isEnumValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value {
  return values.some((candidate) => candidate === value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
