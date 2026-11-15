import type { CreditPack } from "@draft-loop/schemas/entitlements";

/** What a checkout needs: who buys which pack. Ids and catalog data only. */
export interface CreditPackCheckoutRequest {
  /** The organisation the credits are for. */
  readonly organisationId: string;
  /** The member who started the purchase. */
  readonly memberId: string;
  readonly pack: CreditPack;
}

/** A hosted checkout page the buyer is sent to. */
export interface CreditPackCheckout {
  /** The provider's id of the checkout, which its events name. */
  readonly checkoutId: string;
  /** The hosted page's address, on the provider's own domain. */
  readonly url: string;
}

/**
 * The payment provider as the API sees it (#2682): a merchant of record that hosts the checkout,
 * charges the buyer and sends events. Billing only feeds entitlements (ADR 0011, D13), so nothing
 * outside the adapter names the provider.
 */
export interface PaymentCheckoutPort {
  readonly startCreditPackCheckout: (
    request: CreditPackCheckoutRequest,
  ) => Promise<CreditPackCheckout>;
}

/** The provider refused or could not be reached. The message never carries a key or a body. */
export class PaymentProviderError extends Error {
  override readonly name = "PaymentProviderError";
  /** The provider's HTTP status, or undefined when it was not reached. */
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** The route the payment provider sends its events to; public, and trusted only by signature. */
export const paymentEventsPath = "/v1/payments/events";

/** What a provider event means to the service. Ids, codes and numbers only. */
export type PaymentEvent =
  | {
      readonly kind: "credit_pack_paid";
      readonly eventId: string;
      readonly checkoutId: string;
      readonly organisationId: string;
      readonly packId: string;
      /** What the buyer paid, tax included, in the currency's minor unit. */
      readonly amountTotalCents?: number;
      readonly currency?: string;
    }
  /** The provider refunded a payment in full. The payment's checkout is looked up by its id. */
  | { readonly kind: "payment_refunded"; readonly eventId: string; readonly paymentId: string }
  /** An event the service does not act on, with the reason for the log. */
  | { readonly kind: "ignored"; readonly eventId?: string; readonly reason: string };

/** The provider's signed events, as the API reads them (#2709). */
export interface PaymentEventsPort {
  /**
   * Checks the signature over the raw body and reads the event. Throws `PaymentSignatureError`
   * for a body the provider did not sign with the deployment's secret.
   */
  readonly readEvent: (rawBody: Buffer, signature: string | undefined, now: Date) => PaymentEvent;
  /**
   * The checkout a payment paid for, read from the provider (#2710): a refund event names the
   * payment, not the checkout or the organisation. Undefined when the payment is not a credit
   * pack checkout of this service. Throws `PaymentProviderError` when the provider cannot answer.
   */
  readonly findCheckoutOfPayment: (
    paymentId: string,
  ) => Promise<{ readonly checkoutId: string; readonly organisationId: string } | undefined>;
}

/** The event was not signed by the provider, or its signature is too old. */
export class PaymentSignatureError extends Error {
  override readonly name = "PaymentSignatureError";
}
