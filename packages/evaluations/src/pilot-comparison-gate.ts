/**
 * Private, predeclared comparison gates for consented real-application pilot
 * cases.  The gate contains thresholds and measurements that must remain in
 * the private case file; callers should expose only the bounded evaluation
 * statuses returned by `evaluatePilotComparisonGate`.
 */

export const pilotComparisonGateSchemaVersion = 1 as const;

export const pilotComparisonGateDimensions = [
  "factualSafety",
  "requiredSectionPreservation",
  "chronologyPreservation",
  "relevantAchievementRecall",
  "criticalRequirementCoverage",
  "boundedHumanReview",
  "professionalReadiness",
] as const;

export type PilotComparisonGateDimension = (typeof pilotComparisonGateDimensions)[number];
export type PilotComparisonGateStatus = "pass" | "fail" | "indeterminate";

export interface PilotComparisonGateThresholds {
  readonly minimumRelevantAchievementRecall: number;
  readonly minimumCriticalRequirementCoverage: number;
  readonly maximumRevisedReviewMinutes: number;
  readonly maximumRevisedEditCount: number;
}

/**
 * These values are deliberately not allowances.  When present in a gate,
 * they document the fixed zero-tolerance policy and cannot be relaxed.
 */
export interface PilotComparisonGateInvariants {
  readonly factualInvariantViolations: "zero-tolerance";
  readonly unsupportedModelAddedClaims: "zero-tolerance";
}

export interface PilotComparisonGate {
  readonly schemaVersion: typeof pilotComparisonGateSchemaVersion;
  readonly declaredAt: string;
  readonly thresholds: PilotComparisonGateThresholds;
  readonly invariants?: PilotComparisonGateInvariants;
}

/**
 * Measurements that are not available from the existing deterministic
 * evaluation.  They remain private and are never copied into a report.
 */
export interface PilotComparisonMeasurements {
  readonly factualInvariantViolationCount: number;
  readonly requiredSectionsPreserved: boolean;
  readonly chronologyPreserved: boolean;
  readonly relevantAchievementRecall: number;
}

/**
 * Deterministic and outcome values supplied to the gate evaluator.  Nullable
 * values represent a measurement that could not be computed; they produce an
 * `indeterminate` dimension rather than being treated as zero.
 */
export interface PilotComparisonGateEvaluationInput {
  /** Optional nested form for callers that keep the private fields together. */
  readonly measurements?: PilotComparisonMeasurements;
  readonly factualInvariantViolationCount?: number | null;
  readonly requiredSectionsPreserved?: boolean | null;
  readonly chronologyPreserved?: boolean | null;
  readonly relevantAchievementRecall?: number | null;
  /** Existing deterministic pilot measure name. */
  readonly unsupportedClaimCount?: number | null;
  /** Descriptive alias for callers that pass the revised-draft measure. */
  readonly unsupportedModelAddedClaimCount?: number | null;
  readonly criticalRequirementCoverage?: number | null;
  readonly revisedReviewMinutes?: number | null;
  readonly revisedEditCount?: number | null;
  readonly revisedReady?: boolean | null;
  readonly approvalCompleted?: boolean | null;
  readonly exportCompleted?: boolean | null;
}

export interface PilotComparisonGateEvaluation {
  readonly dimensions: Readonly<Record<PilotComparisonGateDimension, PilotComparisonGateStatus>>;
  readonly overall: PilotComparisonGateStatus;
}

interface RecordLike {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordLike, key: string): boolean {
  return Object.hasOwn(value, key);
}

function assertExactKeys(value: RecordLike, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`Pilot comparison ${label} is not a supported contract.`);
  }
}

function assertFiniteNonNegative(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(message);
  }
}

function assertUnitInterval(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(message);
  }
}

function assertNonNegativeInteger(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RangeError(message);
  }
}

function parseStrictIsoTimestamp(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new TypeError(`Pilot comparison ${label} must be a strict ISO timestamp.`);
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) {
    throw new TypeError(`Pilot comparison ${label} must be a strict ISO timestamp.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const maximumDay =
    month === 2
      ? 28 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0)
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maximumDay ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    throw new TypeError(`Pilot comparison ${label} must be a strict ISO timestamp.`);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Pilot comparison ${label} must be a strict ISO timestamp.`);
  }
  return parsed;
}

function validateThresholds(value: unknown): asserts value is PilotComparisonGateThresholds {
  if (!isRecord(value)) {
    throw new Error("Pilot comparison gate thresholds are incomplete.");
  }
  assertExactKeys(
    value,
    [
      "minimumRelevantAchievementRecall",
      "minimumCriticalRequirementCoverage",
      "maximumRevisedReviewMinutes",
      "maximumRevisedEditCount",
    ],
    "gate thresholds",
  );
  for (const key of [
    "minimumRelevantAchievementRecall",
    "minimumCriticalRequirementCoverage",
  ] as const) {
    if (!hasOwn(value, key)) {
      throw new Error("Pilot comparison gate thresholds are incomplete.");
    }
    assertUnitInterval(value[key], "Pilot comparison gate thresholds must be between 0 and 1.");
  }
  if (!hasOwn(value, "maximumRevisedReviewMinutes")) {
    throw new Error("Pilot comparison gate thresholds are incomplete.");
  }
  assertFiniteNonNegative(
    value.maximumRevisedReviewMinutes,
    "Pilot comparison review-minute threshold must be finite and non-negative.",
  );
  if (!hasOwn(value, "maximumRevisedEditCount")) {
    throw new Error("Pilot comparison gate thresholds are incomplete.");
  }
  assertNonNegativeInteger(
    value.maximumRevisedEditCount,
    "Pilot comparison edit-count threshold must be a non-negative integer.",
  );
}

function validateInvariants(value: unknown): asserts value is PilotComparisonGateInvariants {
  if (!isRecord(value)) {
    throw new Error("Pilot comparison gate invariants are invalid.");
  }
  assertExactKeys(
    value,
    ["factualInvariantViolations", "unsupportedModelAddedClaims"],
    "gate invariants",
  );
  if (
    value.factualInvariantViolations !== "zero-tolerance" ||
    value.unsupportedModelAddedClaims !== "zero-tolerance"
  ) {
    throw new Error("Pilot comparison gate invariants must remain zero-tolerance.");
  }
}

/**
 * Validates a private v1 gate.  Chronology is supplied by the case because the
 * consent and first-draft timestamps do not belong in the gate itself.
 */
export function validatePilotComparisonGate(
  gate: unknown,
  chronology?: Readonly<{ consentedAt: unknown; firstDraftCreatedAt: unknown }>,
): asserts gate is PilotComparisonGate {
  if (!isRecord(gate)) {
    throw new Error("A pilot comparison gate is required for a real outcome case.");
  }
  assertExactKeys(gate, ["schemaVersion", "declaredAt", "thresholds", "invariants"], "gate");
  if (gate.schemaVersion !== pilotComparisonGateSchemaVersion) {
    throw new Error("Pilot comparison gate schema version is unsupported.");
  }
  parseStrictIsoTimestamp(gate.declaredAt, "declaration time");
  validateThresholds(gate.thresholds);
  if (hasOwn(gate, "invariants")) {
    validateInvariants(gate.invariants);
  }

  if (chronology !== undefined) {
    const consentedAt = parseStrictIsoTimestamp(chronology.consentedAt, "consent time");
    const declaredAt = parseStrictIsoTimestamp(gate.declaredAt, "declaration time");
    const firstDraftCreatedAt = parseStrictIsoTimestamp(
      chronology.firstDraftCreatedAt,
      "first-draft time",
    );
    if (consentedAt > declaredAt || declaredAt > firstDraftCreatedAt) {
      throw new Error("Pilot comparison gate declaration falls outside the permitted timeline.");
    }
  }
}

export function validatePilotComparisonMeasurements(
  measurements: unknown,
): asserts measurements is PilotComparisonMeasurements {
  if (!isRecord(measurements)) {
    throw new Error("Pilot comparison measurements are required for a real outcome case.");
  }
  assertExactKeys(
    measurements,
    [
      "factualInvariantViolationCount",
      "requiredSectionsPreserved",
      "chronologyPreserved",
      "relevantAchievementRecall",
    ],
    "measurements",
  );
  if (!hasOwn(measurements, "factualInvariantViolationCount")) {
    throw new Error("Pilot comparison measurements are incomplete.");
  }
  assertNonNegativeInteger(
    measurements.factualInvariantViolationCount,
    "Pilot factual-invariant violation count must be a non-negative integer.",
  );
  if (
    !hasOwn(measurements, "requiredSectionsPreserved") ||
    typeof measurements.requiredSectionsPreserved !== "boolean"
  ) {
    throw new Error("Pilot required-section preservation measurement must be boolean.");
  }
  if (
    !hasOwn(measurements, "chronologyPreserved") ||
    typeof measurements.chronologyPreserved !== "boolean"
  ) {
    throw new Error("Pilot chronology preservation measurement must be boolean.");
  }
  if (!hasOwn(measurements, "relevantAchievementRecall")) {
    throw new Error("Pilot comparison measurements are incomplete.");
  }
  assertUnitInterval(
    measurements.relevantAchievementRecall,
    "Pilot relevant-achievement recall must be between 0 and 1.",
  );
}

function statusForBoolean(value: boolean | null | undefined): PilotComparisonGateStatus {
  return value === undefined || value === null ? "indeterminate" : value ? "pass" : "fail";
}

function statusForBound(
  value: number | null | undefined,
  threshold: number,
  validator: (value: number) => boolean,
): PilotComparisonGateStatus {
  if (value === undefined || value === null) return "indeterminate";
  if (!validator(value)) return "indeterminate";
  return value <= threshold ? "pass" : "fail";
}

function statusForMinimum(
  value: number | null | undefined,
  threshold: number,
  validator: (value: number) => boolean,
): PilotComparisonGateStatus {
  if (value === undefined || value === null) return "indeterminate";
  if (!validator(value)) return "indeterminate";
  return value >= threshold ? "pass" : "fail";
}

function aggregateStatus(
  dimensions: Readonly<Record<PilotComparisonGateDimension, PilotComparisonGateStatus>>,
): PilotComparisonGateStatus {
  const statuses = Object.values(dimensions);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("indeterminate")) return "indeterminate";
  return "pass";
}

function deterministicCountStatus(value: number | null | undefined): PilotComparisonGateStatus {
  if (value === undefined || value === null) return "indeterminate";
  if (!Number.isInteger(value) || value < 0) return "indeterminate";
  return value === 0 ? "pass" : "fail";
}

/**
 * Evaluates all seven named dimensions.  Private measurements are accepted as
 * input but are represented only by statuses in the returned value.
 */
export function evaluatePilotComparisonGate(
  gate: PilotComparisonGate,
  input: PilotComparisonGateEvaluationInput,
): PilotComparisonGateEvaluation {
  // This check also protects callers that invoke the evaluator directly
  // instead of going through the harness preflight.
  validatePilotComparisonGate(gate);

  const measurements = input.measurements ?? input;
  const factualInvariantStatus = deterministicCountStatus(
    measurements.factualInvariantViolationCount,
  );
  const unsupportedClaimStatus = deterministicCountStatus(
    input.unsupportedModelAddedClaimCount ?? input.unsupportedClaimCount,
  );
  const reviewStatus = statusForBound(
    input.revisedReviewMinutes,
    gate.thresholds.maximumRevisedReviewMinutes,
    (value) => Number.isFinite(value) && value >= 0,
  );
  const editStatus =
    input.revisedEditCount === undefined || input.revisedEditCount === null
      ? "indeterminate"
      : !Number.isInteger(input.revisedEditCount) || input.revisedEditCount < 0
        ? "indeterminate"
        : input.revisedEditCount <= gate.thresholds.maximumRevisedEditCount
          ? "pass"
          : "fail";
  const readinessStatus = statusForBoolean(input.revisedReady);
  const approvalStatus = statusForBoolean(input.approvalCompleted);
  const exportStatus = statusForBoolean(input.exportCompleted);
  const dimensions = {
    factualSafety:
      factualInvariantStatus === "fail" || unsupportedClaimStatus === "fail"
        ? "fail"
        : factualInvariantStatus === "indeterminate" || unsupportedClaimStatus === "indeterminate"
          ? "indeterminate"
          : "pass",
    requiredSectionPreservation: statusForBoolean(measurements.requiredSectionsPreserved),
    chronologyPreservation: statusForBoolean(measurements.chronologyPreserved),
    relevantAchievementRecall: statusForMinimum(
      measurements.relevantAchievementRecall,
      gate.thresholds.minimumRelevantAchievementRecall,
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
    criticalRequirementCoverage: statusForMinimum(
      input.criticalRequirementCoverage,
      gate.thresholds.minimumCriticalRequirementCoverage,
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
    boundedHumanReview:
      reviewStatus === "fail" || editStatus === "fail"
        ? "fail"
        : reviewStatus === "indeterminate" || editStatus === "indeterminate"
          ? "indeterminate"
          : "pass",
    professionalReadiness:
      readinessStatus === "fail" || approvalStatus === "fail" || exportStatus === "fail"
        ? "fail"
        : readinessStatus === "indeterminate" ||
            approvalStatus === "indeterminate" ||
            exportStatus === "indeterminate"
          ? "indeterminate"
          : "pass",
  } satisfies Record<PilotComparisonGateDimension, PilotComparisonGateStatus>;

  return {
    dimensions,
    overall: aggregateStatus(dimensions),
  };
}
