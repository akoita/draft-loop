import type { CreditPackId } from "@draft-loop/schemas/entitlements";

import {
  type CreditPackCheckout,
  type PaymentCheckoutPort,
  PaymentProviderError,
} from "./payment-checkout.js";

/** The first API version that accepts `managed_payments` on a Checkout Session. */
export const stripeApiVersion = "2025-03-31.basil";

export interface StripeCheckoutOptions {
  /** A test-mode secret or restricted key. It is sent only to Stripe, as the request's credential. */
  readonly secretKey: string;
  /** The Stripe price of each pack, created in the Dashboard with an eligible tax code. */
  readonly prices: Readonly<Record<CreditPackId, string>>;
  /** Where Stripe sends the buyer back after paying or giving up. */
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly fetch?: typeof fetch;
  /** How long one call may take, in milliseconds. */
  readonly timeoutMs?: number;
}

const endpoint = "https://api.stripe.com/v1/checkout/sessions";

/**
 * Stripe Managed Payments behind the payment port (#2708): one hosted Checkout Session per
 * purchase, with Stripe as the merchant of record. The session names the organisation, the member
 * and the pack so that the completion event can grant the credits; it carries no email, no name
 * and no candidate material. Stripe collects the buyer's details on its own page.
 */
export function createStripeCheckout(options: StripeCheckoutOptions): PaymentCheckoutPort {
  const call = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    startCreditPackCheckout: async ({ organisationId, memberId, pack }) => {
      const form = new URLSearchParams({
        mode: "payment",
        "line_items[0][price]": options.prices[pack.id],
        "line_items[0][quantity]": "1",
        "managed_payments[enabled]": "true",
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        client_reference_id: organisationId,
        "metadata[organisation_id]": organisationId,
        "metadata[member_id]": memberId,
        "metadata[pack_id]": pack.id,
        "metadata[credits]": String(pack.credits),
      });
      let response: Response;
      try {
        response = await call(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
            "stripe-version": stripeApiVersion,
          },
          body: form.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new PaymentProviderError("The payment provider could not be reached.");
      }
      if (!response.ok) {
        // Stripe's error body can echo request values; only the status leaves the adapter.
        throw new PaymentProviderError(
          `The payment provider refused the checkout (HTTP ${response.status}).`,
          response.status,
        );
      }
      const session = (await response.json().catch(() => undefined)) as
        | { readonly id?: unknown; readonly url?: unknown }
        | undefined;
      if (typeof session?.id !== "string" || typeof session.url !== "string") {
        throw new PaymentProviderError("The payment provider answered without a checkout page.");
      }
      return checkoutOnStripe({ checkoutId: session.id, url: session.url });
    },
  };
}

/** The buyer is only ever sent to Stripe's own checkout over HTTPS. */
function checkoutOnStripe(checkout: CreditPackCheckout): CreditPackCheckout {
  let host: string;
  try {
    const url = new URL(checkout.url);
    host = url.protocol === "https:" ? url.hostname : "";
  } catch {
    host = "";
  }
  if (host !== "checkout.stripe.com" && !host.endsWith(".stripe.com")) {
    throw new PaymentProviderError("The payment provider answered with an unexpected page.");
  }
  return checkout;
}
