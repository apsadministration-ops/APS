import assert from "node:assert/strict";
import { test } from "node:test";
import { configureStripeWebhook, REQUIRED_STRIPE_EVENTS } from "./stripeWebhookSetup";

test("configured signing secret initializes without provisioning or listing", async () => {
  let configured = false;
  const result = await configureStripeWebhook({
    signingSecret: "whsec_test_fixture_not_a_real_credential",
    setSecret: () => { configured = true; },
    listEndpoints: async () => { throw new Error("must not call Stripe"); },
  });
  assert.equal(configured, true);
  assert.equal(result.status, "configured");
  assert.equal(JSON.stringify(result).includes("whsec_"), false);
});

test("16 matching endpoints without a signing secret stay blocked without creation", async () => {
  const result = await configureStripeWebhook({
    domain: "aps.example.test",
    setSecret: () => assert.fail("must not configure an unknown signing secret"),
    listEndpoints: async () => Array.from({ length: 16 }, (_, i) => ({
      id: `we_fixture_${i}`,
      url: "https://aps.example.test/api/stripe/webhook",
      status: "enabled",
      enabled_events: ["checkout.session.completed"],
    })),
  });
  assert.equal(result.status, "missing_signing_secret");
  assert.equal("matchingEndpoints" in result && result.matchingEndpoints, 16);
  assert.ok("endpoints" in result && result.endpoints?.[0]?.missingEvents.includes("payout.failed"));
});

test("missing or invalid domain never becomes an undefined URL", async () => {
  for (const domain of [undefined, "", "https://wrong.example/path"]) {
    const result = await configureStripeWebhook({
      domain,
      setSecret: () => assert.fail(),
      listEndpoints: async () => { throw new Error("must not list"); },
    });
    assert.equal(result.status, "missing_configuration");
    assert.equal(JSON.stringify(result).includes("https://undefined"), false);
  }
});

test("invalid secret fails closed and wildcard events are recognized", async () => {
  const invalid = await configureStripeWebhook({
    signingSecret: "invalid",
    setSecret: () => assert.fail(),
    listEndpoints: async () => [],
  });
  assert.equal(invalid.status, "invalid_signing_secret");
  const wildcard = await configureStripeWebhook({
    domain: "aps.example.test",
    setSecret: () => assert.fail(),
    listEndpoints: async () => [{
      id: "we_fixture", url: "https://aps.example.test/api/stripe/webhook",
      status: "enabled", enabled_events: ["*"],
    }],
  });
  assert.deepEqual("endpoints" in wildcard && wildcard.endpoints?.[0]?.missingEvents, []);
  assert.ok(REQUIRED_STRIPE_EVENTS.includes("charge.dispute.created"));
});