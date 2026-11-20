import { type CreditPackId, creditPackIds } from "@draft-loop/schemas/entitlements";

import { ApiConfigError } from "./config.js";
import type { PaymentCheckoutPort, PaymentEventsPort } from "./payment-checkout.js";
import { createStripeCheckout } from "./stripe-checkout.js";
import { createStripeEvents } from "./stripe-events.js";

/** The deployment's payment choice, read before anything opens. */
export type PaymentsConfig =
  | { readonly mode: "off" }
  | {
      readonly mode: "stripe";
      readonly secretKey: string;
      /** The signing secret of the webhook endpoint that receives Stripe's events. */
      readonly webhookSecret: string;
      readonly prices: Readonly<Record<CreditPackId, string>>;
      /** The web screen's address, where the buyer comes back. */
      readonly returnUrl: string;
      /** Live mode charges real cards; test mode only Stripe's test cards. */
      readonly live: boolean;
      /** The organisations that may buy, or every organisation. */
      readonly buyers: "all" | readonly string[];
    };

const packPriceVariables: Readonly<Record<CreditPackId, string>> = {
  "pack-1": "DRAFT_LOOP_STRIPE_PRICE_PACK_1",
  "pack-5": "DRAFT_LOOP_STRIPE_PRICE_PACK_5",
};

function value(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? "").trim();
}

/**
 * Reads `DRAFT_LOOP_PAYMENTS` (#2708). Unset or `off`, nothing is sold. `stripe` needs:
 *
 * - `DRAFT_LOOP_STRIPE_MODE`: `test` (the default) or `live`. The key must be of that mode, so a
 *   live key never runs by mistake and a test key never stands in for a live setup.
 * - `DRAFT_LOOP_STRIPE_SECRET_KEY`: a secret or restricted key of that mode, from the
 *   deployment's secret.
 * - `DRAFT_LOOP_STRIPE_WEBHOOK_SECRET`: the signing secret of the webhook endpoint, from the
 *   deployment's secret.
 * - `DRAFT_LOOP_STRIPE_PRICE_PACK_1` and `DRAFT_LOOP_STRIPE_PRICE_PACK_5`: the Stripe price ids.
 * - `DRAFT_LOOP_PAYMENTS_RETURN_URL`: the web screen's HTTPS address.
 * - `DRAFT_LOOP_PAYMENTS_ORGANISATIONS`: the organisation ids that may buy, comma-separated, or
 *   `*` for every organisation. Unset, every organisation may buy in test mode; live mode needs
 *   it, so real sales open to everyone only on purpose.
 *
 * No message repeats the key or the signing secret.
 */
export function readPaymentsConfig(env: NodeJS.ProcessEnv): PaymentsConfig {
  const mode = value(env, "DRAFT_LOOP_PAYMENTS");
  if (mode === "" || mode === "off") return { mode: "off" };
  if (mode !== "stripe") throw new ApiConfigError("DRAFT_LOOP_PAYMENTS must be off or stripe.");

  const stripeMode = value(env, "DRAFT_LOOP_STRIPE_MODE") || "test";
  if (stripeMode !== "test" && stripeMode !== "live") {
    throw new ApiConfigError("DRAFT_LOOP_STRIPE_MODE must be test or live.");
  }
  const live = stripeMode === "live";
  const secretKey = value(env, "DRAFT_LOOP_STRIPE_SECRET_KEY");
  if (secretKey === "") {
    throw new ApiConfigError(
      `DRAFT_LOOP_PAYMENTS=stripe needs DRAFT_LOOP_STRIPE_SECRET_KEY, a ${stripeMode}-mode key.`,
    );
  }
  if (!new RegExp(`^(sk|rk)_${stripeMode}_[A-Za-z0-9]+$`, "u").test(secretKey)) {
    throw new ApiConfigError(
      `DRAFT_LOOP_STRIPE_SECRET_KEY must be a Stripe ${stripeMode}-mode key (sk_${stripeMode}_ or rk_${stripeMode}_), as DRAFT_LOOP_STRIPE_MODE says.`,
    );
  }
  const webhookSecret = value(env, "DRAFT_LOOP_STRIPE_WEBHOOK_SECRET");
  if (!/^whsec_[A-Za-z0-9+/=_-]+$/u.test(webhookSecret)) {
    throw new ApiConfigError(
      "DRAFT_LOOP_PAYMENTS=stripe needs DRAFT_LOOP_STRIPE_WEBHOOK_SECRET, the webhook endpoint's signing secret (whsec_).",
    );
  }
  const prices = Object.fromEntries(
    creditPackIds.map((id) => {
      const name = packPriceVariables[id];
      const price = value(env, name);
      if (!/^price_[A-Za-z0-9]+$/u.test(price)) {
        throw new ApiConfigError(`DRAFT_LOOP_PAYMENTS=stripe needs ${name}, a Stripe price id.`);
      }
      return [id, price];
    }),
  ) as Record<CreditPackId, string>;

  const returnUrl = value(env, "DRAFT_LOOP_PAYMENTS_RETURN_URL");
  let parsed: URL | undefined;
  try {
    parsed = new URL(returnUrl);
  } catch {
    parsed = undefined;
  }
  const local = parsed?.hostname === "localhost" || parsed?.hostname === "127.0.0.1";
  if (
    parsed === undefined ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== ""
  ) {
    throw new ApiConfigError(
      "DRAFT_LOOP_PAYMENTS=stripe needs DRAFT_LOOP_PAYMENTS_RETURN_URL, the web screen's HTTPS address.",
    );
  }
  return {
    mode: "stripe",
    secretKey,
    webhookSecret,
    prices,
    returnUrl: parsed.toString(),
    live,
    buyers: readBuyers(value(env, "DRAFT_LOOP_PAYMENTS_ORGANISATIONS"), live),
  };
}

const buyerPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function readBuyers(list: string, live: boolean): "all" | readonly string[] {
  if (list === "*" || (list === "" && !live)) return "all";
  const ids = list
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (ids.length === 0 || !ids.every((id) => buyerPattern.test(id))) {
    throw new ApiConfigError(
      "DRAFT_LOOP_STRIPE_MODE=live needs DRAFT_LOOP_PAYMENTS_ORGANISATIONS: the organisation ids that may buy, comma-separated, or * for every organisation.",
    );
  }
  return ids;
}

/** The deployment's payment provider: the checkout it opens and the events it sends. */
export interface Payments {
  readonly checkout: PaymentCheckoutPort;
  readonly events: PaymentEventsPort;
}

/** Builds the payment provider the config names; undefined when nothing is sold. */
export function paymentsFrom(config: PaymentsConfig, fetcher?: typeof fetch): Payments | undefined {
  if (config.mode === "off") return undefined;
  const back = (purchase: string): string => {
    const url = new URL(config.returnUrl);
    url.searchParams.set("purchase", purchase);
    return url.toString();
  };
  const { buyers } = config;
  return {
    checkout: createStripeCheckout({
      sellsTo: (organisationId) => buyers === "all" || buyers.includes(organisationId),
      secretKey: config.secretKey,
      prices: config.prices,
      successUrl: back("done"),
      cancelUrl: back("cancelled"),
      ...(fetcher === undefined ? {} : { fetch: fetcher }),
    }),
    events: createStripeEvents({
      live: config.live,
      webhookSecret: config.webhookSecret,
      secretKey: config.secretKey,
      ...(fetcher === undefined ? {} : { fetch: fetcher }),
    }),
  };
}
