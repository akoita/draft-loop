import type { ResolveSignIn } from "./oidc-sign-in.js";

/**
 * The identity provider's earlier issuers, such as its address before a domain move. Members are
 * recorded by (issuer, subject), so after the provider's host changes the same person arrives
 * with a new issuer and the same subject. Reading `DRAFT_LOOP_OIDC_PREVIOUS_ISSUERS` (comma
 * separated https URLs) lets sign-in find them under an earlier issuer when the current one has
 * no member. Only the provider's host may change: the realm, and so each subject, stays the same.
 */
export function readPreviousIssuers(text: string | undefined): readonly string[] {
  if (text === undefined || text.trim() === "") return [];
  return text.split(",").flatMap((entry) => {
    const issuer = entry.trim();
    if (issuer === "") return [];
    let url: URL;
    try {
      url = new URL(issuer);
    } catch {
      throw new Error(`DRAFT_LOOP_OIDC_PREVIOUS_ISSUERS holds "${issuer}": give https URLs only.`);
    }
    if (url.protocol !== "https:" || url.search !== "") {
      throw new Error(`DRAFT_LOOP_OIDC_PREVIOUS_ISSUERS holds "${issuer}": give https URLs only.`);
    }
    return [issuer];
  });
}

/** Looks a sign-in up under the current issuer, then under each earlier one in order. */
export function withPreviousIssuers(
  resolveSignIn: ResolveSignIn,
  previousIssuers: readonly string[],
): ResolveSignIn {
  if (previousIssuers.length === 0) return resolveSignIn;
  return async (identity) => {
    const member = await resolveSignIn(identity);
    if (member !== undefined) return member;
    for (const issuer of previousIssuers) {
      if (issuer === identity.issuer) continue;
      // Without the email, an earlier issuer can only find an active member, never claim an invite.
      const earlier = await resolveSignIn({
        issuer,
        subject: identity.subject,
        emailVerified: false,
      });
      if (earlier !== undefined) return earlier;
    }
    return undefined;
  };
}
