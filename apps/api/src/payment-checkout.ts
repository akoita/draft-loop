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
