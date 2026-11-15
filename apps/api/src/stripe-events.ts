import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type PaymentEvent,
  type PaymentEventsPort,
  PaymentSignatureError,
} from "./payment-checkout.js";

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

/**
 * Stripe's signed events behind the payment port (#2709). A completed Checkout Session whose
 * payment is settled becomes `credit_pack_paid`; everything else is ignored with a reason. The
 * deployment runs in test mode, so a live event is ignored: a live payment must never grant
 * credits on a test deployment.
 */
export function createStripeEvents(options: { readonly webhookSecret: string }): PaymentEventsPort {
  return {
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
      if (event.livemode !== false) return ignored("live_event");
      if (!paidEvents.has(String(event.type))) return ignored("other_event");

      const session = (event.data as { object?: Record<string, unknown> } | undefined)?.object;
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
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(organisationId) ||
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
