/** Provider creation times are optional, non-authoritative stream metadata. */
export function isCompatibleDeepInfraStreamTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}
