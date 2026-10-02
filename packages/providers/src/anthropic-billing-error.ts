/** Fixed diagnostic exposed when Anthropic reports an exhausted API credit/spend limit. */
export const anthropicBillingLimitDiagnosticCode = "anthropic_billing_limit" as const;

const maximumErrorDepth = 3;
const maximumStringLength = 4_096;
const enforcedSpendLimitCode = "enforced_spend_limit_reached";

type KnownErrorShape = {
  readonly code?: unknown;
  readonly type?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
  readonly error?: unknown;
};

function safeProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, maximumStringLength).toLowerCase() : undefined;
}

function isBillingText(value: string): boolean {
  return (
    /\bcredit\s+balance\s+(?:is\s+)?too\s+low\b/u.test(value) ||
    /\binsufficient\s+credits\b/u.test(value) ||
    /\byou have reached your specified (?:workspace )?api usage limits\b/u.test(value)
  );
}

function isBillingCode(value: string): boolean {
  return value === enforcedSpendLimitCode;
}

/**
 * Recognize only explicit Anthropic credit/spend-limit markers in the known
 * direct or nested `.error` response shape. Never return provider text.
 */
export function classifyAnthropicBillingError(
  value: unknown,
): typeof anthropicBillingLimitDiagnosticCode | null {
  let current: unknown = value;

  for (let depth = 0; depth < maximumErrorDepth; depth += 1) {
    if (typeof current === "string") {
      const text = boundedString(current);
      if (text !== undefined && isBillingText(text)) {
        return anthropicBillingLimitDiagnosticCode;
      }
      return null;
    }
    if (typeof current !== "object" || current === null) return null;

    const shape = current as KnownErrorShape;
    const code = boundedString(safeProperty(shape, "code"));
    const type = boundedString(safeProperty(shape, "type"));
    const message = boundedString(safeProperty(shape, "message"));
    const details = safeProperty(shape, "details");
    const errorCode =
      typeof details === "object" && details !== null
        ? boundedString(safeProperty(details, "error_code"))
        : undefined;

    if (
      (code !== undefined && isBillingCode(code)) ||
      (type !== undefined && isBillingCode(type)) ||
      (errorCode !== undefined && isBillingCode(errorCode)) ||
      (message !== undefined && isBillingText(message))
    ) {
      return anthropicBillingLimitDiagnosticCode;
    }

    current = safeProperty(shape, "error");
  }

  return null;
}
