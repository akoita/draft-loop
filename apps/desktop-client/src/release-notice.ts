/**
 * The client's new-version notice (ADR 0011, D9). The client is unsigned, so it never downloads
 * or installs anything: it asks GitHub Releases for the newest desktop tag (`v*`, never the
 * server's `server-v*`) and, when that is newer than itself, offers the releases page once per
 * version. The request carries no account, token or candidate material.
 */

export const releasesUrl = "https://github.com/akoita/draft-loop/releases";
export const releasesApiUrl = "https://api.github.com/repos/akoita/draft-loop/releases?per_page=20";

interface Version {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

export function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(text.trim());
  if (match === null) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/u.test(left);
  const rightNumber = /^\d+$/u.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Semantic-version order: a release outranks its own pre-releases. */
export function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const difference = compareIdentifiers(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest published desktop release newer than `current`, from the GitHub releases list. */
export function newerDesktopRelease(releases: unknown, current: string): string | undefined {
  const installed = parseVersion(current);
  if (installed === undefined || !Array.isArray(releases)) return undefined;
  let newest: { tag: string; version: Version } | undefined;
  for (const release of releases) {
    if (typeof release !== "object" || release === null) continue;
    const { tag_name: tag, draft } = release as { tag_name?: unknown; draft?: unknown };
    if (typeof tag !== "string" || draft === true || !tag.startsWith("v")) continue;
    const version = parseVersion(tag);
    if (version === undefined || compareVersions(version, installed) <= 0) continue;
    if (newest === undefined || compareVersions(version, newest.version) > 0)
      newest = { tag, version };
  }
  return newest?.tag;
}
