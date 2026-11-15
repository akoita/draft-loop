import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCreditPurchaseRoutes } from "./credit-purchase-routes.js";
import { sendError } from "./errors.js";
import { type PaymentCheckoutPort, PaymentProviderError } from "./payment-checkout.js";
import type { Caller } from "./request-auth.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const member: Caller = { kind: "member", tenantId: "org-north", memberId: "m-1", role: "member" };
const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_1";

function payments(
  start: PaymentCheckoutPort["startCreditPackCheckout"] = async () => ({
    checkoutId: "cs_test_1",
    url: checkoutUrl,
  }),
) {
  return { startCreditPackCheckout: vi.fn(start) };
}

async function server(options: {
  readonly caller?: Caller;
  readonly payments?: PaymentCheckoutPort;
  readonly signIn?: boolean;
}) {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(sendError);
  app.decorateRequest("caller", undefined);
  app.addHook("onRequest", async (request) => {
    request.caller = options.caller ?? member;
  });
  registerCreditPurchaseRoutes(app, {
    payments: options.payments,
    signIn: options.signIn ?? true,
  });
  return app;
}

const buy = (api: FastifyInstance, payload: Record<string, unknown> = { pack: "pack-5" }) =>
  api.inject({ method: "POST", url: "/v1/organisation/credit-purchases", payload });

describe("credit pack purchase", () => {
  it("answers the hosted checkout for the member's organisation and the pack", async () => {
    const provider = payments();
    const response = await buy(await server({ payments: provider }));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      pack: "pack-5",
      credits: 5,
      priceEurCents: 2200,
      checkoutUrl,
    });
    expect(provider.startCreditPackCheckout).toHaveBeenCalledWith({
      organisationId: "org-north",
      memberId: "m-1",
      pack: {
        id: "pack-5",
        label: "5 applications",
        credits: 5,
        priceEurCents: 2200,
        validMonths: 12,
      },
    });
  });

  it("answers 503 when the service sells nothing", async () => {
    const response = await buy(await server({}));

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("payments_unavailable");
  });

  it("answers 502 without the provider's words when the provider fails", async () => {
    const provider = payments(async () => {
      throw new PaymentProviderError("The payment provider refused the checkout (HTTP 401).", 401);
    });
    const response = await buy(await server({ payments: provider }));

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toEqual({
      code: "payment_provider_failed",
      message: "The payment page could not be opened; retry.",
    });
  });

  it.each([
    ["an unknown pack", { pack: "pack-100" }],
    ["an extra field", { pack: "pack-1", credits: 50 }],
    ["no pack", {}],
  ])("refuses %s before reaching the provider", async (_, payload) => {
    const provider = payments();
    const response = await buy(await server({ payments: provider }), payload);

    expect(response.statusCode).toBe(400);
    expect(provider.startCreditPackCheckout).not.toHaveBeenCalled();
  });

  it("is not served to the owner token or outside sign-in mode", async () => {
    const provider = payments();
    const asOwner = await buy(await server({ payments: provider, caller: { kind: "owner" } }));
    expect(asOwner.statusCode).toBe(404);
    await app?.close();

    const ownerMode = await buy(await server({ payments: provider, signIn: false }));
    expect(ownerMode.statusCode).toBe(404);
    expect(provider.startCreditPackCheckout).not.toHaveBeenCalled();
  });
});
