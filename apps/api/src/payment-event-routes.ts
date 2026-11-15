import { planCatalog } from "@draft-loop/schemas/entitlements";
import { CreditPurchaseError, type CreditPurchases } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import {
  type PaymentEventsPort,
  PaymentSignatureError,
  paymentEventsPath,
} from "./payment-checkout.js";
import { takeBackRefundedCredits } from "./payment-refund.js";

/** Larger than any event the provider sends; a bigger body is refused before it is read. */
const maximumEventBytes = 262_144;

export interface PaymentEventRoutesOptions {
  readonly events: PaymentEventsPort;
  /** An organisation's purchases, by the organisation id the checkout named. */
  readonly purchasesFor: (organisationId: string) => Pick<CreditPurchases, "record" | "refund">;
  readonly now?: () => Date;
}

const receivedSchema = z
  .object({
    received: z.literal(true),
    outcome: z
      .enum(["granted", "already_granted", "refunded", "already_refunded", "ignored"])
      .describe(
        "What the event did: credits granted, unspent credits of a refunded purchase taken back, a repeat that changed nothing, or ignored.",
      ),
  })
  .meta({ id: "PaymentEventReceipt" });

/**
 * The payment provider reports a completed checkout (#2709) and the pack's credits reach the
 * organisation's balance, once. The route takes no credential: the provider's signature over the
 * raw body is the proof, checked before anything is read. The credits and their validity come
 * from the plan catalog by pack id, never from the event. A full refund takes the purchase's
 * unspent credits back (#2710). An event that cannot grant (unknown
 * pack or organisation, another event type, a live event) answers 200 so that the provider stops
 * retrying it; a storage failure answers 500 so that it retries.
 */
export function registerPaymentEventRoutes(
  parent: FastifyInstance,
  options: PaymentEventRoutesOptions,
): void {
  const { events, purchasesFor } = options;
  const now = options.now ?? (() => new Date());

  void parent.register(async (scope) => {
    const app = scope.withTypeProvider<ZodTypeProvider>();
    // The signature covers the exact bytes, so the body stays a buffer.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: maximumEventBytes },
      (_request, body, done) => done(null, body),
    );
    app.post(
      paymentEventsPath,
      {
        bodyLimit: maximumEventBytes,
        schema: {
          summary: "Receive a payment provider event",
          description:
            "For the payment provider only. The body is the provider's event and the `Stripe-Signature` header signs it; a body without a valid, recent signature answers 400 invalid_signature. A completed, paid checkout of a credit pack grants the pack's credits once, by checkout id. A full refund of that payment takes the purchase's unspent credits back once. Other events answer 200 with `ignored`.",
          security: [],
          body: z.unknown().meta({ type: "object" }),
          response: { 200: receivedSchema, 400: apiErrorSchema },
        },
      },
      async (request, reply) => {
        const at = now();
        const signature = request.headers["stripe-signature"];
        let event: ReturnType<PaymentEventsPort["readEvent"]>;
        try {
          event = events.readEvent(
            Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
            typeof signature === "string" ? signature : undefined,
            at,
          );
        } catch (error) {
          if (!(error instanceof PaymentSignatureError)) throw error;
          request.log.warn({ event: "payment_event_unsigned" }, "payment event refused");
          return reply
            .code(400)
            .send(apiError("invalid_signature", "The event is not signed by the provider."));
        }
        const ignore = (reason: string, eventId?: string) => {
          request.log.info(
            { event: "payment_event_ignored", reason, eventId },
            "payment event ignored",
          );
          return reply.send({ received: true as const, outcome: "ignored" as const });
        };
        if (event.kind === "ignored") return ignore(event.reason, event.eventId);
        if (event.kind === "payment_refunded") {
          const outcome = await takeBackRefundedCredits(
            { events, purchasesFor, event, at },
            (entry) => request.log.info(entry, "payment refund handled"),
          );
          return reply.send({ received: true as const, outcome });
        }

        const pack = planCatalog.creditPacks.find(({ id }) => id === event.packId);
        if (pack === undefined) return ignore("unknown_pack", event.eventId);
        try {
          const { created } = await purchasesFor(event.organisationId).record({
            checkoutId: event.checkoutId,
            eventId: event.eventId,
            packId: pack.id,
            credits: pack.credits,
            validMonths: pack.validMonths,
            ...(event.amountTotalCents === undefined
              ? {}
              : { amountTotalCents: event.amountTotalCents }),
            ...(event.currency === undefined ? {} : { currency: event.currency }),
            now: at,
          });
          request.log.info(
            {
              event: created ? "credit_pack_granted" : "credit_pack_already_granted",
              organisationId: event.organisationId,
              pack: pack.id,
              credits: pack.credits,
              eventId: event.eventId,
            },
            created ? "credit pack granted" : "credit pack already granted",
          );
          return reply.send({
            received: true as const,
            outcome: created ? ("granted" as const) : ("already_granted" as const),
          });
        } catch (error) {
          // A paid checkout for an organisation that is gone, or with ids the store refuses:
          // retrying cannot help, and the operator sees it in the log.
          if (error instanceof CreditPurchaseError) {
            request.log.error(
              { event: "credit_pack_not_granted", reason: error.code, eventId: event.eventId },
              "credit pack not granted",
            );
            return reply.send({ received: true as const, outcome: "ignored" as const });
          }
          throw error;
        }
      },
    );
  });
}
