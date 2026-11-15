import { CreditPurchaseError, type CreditPurchases } from "@draft-loop/storage-postgres";

import type { PaymentEvent, PaymentEventsPort } from "./payment-checkout.js";

export interface RefundedPayment {
  readonly events: Pick<PaymentEventsPort, "findCheckoutOfPayment">;
  readonly purchasesFor: (organisationId: string) => Pick<CreditPurchases, "refund">;
  readonly event: Extract<PaymentEvent, { kind: "payment_refunded" }>;
  readonly at: Date;
}

/** What the log says about a handled refund: ids, codes and numbers only. */
export interface RefundLogEntry {
  readonly event: "credit_pack_refunded" | "credit_pack_already_refunded" | "payment_event_ignored";
  readonly eventId: string;
  readonly reason?: string;
  readonly organisationId?: string;
  readonly creditsTakenBack?: number | null;
}

/**
 * A payment refunded in full (#2710): the purchase's unspent credits leave the organisation's
 * balance, once. The refund event names only the payment, so the provider is asked which
 * checkout it paid for. A payment that is no purchase of this service is ignored; a provider or
 * storage failure throws, the route answers 500 and the provider sends the event again.
 */
export async function takeBackRefundedCredits(
  { events, purchasesFor, event, at }: RefundedPayment,
  log: (entry: RefundLogEntry) => void,
): Promise<"refunded" | "already_refunded" | "ignored"> {
  const ignored = (reason: string) => {
    log({ event: "payment_event_ignored", eventId: event.eventId, reason });
    return "ignored" as const;
  };
  const checkout = await events.findCheckoutOfPayment(event.paymentId);
  if (checkout === undefined) return ignored("not_a_credit_pack");
  let result: Awaited<ReturnType<CreditPurchases["refund"]>>;
  try {
    result = await purchasesFor(checkout.organisationId).refund({
      checkoutId: checkout.checkoutId,
      eventId: event.eventId,
      now: at,
    });
  } catch (error) {
    if (error instanceof CreditPurchaseError) return ignored(error.code);
    throw error;
  }
  if (result.outcome === "not_found") return ignored("unknown_purchase");
  log({
    event: result.outcome === "refunded" ? "credit_pack_refunded" : "credit_pack_already_refunded",
    eventId: event.eventId,
    organisationId: checkout.organisationId,
    creditsTakenBack: result.purchase.creditsTakenBack,
  });
  return result.outcome;
}
