import { isIP } from "node:net";

/*
 * Which hosts and addresses a URL fetch must never reach: loopback, private, link-local (which
 * holds cloud metadata services), unique-local, multicast and unspecified addresses, and
 * `localhost` names. Both the URL check and the pinned connection (#1811) use it.
 */

function ipv4Parts(hostname: string): readonly number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => Number.parseInt(part, 10));
  if (
    values.some(
      (value, index) =>
        !Number.isInteger(value) || value < 0 || value > 255 || parts[index]?.length === 0,
    )
  ) {
    return null;
  }
  return values;
}

function unsafeIpv4(parts: readonly number[]): boolean {
  const [first = 0, second = 0, third = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6Parts(hostname: string): readonly number[] | null {
  const value = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const parts = half.split(":");
    const result: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = ipv4Parts(part);
        if (ipv4 === null || result.length + 2 > 8) return null;
        result.push((ipv4[0] ?? 0) * 256 + (ipv4[1] ?? 0));
        result.push((ipv4[2] ?? 0) * 256 + (ipv4[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return null;
      result.push(Number.parseInt(part, 16));
    }
    return result;
  };

  const left = parseHalf(halves[0] ?? "");
  const right = halves.length === 2 ? parseHalf(halves[1] ?? "") : [];
  if (left === null || right === null) return null;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < (halves.length === 2 ? 1 : 0) || left.length + right.length + missing !== 8) {
    return null;
  }
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/** True for a hostname or address literal a fetch must not reach. */
export function unsafeLiteralHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;

  const kind = isIP(normalized);
  if (kind === 4) {
    const parts = ipv4Parts(normalized);
    return parts === null || unsafeIpv4(parts);
  }
  if (kind !== 6) return false;

  const parts = ipv6Parts(normalized);
  if (parts === null) return true;
  const first = parts[0] ?? 0;
  const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mapped) {
    const mappedIpv4 = [
      (parts[6] ?? 0) >>> 8,
      (parts[6] ?? 0) & 0xff,
      (parts[7] ?? 0) >>> 8,
      (parts[7] ?? 0) & 0xff,
    ];
    return unsafeIpv4(mappedIpv4);
  }
  return (
    parts.every((part) => part === 0) ||
    (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}
