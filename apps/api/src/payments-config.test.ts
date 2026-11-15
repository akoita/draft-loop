import { describe, expect, it, vi } from "vitest";

import { ApiConfigError } from "./config.js";
import { paymentsFrom, readPaymentsConfig } from "./payments-config.js";
import { stripeApiVersion } from "./stripe-checkout.js";

const key = "sk_test_fictional0123456789";
const signingSecret = "whsec_fictional9876543210";
const stripeEnv = {
  DRAFT_LOOP_PAYMENTS: "stripe",
  DRAFT_LOOP_STRIPE_SECRET_KEY: key,
  DRAFT_LOOP_STRIPE_WEBHOOK_SECRET: signingSecret,
  DRAFT_LOOP_STRIPE_PRICE_PACK_1: "price_one",
  DRAFT_LOOP_STRIPE_PRICE_PACK_5: "price_five",
  DRAFT_LOOP_PAYMENTS_RETURN_URL: "https://app.example.test/",
};
const pack = {
  id: "pack-5",
  label: "5 applications",
  credits: 5,
  priceEurCents: 2200,
  validMonths: 12,
} as const;

describe("payments config", () => {
  it("sells nothing unless asked", () => {
    expect(readPaymentsConfig({})).toEqual({ mode: "off" });
    expect(readPaymentsConfig({ DRAFT_LOOP_PAYMENTS: "off" })).toEqual({ mode: "off" });
    expect(paymentsFrom({ mode: "off" })).toBeUndefined();
  });

  it("reads a Stripe test-mode setup", () => {
    expect(readPaymentsConfig(stripeEnv)).toEqual({
      mode: "stripe",
      secretKey: key,
      webhookSecret: signingSecret,
      prices: { "pack-1": "price_one", "pack-5": "price_five" },
      returnUrl: "https://app.example.test/",
    });
  });

  it.each([
    ["an unknown provider", { DRAFT_LOOP_PAYMENTS: "paddle" }],
    ["a missing key", { DRAFT_LOOP_STRIPE_SECRET_KEY: "" }],
    ["a live secret key", { DRAFT_LOOP_STRIPE_SECRET_KEY: "sk_live_fictional0123456789" }],
    ["a live restricted key", { DRAFT_LOOP_STRIPE_SECRET_KEY: "rk_live_fictional0123456789" }],
    ["a missing signing secret", { DRAFT_LOOP_STRIPE_WEBHOOK_SECRET: "" }],
    ["a key as the signing secret", { DRAFT_LOOP_STRIPE_WEBHOOK_SECRET: key }],
    ["a missing price", { DRAFT_LOOP_STRIPE_PRICE_PACK_5: "" }],
    ["a product id as a price", { DRAFT_LOOP_STRIPE_PRICE_PACK_1: "prod_one" }],
    ["a plain HTTP return address", { DRAFT_LOOP_PAYMENTS_RETURN_URL: "http://app.example.test/" }],
    ["a return address with a query", { DRAFT_LOOP_PAYMENTS_RETURN_URL: "https://a.test/?x=1" }],
    ["no return address", { DRAFT_LOOP_PAYMENTS_RETURN_URL: "" }],
  ])("stops the start on %s, without repeating the key", (_, change) => {
    let message = "";
    try {
      readPaymentsConfig({ ...stripeEnv, ...change });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiConfigError);
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("fictional0123456789");
    expect(message).not.toContain("fictional9876543210");
  });

  it("allows a local return address for a self-hosted test", () => {
    const config = readPaymentsConfig({
      ...stripeEnv,
      DRAFT_LOOP_PAYMENTS_RETURN_URL: "http://localhost:8080/",
    });
    expect(config).toMatchObject({ returnUrl: "http://localhost:8080/" });
  });
});

describe("Stripe checkout", () => {
  const ok = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  const start = (fetcher: typeof fetch) => {
    const payments = paymentsFrom(readPaymentsConfig(stripeEnv), fetcher);
    if (payments === undefined) throw new Error("payments are configured");
    return payments.checkout.startCreditPackCheckout({
      organisationId: "org-north",
      memberId: "m-1",
      pack,
    });
  };

  it("opens a Managed Payments session that names the organisation and the pack", async () => {
    const fetcher = ok({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });

    await expect(start(fetcher)).resolves.toEqual({
      checkoutId: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": stripeApiVersion,
    });
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      mode: "payment",
      "line_items[0][price]": "price_five",
      "line_items[0][quantity]": "1",
      "managed_payments[enabled]": "true",
      success_url: "https://app.example.test/?purchase=done",
      cancel_url: "https://app.example.test/?purchase=cancelled",
      client_reference_id: "org-north",
      "metadata[organisation_id]": "org-north",
      "metadata[member_id]": "m-1",
      "metadata[pack_id]": "pack-5",
      "metadata[credits]": "5",
    });
  });

  it("reports a refusal by its status only", async () => {
    const fetcher = ok({ error: { message: `Invalid key ${key}` } }, 401);

    await expect(start(fetcher)).rejects.toMatchObject({
      name: "PaymentProviderError",
      status: 401,
      message: "The payment provider refused the checkout (HTTP 401).",
    });
  });

  it("reports an unreachable provider without the cause", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(`connect failed with ${key}`);
    });

    await expect(start(fetcher)).rejects.toMatchObject({
      name: "PaymentProviderError",
      status: undefined,
      message: "The payment provider could not be reached.",
    });
  });

  it.each([
    ["no page", { id: "cs_test_1" }],
    ["a page elsewhere", { id: "cs_test_1", url: "https://checkout.example.test/pay" }],
    ["a plain HTTP page", { id: "cs_test_1", url: "http://checkout.stripe.com/pay" }],
    ["a look-alike host", { id: "cs_test_1", url: "https://checkout.stripe.com.example.test/" }],
  ])("refuses an answer with %s", async (_, body) => {
    await expect(start(ok(body))).rejects.toMatchObject({ name: "PaymentProviderError" });
  });
});
