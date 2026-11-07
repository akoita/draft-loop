/**
 * Finds screen text that bypasses the message catalogs (#2336). Under the `pseudo` locale every
 * catalog message is drawn with accented letters, so a run of two or more plain ASCII words left in
 * the markup is text that was never extracted. Fixture data the test supplies is passed in `allowed`.
 */
export function untranslatedRuns(html: string, allowed: readonly string[] = []): string[] {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gu, " ")
    .replace(/<[^>]+>/gu, "\n")
    .replace(/&[a-z#0-9]+;/giu, " ");
  const runs = new Set<string>();
  for (const line of text.split("\n")) {
    let rest = line;
    for (const value of allowed) rest = rest.split(value).join(" ");
    for (const match of rest.matchAll(/[A-Za-z]{2,}(?:[ ,.:;'’-]+[A-Za-z]{2,})+/gu)) {
      runs.add(match[0]);
    }
  }
  return [...runs];
}
