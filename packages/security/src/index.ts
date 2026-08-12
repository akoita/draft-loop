export const dataClassifications = [
  "public",
  "personal",
  "confidential-employer",
  "secret",
] as const;

export type DataClassification = (typeof dataClassifications)[number];

export interface RetentionPolicy {
  readonly localSourceRetention: "until-deleted" | "workspace-lifetime" | "none";
  readonly runHistoryRetention: "until-deleted" | "workspace-lifetime" | "none";
  readonly providerRetention: "ephemeral-request" | "provider-default" | "not-allowed";
}

/** The default policy keeps material local and does not assume provider retention. */
export const defaultRetentionPolicy: RetentionPolicy = Object.freeze({
  localSourceRetention: "until-deleted",
  runHistoryRetention: "until-deleted",
  providerRetention: "not-allowed",
});

export interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly description: string;
}

export interface RedactionResult {
  readonly value: string;
  readonly redacted: boolean;
  readonly matchCount: number;
  readonly ruleIds: readonly string[];
}

/**
 * Rules target credential-shaped values only. Confidential employer terms are
 * application-specific and must be supplied by the user or deployment policy.
 */
export const defaultRedactionRules: readonly RedactionRule[] = Object.freeze([
  Object.freeze({
    id: "private-key",
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/gu,
    replacement: "[REDACTED:PRIVATE_KEY]",
    description: "PEM-encoded private keys",
  }),
  Object.freeze({
    id: "credential-assignment",
    pattern:
      /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*[:=]\s*["']?[^"'\s,;]+/giu,
    replacement: "[REDACTED:CREDENTIAL]",
    description: "Credential-like key/value assignments",
  }),
  Object.freeze({
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*\b/giu,
    replacement: "Bearer [REDACTED:TOKEN]",
    description: "Bearer authorization tokens",
  }),
  Object.freeze({
    id: "provider-key",
    pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/gu,
    replacement: "[REDACTED:PROVIDER_KEY]",
    description: "Common provider key prefixes",
  }),
]);

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function validRuleId(value: string): boolean {
  return /^[a-z][a-z0-9-]{1,63}$/u.test(value);
}

export function redactText(
  value: string,
  rules: readonly RedactionRule[] = defaultRedactionRules,
): RedactionResult {
  let redactedValue = value;
  let matchCount = 0;
  const ruleIds: string[] = [];

  for (const rule of rules) {
    if (!validRuleId(rule.id)) {
      throw new RangeError(`Invalid redaction rule id: ${rule.id}`);
    }
    const pattern = globalPattern(rule.pattern);
    let ruleMatches = 0;
    redactedValue = redactedValue.replace(pattern, () => {
      ruleMatches += 1;
      return rule.replacement;
    });
    if (ruleMatches > 0) {
      matchCount += ruleMatches;
      ruleIds.push(rule.id);
    }
  }

  return Object.freeze({
    value: redactedValue,
    redacted: matchCount > 0,
    matchCount,
    ruleIds: Object.freeze(ruleIds),
  });
}

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export function redactJson(
  value: JsonValue,
  rules: readonly RedactionRule[] = defaultRedactionRules,
): JsonValue {
  if (typeof value === "string") {
    return redactText(value, rules).value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, rules));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJson(item, rules)]),
    );
  }
  return value;
}

export type OperationalLogLevel = "debug" | "info" | "warn" | "error";
export type OperationalLogStatus = "started" | "succeeded" | "failed" | "skipped" | "blocked";

export interface OperationalLogEvent {
  readonly event: string;
  readonly level: OperationalLogLevel;
  readonly timestamp: string;
  readonly contentRedacted: true;
  readonly workspaceId?: string;
  readonly runId?: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly status?: OperationalLogStatus;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedUsd?: number;
  readonly errorCode?: string;
}

const logLevels = new Set<OperationalLogLevel>(["debug", "info", "warn", "error"]);
const logStatuses = new Set<OperationalLogStatus>([
  "started",
  "succeeded",
  "failed",
  "skipped",
  "blocked",
]);

function safeIdentifier(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u.test(value)) {
    throw new TypeError(`${name} must be a bounded identifier`);
  }
  return value;
}

function safeNonNegativeNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function safeTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    throw new TypeError("timestamp must be an ISO-8601 UTC timestamp");
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError("timestamp must be a valid ISO-8601 UTC timestamp");
  }
  return value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Creates an allowlisted operational event. Unknown fields, including message,
 * prompt, response, source text, and arbitrary payloads, are deliberately dropped.
 */
export function createOperationalLogEvent(input: unknown): OperationalLogEvent {
  const record = recordValue(input);
  const event = safeIdentifier(record.event, "event");
  if (event === undefined) {
    throw new TypeError("event is required");
  }
  const level = record.level ?? "info";
  if (typeof level !== "string" || !logLevels.has(level as OperationalLogLevel)) {
    throw new TypeError("level must be a supported operational log level");
  }
  const status = record.status;
  if (
    status !== undefined &&
    (typeof status !== "string" || !logStatuses.has(status as OperationalLogStatus))
  ) {
    throw new TypeError("status must be a supported operational log status");
  }

  const timestamp = safeTimestamp(record.timestamp ?? new Date().toISOString());
  const workspaceId = safeIdentifier(record.workspaceId, "workspaceId");
  const runId = safeIdentifier(record.runId, "runId");
  const provider = safeIdentifier(record.provider, "provider");
  const modelId = safeIdentifier(record.modelId, "modelId");
  const errorCode = safeIdentifier(record.errorCode, "errorCode");
  const durationMs = safeNonNegativeNumber(record.durationMs, "durationMs");
  const inputTokens = safeNonNegativeNumber(record.inputTokens, "inputTokens");
  const outputTokens = safeNonNegativeNumber(record.outputTokens, "outputTokens");
  const totalTokens = safeNonNegativeNumber(record.totalTokens, "totalTokens");
  const estimatedUsd = safeNonNegativeNumber(record.estimatedUsd, "estimatedUsd");

  return Object.freeze({
    event,
    level: level as OperationalLogLevel,
    timestamp,
    contentRedacted: true,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(runId === undefined ? {} : { runId }),
    ...(provider === undefined ? {} : { provider }),
    ...(modelId === undefined ? {} : { modelId }),
    ...(status === undefined ? {} : { status: status as OperationalLogStatus }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(estimatedUsd === undefined ? {} : { estimatedUsd }),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}
