import { CreditPurchaseError, type CreditPurchases } from "@draft-loop/storage-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendError } from "./errors.js";
import { paymentEventsPath } from "./payment-checkout.js";
import { registerPaymentEventRoutes } from "./payment-event-routes.js";
import { createStripeEvents, signStripePayload } from "./stripe-events.js";

const secret = "whsec_fictional9876543210";
const now = new Date("2026-11-15T08:00:00.000Z");
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Record_ = CreditPurchases["record"];
type Refund = CreditPurchases["refund"];

/** What Stripe answers when asked for the Checkout Session of a payment. */
const sessionOfPayment = {
  data: [{ id: "cs_test_fictional1", metadata: { organisation_id: "org-north" } }],
};

async function server(
  record: Record_ = async () => ({ created: true }) as never,
  refund: Refund = async () =>
    ({ outcome: "refunded", purchase: { creditsTakenBack: 3 } }) as never,
  lookup: () => Promise<Response> = async () => Response.json(sessionOfPayment),
) {
  const stored = vi.fn(record);
  const refunded = vi.fn(refund);
  const stripe = vi.fn(lookup);
  const purchasesFor = vi.fn(() => ({ record: stored, refund: refunded }));
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(sendError);
  registerPaymentEventRoutes(app, {
    events: createStripeEvents({
      webhookSecret: secret,
      secretKey: "sk_test_fictional",
      fetch: stripe as unknown as typeof fetch,
    }),
    purchasesFor,
    now: () => now,
  });
  await app.ready();
  return { app, stored, refunded, stripe, purchasesFor };
}

function refundEvent(charge: Record<string, unknown> = {}, change: Record<string, unknown> = {}) {
  return {
    id: "evt_refund1",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_fictional1",
        payment_intent: "pi_fictional1",
        refunded: true,
        amount_refunded: 2200,
        ...charge,
      },
    },
    ...change,
  };
}

function paid(change: Record<string, unknown> = {}, session: Record<string, unknown> = {}) {
  return {
    id: "evt_fictional1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_fictional1",
        payment_status: "paid",
        amount_total: 2200,
        currency: "EUR",
        metadata: {
          organisation_id: "org-north",
          member_id: "m-1",
          pack_id: "pack-5",
          credits: "500",
        },
        ...session,
      },
    },
    ...change,
  };
}

function send(
  api: FastifyInstance,
  event: unknown,
  options: { readonly signature?: string; readonly signedAt?: Date; readonly with?: string } = {},
) {
  const body = JSON.stringify(event);
  return api.inject({
    method: "POST",
    url: paymentEventsPath,
    headers: {
      "content-type": "application/json",
      "stripe-signature":
        options.signature ??
        signStripePayload(body, options.with ?? secret, options.signedAt ?? now),
    },
    payload: body,
  });
}

describe("payment events", () => {
  it("grants the catalog's credits for a paid checkout, not the event's", async () => {
    const { app: api, stored, purchasesFor } = await server();

    const response = await send(api, paid());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, outcome: "granted" });
    expect(purchasesFor).toHaveBeenCalledWith("org-north");
    expect(stored).toHaveBeenCalledWith({
      checkoutId: "cs_test_fictional1",
      eventId: "evt_fictional1",
      packId: "pack-5",
      credits: 5,
      validMonths: 12,
      amountTotalCents: 2200,
      currency: "eur",
      now,
    });
  });

  it("grants on a delayed payment's success event too", async () => {
    const { app: api, stored } = await server();

    const response = await send(api, paid({ type: "checkout.session.async_payment_succeeded" }));

    expect(response.json().outcome).toBe("granted");
    expect(stored).toHaveBeenCalledTimes(1);
  });

  it("says when a repeated event changed nothing", async () => {
    const { app: api } = await server(async () => ({ created: false }) as never);

    const response = await send(api, paid());

    expect(response.json()).toEqual({ received: true, outcome: "already_granted" });
  });

  it.each([
    ["no signature", { signature: "" }],
    ["a signature by another secret", { with: "whsec_someoneelse" }],
    ["a signature older than five minutes", { signedAt: new Date(now.getTime() - 301_000) }],
    ["a malformed signature", { signature: "t=abc,v1=zz" }],
  ])("refuses %s and stores nothing", async (_, options) => {
    const { app: api, stored } = await server();

    const response = await send(api, paid(), options);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_signature");
    expect(stored).not.toHaveBeenCalled();
  });

  it("refuses a body changed after it was signed", async () => {
    const { app: api, stored } = await server();
    const signature = signStripePayload(JSON.stringify(paid()), secret, now);

    const response = await send(
      api,
      paid({}, { metadata: { organisation_id: "org-south", pack_id: "pack-5" } }),
      { signature },
    );

    expect(response.statusCode).toBe(400);
    expect(stored).not.toHaveBeenCalled();
  });

  it.each([
    ["a live event", paid({ livemode: true })],
    ["another event type", paid({ type: "customer.created" })],
    ["a checkout that is not paid yet", paid({}, { payment_status: "unpaid" })],
    ["a checkout without an organisation", paid({}, { metadata: { pack_id: "pack-5" } })],
    [
      "an organisation id that is not an identifier",
      paid({}, { metadata: { organisation_id: "../org", pack_id: "pack-5" } }),
    ],
    [
      "a pack the catalog does not sell",
      paid({}, { metadata: { organisation_id: "org-north", pack_id: "pack-100" } }),
    ],
  ])("acknowledges %s without granting", async (_, event) => {
    const { app: api, stored } = await server();

    const response = await send(api, event);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, outcome: "ignored" });
    expect(stored).not.toHaveBeenCalled();
  });

  it("acknowledges a paid checkout for an organisation that is gone", async () => {
    const { app: api } = await server(async () => {
      throw new CreditPurchaseError("organisation_not_found", "No such organisation.");
    });

    const response = await send(api, paid());

    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("ignored");
  });

  it("takes a fully refunded purchase's unspent credits back", async () => {
    const { app: api, refunded, stripe, purchasesFor, stored } = await server();

    const response = await send(api, refundEvent());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, outcome: "refunded" });
    const [url, init] = stripe.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_fictional1&limit=1",
    );
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk_test_fictional");
    expect(purchasesFor).toHaveBeenCalledWith("org-north");
    expect(refunded).toHaveBeenCalledWith({
      checkoutId: "cs_test_fictional1",
      eventId: "evt_refund1",
      now,
    });
    expect(stored).not.toHaveBeenCalled();
  });

  it("says when a repeated refund changed nothing", async () => {
    const { app: api } = await server(
      undefined,
      async () => ({ outcome: "already_refunded", purchase: { creditsTakenBack: 3 } }) as never,
    );

    const response = await send(api, refundEvent());

    expect(response.json()).toEqual({ received: true, outcome: "already_refunded" });
  });

  it.each([
    ["a partial refund", refundEvent({ refunded: false, amount_refunded: 500 }), 0],
    ["a live refund", refundEvent({}, { livemode: true }), 0],
    ["a refund without a payment", refundEvent({ payment_intent: null }), 0],
    ["a refund of a payment that is no checkout of ours", refundEvent(), 1],
  ])("acknowledges %s without taking credits back", async (_, event, lookups) => {
    const {
      app: api,
      refunded,
      stripe,
    } = await server(undefined, undefined, async () => Response.json({ data: [] }));

    const response = await send(api, event);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, outcome: "ignored" });
    expect(stripe).toHaveBeenCalledTimes(lookups);
    expect(refunded).not.toHaveBeenCalled();
  });

  it("acknowledges a refund of a purchase the organisation does not hold", async () => {
    const { app: api } = await server(undefined, async () => ({ outcome: "not_found" }));

    const response = await send(api, refundEvent());

    expect(response.json()).toEqual({ received: true, outcome: "ignored" });
  });

  it.each([
    [
      "the provider cannot say which checkout was refunded",
      async () => new Response("", { status: 503 }),
    ],
    [
      "the provider cannot be reached",
      async () => {
        throw new Error("network down");
      },
    ],
  ])("answers 500 when %s, so that the provider retries", async (_, lookup) => {
    const { app: api, refunded } = await server(undefined, undefined, lookup as never);

    const response = await send(api, refundEvent());

    expect(response.statusCode).toBe(500);
    expect(refunded).not.toHaveBeenCalled();
  });

  it("answers 500 on a storage failure so that the provider retries", async () => {
    const { app: api } = await server(async () => {
      throw new Error("connection lost");
    });

    const response = await send(api, paid());

    expect(response.statusCode).toBe(500);
  });
});
