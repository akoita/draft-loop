import { addUtcMonths } from "./credit-periods.js";
import type { SqlRow, SqlSession } from "./sql-client.js";

/** A completed checkout of a credit pack, as the payment provider reported it. */
export interface CreditPurchaseInput {
  /** The provider's checkout id: the key a repeated event is recognised by. */
  readonly checkoutId: string;
  /** The provider's id of the event that reported the payment. */
  readonly eventId: string;
  readonly packId: string;
  /** Credits the pack adds: a positive whole number. */
  readonly credits: number;
  /** Months until the credits expire, from the purchase. */
  readonly validMonths: number;
  /** What the buyer paid, tax included, in the currency's minor unit; unknown when absent. */
  readonly amountTotalCents?: number;
  /** The ISO 4217 code of the charge, in lower case. */
  readonly currency?: string;
  readonly now: Date;
}

export interface CreditPurchase {
  readonly checkoutId: string;
  readonly eventId: string;
  readonly packId: string;
  readonly credits: number;
  readonly amountTotalCents: number | null;
  readonly currency: string | null;
  /** The ledger grant that added the credits. */
  readonly grantSequence: number;
  readonly purchasedAt: string;
  /** When the provider refunded the purchase; null while it stands. */
  readonly refundedAt: string | null;
  /** The unspent credits the refund took from the balance; null while the purchase stands. */
  readonly creditsTakenBack: number | null;
}

/** A full refund of a purchase, as the payment provider reported it. */
export interface CreditPurchaseRefundInput {
  readonly checkoutId: string;
  /** The provider's id of the event that reported the refund. */
  readonly eventId: string;
  readonly now: Date;
}

export type CreditPurchaseRefundResult =
  /** The purchase is refunded now, and its unspent credits left the balance. */
  | { readonly outcome: "refunded"; readonly purchase: CreditPurchase }
  /** The purchase was refunded before; nothing changed. */
  | { readonly outcome: "already_refunded"; readonly purchase: CreditPurchase }
  /** The organisation holds no such purchase. */
  | { readonly outcome: "not_found" };

/** One tenant's credit pack purchases. */
export interface CreditPurchases {
  /**
   * Records the purchase and grants its credits, once: the row and the ledger grant are written
   * in one transaction under the organisation's ledger lock. The same checkout again returns the
   * stored purchase with `created: false` and grants nothing.
   */
  readonly record: (
    input: CreditPurchaseInput,
  ) => Promise<{ readonly created: boolean; readonly purchase: CreditPurchase }>;
  /**
   * Marks the purchase refunded, once, under the organisation's ledger lock. The credits of the
   * purchase that are neither spent nor held by a run leave the balance; spent credits stay
   * spent, so a balance never goes below zero. Credits a run holds are forfeited if the run gives
   * them back. The same refund again changes nothing.
   */
  readonly refund: (input: CreditPurchaseRefundInput) => Promise<CreditPurchaseRefundResult>;
  readonly get: (checkoutId: string) => Promise<CreditPurchase | undefined>;
}

export type CreditPurchaseErrorCode = "invalid_purchase" | "organisation_not_found";

/** A refused purchase. Messages never carry the rejected values. */
export class CreditPurchaseError extends Error {
  override readonly name = "CreditPurchaseError";
  readonly code: CreditPurchaseErrorCode;

  constructor(code: CreditPurchaseErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const providerIdPattern = /^[A-Za-z0-9_]{1,255}$/u;
const packIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const currencyPattern = /^[a-z]{3}$/u;

function invalid(message: string): CreditPurchaseError {
  return new CreditPurchaseError("invalid_purchase", message);
}

function requirePurchase(input: CreditPurchaseInput): void {
  if (!providerIdPattern.test(input.checkoutId)) throw invalid("The checkout id is not valid.");
  if (!providerIdPattern.test(input.eventId)) throw invalid("The event id is not valid.");
  if (!packIdPattern.test(input.packId)) throw invalid("The pack id is not valid.");
  if (!Number.isSafeInteger(input.credits) || input.credits < 1) {
    throw invalid("Credits must be a positive whole number.");
  }
  if (!Number.isInteger(input.validMonths) || input.validMonths < 1 || input.validMonths > 36) {
    throw invalid("The validity must be 1 to 36 months.");
  }
  if (
    input.amountTotalCents !== undefined &&
    (!Number.isSafeInteger(input.amountTotalCents) || input.amountTotalCents < 0)
  ) {
    throw invalid("The amount must be a whole number of 0 or more.");
  }
  if (input.currency !== undefined && !currencyPattern.test(input.currency)) {
    throw invalid("The currency must be a three-letter code in lower case.");
  }
  if (Number.isNaN(input.now.getTime())) throw invalid("A clock must be a valid date.");
}

const purchaseColumns =
  "checkout_id, event_id, pack_id, credits, amount_total_cents, currency, grant_sequence, purchased_at, refunded_at, credits_taken_back";
const purchaseSelect = `SELECT ${purchaseColumns} FROM credit_purchases`;

function isoTime(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function purchase(row: SqlRow): CreditPurchase {
  return {
    checkoutId: String(row.checkout_id),
    eventId: String(row.event_id),
    packId: String(row.pack_id),
    credits: Number(row.credits),
    amountTotalCents: row.amount_total_cents === null ? null : Number(row.amount_total_cents),
    currency: row.currency === null ? null : String(row.currency),
    grantSequence: Number(row.grant_sequence),
    purchasedAt: isoTime(row.purchased_at),
    refundedAt:
      row.refunded_at === null || row.refunded_at === undefined ? null : isoTime(row.refunded_at),
    creditsTakenBack:
      row.credits_taken_back === null || row.credits_taken_back === undefined
        ? null
        : Number(row.credits_taken_back),
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23503";
}

export function createCreditPurchases(client: SqlSession): CreditPurchases {
  return {
    record: async (input) => {
      requirePurchase(input);
      try {
        return await client.transaction(async (executor) => {
          // The ledger's own lock (`credit-ledger.ts`): one writer per organisation, so a racing
          // duplicate event waits here and then finds the stored purchase.
          await executor.query("INSERT INTO credit_balances DEFAULT VALUES ON CONFLICT DO NOTHING");
          await executor.query("SELECT tenant_id FROM credit_balances FOR UPDATE");
          const [stored] = await executor.query(`${purchaseSelect} WHERE checkout_id = $1`, [
            input.checkoutId,
          ]);
          if (stored !== undefined) return { created: false, purchase: purchase(stored) };

          const [grant] = await executor.query(
            `INSERT INTO credit_ledger (kind, amount, bucket, reason, expires_at, created_at)
             VALUES ('grant', $1, 'grant', $2, $3, $4)
             RETURNING sequence`,
            [
              input.credits,
              `purchase.${input.packId}`,
              addUtcMonths(input.now, input.validMonths).toISOString(),
              input.now.toISOString(),
            ],
          );
          const [row] = await executor.query(
            `INSERT INTO credit_purchases
               (checkout_id, event_id, pack_id, credits, amount_total_cents, currency,
                grant_sequence, purchased_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${purchaseColumns}`,
            [
              input.checkoutId,
              input.eventId,
              input.packId,
              input.credits,
              input.amountTotalCents ?? null,
              input.currency ?? null,
              Number(grant?.sequence),
              input.now.toISOString(),
            ],
          );
          if (row === undefined) throw invalid("The purchase could not be stored.");
          return { created: true, purchase: purchase(row) };
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new CreditPurchaseError("organisation_not_found", "No such organisation.");
        }
        throw error;
      }
    },
    refund: async (input) => {
      if (!providerIdPattern.test(input.checkoutId)) throw invalid("The checkout id is not valid.");
      if (!providerIdPattern.test(input.eventId)) throw invalid("The event id is not valid.");
      if (Number.isNaN(input.now.getTime())) throw invalid("A clock must be a valid date.");
      return await client.transaction(async (executor) => {
        // The ledger's lock: no reservation draws on the grant while its remainder is counted.
        const locked = await executor.query("SELECT tenant_id FROM credit_balances FOR UPDATE");
        const [stored] = await executor.query(`${purchaseSelect} WHERE checkout_id = $1`, [
          input.checkoutId,
        ]);
        if (locked.length === 0 || stored === undefined) return { outcome: "not_found" as const };
        if (stored.refunded_at !== null && stored.refunded_at !== undefined) {
          return { outcome: "already_refunded" as const, purchase: purchase(stored) };
        }
        // What a reservation could still draw on: the grant less what runs reserved and did not
        // give back, less what already expired.
        const [left] = await executor.query(
          `SELECT g.amount
                  - COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'reserve'), 0)
                  + COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'refund'), 0)
                  - COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'expire'), 0) AS available
             FROM credit_ledger g
             LEFT JOIN credit_ledger l
               ON l.tenant_id = g.tenant_id AND l.grant_sequence = g.sequence
            WHERE g.kind = 'grant' AND g.sequence = $1
            GROUP BY g.tenant_id, g.sequence`,
          [Number(stored.grant_sequence)],
        );
        const takenBack = Math.max(0, Number(left?.available ?? 0));
        const [row] = await executor.query(
          `UPDATE credit_purchases
              SET refunded_at = $2, refund_event_id = $3, credits_taken_back = $4
            WHERE checkout_id = $1
            RETURNING ${purchaseColumns}`,
          [input.checkoutId, input.now.toISOString(), input.eventId, takenBack],
        );
        if (row === undefined) throw invalid("The refund could not be stored.");
        return { outcome: "refunded" as const, purchase: purchase(row) };
      });
    },
    get: async (checkoutId) => {
      if (!providerIdPattern.test(checkoutId)) throw invalid("The checkout id is not valid.");
      const [row] = await client.query(`${purchaseSelect} WHERE checkout_id = $1`, [checkoutId]);
      return row === undefined ? undefined : purchase(row);
    },
  };
}
