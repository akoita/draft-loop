import { type CreditPackId, creditPackIds } from "@draft-loop/schemas/entitlements";

import { ApiConfigError } from "./config.js";
import type { PaymentCheckoutPort } from "./payment-checkout.js";
import { createStripeCheckout } from "./stripe-checkout.js";

/** The deployment's payment choice, read before anything opens. */
export type PaymentsConfig =
  | { readonly mode: "off" }
  | {
      readonly mode: "stripe";
      readonly secretKey: string;
      readonly prices: Readonly<Record<CreditPackId, string>>;
      /** The web screen's address, where the buyer comes back. */
      readonly returnUrl: string;
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
 * - `DRAFT_LOOP_STRIPE_SECRET_KEY`: a test-mode secret or restricted key, from the deployment's
 *   secret. A live key stops the start: payments run in test mode until the live account and the
 *   legal pages are in place.
 * - `DRAFT_LOOP_STRIPE_PRICE_PACK_1` and `DRAFT_LOOP_STRIPE_PRICE_PACK_5`: the Stripe price ids.
 * - `DRAFT_LOOP_PAYMENTS_RETURN_URL`: the web screen's HTTPS address.
 *
 * No message repeats the key.
 */
export function readPaymentsConfig(env: NodeJS.ProcessEnv): PaymentsConfig {
  const mode = value(env, "DRAFT_LOOP_PAYMENTS");
  if (mode === "" || mode === "off") return { mode: "off" };
  if (mode !== "stripe") throw new ApiConfigError("DRAFT_LOOP_PAYMENTS must be off or stripe.");

  const secretKey = value(env, "DRAFT_LOOP_STRIPE_SECRET_KEY");
  if (secretKey === "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_PAYMENTS=stripe needs DRAFT_LOOP_STRIPE_SECRET_KEY, a test-mode key.",
    );
  }
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/u.test(secretKey)) {
    throw new ApiConfigError(
      "DRAFT_LOOP_STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_ or rk_test_); live keys are refused.",
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
  return { mode: "stripe", secretKey, prices, returnUrl: parsed.toString() };
}

/** Builds the payment port the config names; undefined when nothing is sold. */
export function paymentsFrom(
  config: PaymentsConfig,
  fetcher?: typeof fetch,
): PaymentCheckoutPort | undefined {
  if (config.mode === "off") return undefined;
  const back = (purchase: string): string => {
    const url = new URL(config.returnUrl);
    url.searchParams.set("purchase", purchase);
    return url.toString();
  };
  return createStripeCheckout({
    secretKey: config.secretKey,
    prices: config.prices,
    successUrl: back("done"),
    cancelUrl: back("cancelled"),
    ...(fetcher === undefined ? {} : { fetch: fetcher }),
  });
}
