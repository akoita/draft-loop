// Reads or sets the beta account cap on a running DraftLoop server, with no redeploy (#2998).
//
//   DRAFT_LOOP_API_URL=https://... DRAFT_LOOP_OWNER_TOKEN=... pnpm beta:cap        # read
//   DRAFT_LOOP_API_URL=https://... DRAFT_LOOP_OWNER_TOKEN=... pnpm beta:cap 15     # set to 15
//
// The owner token comes from the environment only, never from the command line, and is never
// printed. The private infrastructure repository wraps this for staging and prod.
import console from "node:console";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

export const maximumCap = 100_000;

const usage =
  "Usage: DRAFT_LOOP_API_URL=<server> DRAFT_LOOP_OWNER_TOKEN=<token> pnpm beta:cap [<new cap>]";

/** Parses the command line and the environment, or throws a message for the operator. */
export function parseBetaCapRequest(args, env) {
  if (args.length > 1) throw new Error(usage);
  const base = (env.DRAFT_LOOP_API_URL ?? "").trim().replace(/\/+$/u, "");
  const token = (env.DRAFT_LOOP_OWNER_TOKEN ?? "").trim();
  if (base === "" || token === "") throw new Error(usage);
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(
      "DRAFT_LOOP_API_URL must be the server's address, such as https://example.test.",
    );
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("DRAFT_LOOP_API_URL must use https, except for localhost.");
  }
  if (args.length === 0) return { base, token };
  const text = args[0];
  if (!/^\d+$/u.test(text) || Number(text) > maximumCap) {
    throw new Error(`The new cap must be a whole number from 0 to ${maximumCap}.`);
  }
  return { base, token, cap: Number(text) };
}

/** One line the operator reads: the seats, the cap and where it comes from. */
export function describeSeats(seats) {
  const source =
    seats.capSource === "operator"
      ? "set by the operator"
      : `from DRAFT_LOOP_BETA_ACCOUNT_CAP (${seats.deploymentCap})`;
  const left = Math.max(0, seats.cap - seats.redeemed - seats.open);
  return `Cap ${seats.cap} (${source}): ${seats.redeemed} accounts, ${seats.open} invites not used yet, ${left} seats left.`;
}

async function call(fetchImpl, request) {
  const headers = { authorization: `Bearer ${request.token}` };
  const response =
    request.cap === undefined
      ? await fetchImpl(`${request.base}/v1/operator/beta-invites`, { headers })
      : await fetchImpl(`${request.base}/v1/operator/beta-invites/cap`, {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ cap: request.cap }),
        });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body?.error?.code === "string" ? ` ${body.error.code}` : "";
    throw new Error(`The server answered ${response.status}${code}.`);
  }
  return body;
}

export async function main(args, env, { fetchImpl = globalThis.fetch, out = console.log } = {}) {
  const request = parseBetaCapRequest(args, env);
  const seats = await call(fetchImpl, request);
  out(request.cap === undefined ? describeSeats(seats) : `Set. ${describeSeats(seats)}`);
  return seats;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
