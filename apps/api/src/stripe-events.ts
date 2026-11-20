import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type PaymentEvent,
  type PaymentEventsPort,
  PaymentProviderError,
  PaymentSignatureError,
} from "./payment-checkout.js";
import { stripeApiVersion } from "./stripe-checkout.js";

/** How old a signed event may be, in seconds, as Stripe's own libraries allow. */
export const stripeSignatureToleranceSeconds = 300;

/** Signs a body the way Stripe does; tests and the local walk use it. */
export function signStripePayload(rawBody: Buffer | string, secret: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function verify(rawBody: Buffer, header: string | undefined, secret: string, now: Date): void {
  const parts = (header ?? "").split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([name]) => name === "t")?.[1]);
  const signatures = parts.filter(([name]) => name === "v1").map(([, value]) => value ?? "");
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    throw new PaymentSignatureError("The event carries no signature.");
  }
  if (Math.abs(now.getTime() / 1000 - timestamp) > stripeSignatureToleranceSeconds) {
    throw new PaymentSignatureError("The event's signature is too old.");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  const signed = signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!signed) throw new PaymentSignatureError("The event's signature does not match.");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const paidEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

const organisationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const paymentIdPattern = /^pi_[A-Za-z0-9]{1,250}$/u;

export interface StripeEventsOptions {
  /** Live mode acts only on live events; test mode only on test events. Test when unset. */
  readonly live?: boolean;
  readonly webhookSecret: string;
  /** The key that reads a refunded payment's Checkout Session; sent only to Stripe. */
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
  /** How long one call may take, in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Stripe's signed events behind the payment port (#2709, #2710). A completed Checkout Session
 * whose payment is settled becomes `credit_pack_paid`, and a charge refunded in full becomes
 * `payment_refunded`; everything else is ignored with a reason. A partial refund is ignored: it
 * takes no credits back. An event of the other mode is ignored: a live payment must never grant
 * credits on a test deployment, and a test payment never on a live one.
 */
export function createStripeEvents(options: StripeEventsOptions): PaymentEventsPort {
  const call = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const live = options.live === true;
  return {
    findCheckoutOfPayment: async (paymentId) => {
      if (!paymentIdPattern.test(paymentId)) return undefined;
      const query = new URLSearchParams({ payment_intent: paymentId, limit: "1" });
      let response: Response;
      try {
        response = await call(`https://api.stripe.com/v1/checkout/sessions?${query.toString()}`, {
          headers: {
            authorization: `Bearer ${options.secretKey}`,
            "stripe-version": stripeApiVersion,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new PaymentProviderError("The payment provider could not be reached.");
      }
      if (!response.ok) {
        throw new PaymentProviderError(
          `The payment provider refused the checkout lookup (HTTP ${response.status}).`,
          response.status,
        );
      }
      const list = (await response.json().catch(() => undefined)) as
        | { readonly data?: readonly Record<string, unknown>[] }
        | undefined;
      if (!Array.isArray(list?.data)) {
        throw new PaymentProviderError("The payment provider answered without a checkout list.");
      }
      const session = list.data[0];
      const checkoutId = text(session?.id);
      const organisationId = text(
        (session?.metadata as Record<string, unknown> | undefined)?.organisation_id,
      );
      if (
        checkoutId === undefined ||
        organisationId === undefined ||
        !organisationIdPattern.test(organisationId)
      ) {
        return undefined;
      }
      return { checkoutId, organisationId };
    },
    readEvent: (rawBody, signature, now): PaymentEvent => {
      verify(rawBody, signature, options.webhookSecret, now);
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
      } catch {
        return { kind: "ignored", reason: "unreadable" };
      }
      const eventId = text(event?.id);
      const ignored = (reason: string): PaymentEvent => ({
        kind: "ignored",
        ...(eventId === undefined ? {} : { eventId }),
        reason,
      });
      if (eventId === undefined) return ignored("unreadable");
      if (event.livemode !== live) return ignored(live ? "test_event" : "live_event");
      const object = (event.data as { object?: Record<string, unknown> } | undefined)?.object;
      if (event.type === "charge.refunded") {
        const paymentId = text(object?.payment_intent);
        if (object?.refunded !== true) return ignored("partial_refund");
        if (paymentId === undefined || !paymentIdPattern.test(paymentId)) {
          return ignored("not_a_credit_pack");
        }
        return { kind: "payment_refunded", eventId, paymentId };
      }
      if (!paidEvents.has(String(event.type))) return ignored("other_event");

      const session = object;
      // A delayed payment method completes the session before the money arrives; the
      // `async_payment_succeeded` event reports it paid later.
      if (session?.payment_status !== "paid") return ignored("not_paid");
      const metadata = (session.metadata ?? {}) as Record<string, unknown>;
      const checkoutId = text(session.id);
      const organisationId = text(metadata.organisation_id);
      const packId = text(metadata.pack_id);
      if (
        checkoutId === undefined ||
        organisationId === undefined ||
        !organisationIdPattern.test(organisationId) ||
        packId === undefined
      ) {
        return ignored("not_a_credit_pack");
      }
      const amount = session.amount_total;
      const currency = text(session.currency)?.toLowerCase();
      return {
        kind: "credit_pack_paid",
        eventId,
        checkoutId,
        organisationId,
        packId,
        ...(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0
          ? { amountTotalCents: amount }
          : {}),
        ...(currency !== undefined && /^[a-z]{3}$/u.test(currency) ? { currency } : {}),
      };
    },
  };
}
