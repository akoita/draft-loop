import { creditPackIds, planCatalog } from "@draft-loop/schemas/entitlements";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { type PaymentCheckoutPort, PaymentProviderError } from "./payment-checkout.js";

export interface CreditPurchaseRoutesOptions {
  /** The deployment's payment provider; without one the route answers 503. */
  readonly payments?: PaymentCheckoutPort | undefined;
  /** Sign-in mode. Owner-token mode has no organisation to buy for: the route answers 404. */
  readonly signIn: boolean;
}

const purchaseBody = z.strictObject({
  pack: z.enum(creditPackIds).describe("The credit pack to buy, by its catalog id."),
});

const checkoutSchema = z
  .object({
    pack: z.enum(creditPackIds),
    credits: z.number().int().describe("The credits the pack adds once the payment completes."),
    priceEurCents: z.number().int().describe("The pack's catalog price in euro cents."),
    checkoutUrl: z
      .string()
      .describe("The payment provider's hosted checkout page; send the buyer there."),
  })
  .meta({ id: "CreditPackCheckout" });

/**
 * A member starts the purchase of a credit pack (#2708). The answer is the address of the payment
 * provider's hosted checkout; the provider is the seller, takes the buyer's details on its own
 * page and sends its own receipt. No credit is granted here: the provider's completion event
 * grants them. Sign-in mode only, any role.
 */
export function registerCreditPurchaseRoutes(
  parent: FastifyInstance,
  options: CreditPurchaseRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { payments } = options;

  app.post(
    "/v1/organisation/credit-purchases",
    {
      schema: {
        summary: "Start buying a credit pack",
        description:
          "Opens a hosted checkout for one credit pack and answers its address. The payment provider sells the pack, collects the buyer's details and tax on its own page and sends the receipt. The credits reach the balance when the provider confirms the payment, not when this route answers. 503 payments_unavailable when the service sells nothing; 502 payment_provider_failed when the provider refuses or cannot be reached. Sign-in mode only.",
        body: purchaseBody,
        response: {
          201: checkoutSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          502: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.caller;
      if (!options.signIn || caller?.kind !== "member") {
        return reply.code(404).send(apiError("not_found", "No such route.", { resource: "route" }));
      }
      if (payments === undefined) {
        return reply
          .code(503)
          .send(apiError("payments_unavailable", "This service does not sell credit packs."));
      }
      const pack = planCatalog.creditPacks.find(({ id }) => id === request.body.pack);
      if (pack === undefined) {
        return reply
          .code(503)
          .send(apiError("payments_unavailable", "This credit pack is not sold."));
      }
      try {
        const checkout = await payments.startCreditPackCheckout({
          organisationId: caller.tenantId,
          memberId: caller.memberId,
          pack,
        });
        request.log.info(
          { event: "credit_pack_checkout_started", organisationId: caller.tenantId, pack: pack.id },
          "credit pack checkout started",
        );
        return reply.code(201).send({
          pack: pack.id,
          credits: pack.credits,
          priceEurCents: pack.priceEurCents,
          checkoutUrl: checkout.url,
        });
      } catch (error) {
        if (!(error instanceof PaymentProviderError)) throw error;
        request.log.error(
          { event: "payment_provider_failed", status: error.status },
          "payment provider failed",
        );
        return reply
          .code(502)
          .send(
            apiError("payment_provider_failed", "The payment page could not be opened; retry."),
          );
      }
    },
  );
}
