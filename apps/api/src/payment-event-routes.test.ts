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

async function server(record: Record_ = async () => ({ created: true }) as never) {
  const stored = vi.fn(record);
  const purchasesFor = vi.fn(() => ({ record: stored }));
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(sendError);
  registerPaymentEventRoutes(app, {
    events: createStripeEvents({ webhookSecret: secret }),
    purchasesFor,
    now: () => now,
  });
  await app.ready();
  return { app, stored, purchasesFor };
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
    ["another event type", paid({ type: "charge.refunded" })],
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

  it("answers 500 on a storage failure so that the provider retries", async () => {
    const { app: api } = await server(async () => {
      throw new Error("connection lost");
    });

    const response = await send(api, paid());

    expect(response.statusCode).toBe(500);
  });
});
