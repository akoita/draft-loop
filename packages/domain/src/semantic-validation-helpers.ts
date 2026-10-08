import type { SemanticValidationCode, SemanticValidationIssue } from "./index.js";

export function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim()) &&
    !Number.isNaN(Date.parse(value.trim()))
  );
}

export function addIssue(
  issues: SemanticValidationIssue[],
  code: SemanticValidationCode,
  field: string,
  message: string,
): void {
  issues.push({ code, field, message });
}

export function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const clone = value.map((item) => cloneAndFreeze(item));
    return Object.freeze(clone) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(item);
    }
    return Object.freeze(clone) as T;
  }
  return value;
}
