// Stripe webhook initialization — runs once on server startup.
import { setWebhookSecret } from "./stripeClient";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";

/**
 * Idempotently register a webhook endpoint with Stripe and cache its signing secret.
 * Falls back to the STRIPE_WEBHOOK_SECRET env var if direct creation fails.
 */
export async function initStripeWebhook(): Promise<void> {
  // Allow opt-out / explicit override via env.
  const envSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (envSecret) {
    setWebhookSecret(envSecret);
    logger.info("Stripe webhook secret loaded from env");
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const domains = (process.env["REPLIT_DOMAINS"] ?? "").split(",").map((d) => d.trim()).filter(Boolean);
    if (domains.length === 0) {
      logger.warn("Stripe: REPLIT_DOMAINS not set — skipping webhook registration");
      return;
    }
    const webhookUrl = `https://${domains[0]}/api/stripe/webhook`;

    // Find existing endpoint with this URL.
    const existing = await stripe.webhookEndpoints.list({ limit: 100 });
    const found = existing.data.find((e) => e.url === webhookUrl);
    if (found?.secret) {
      setWebhookSecret(found.secret);
      logger.info({ webhookUrl }, "Stripe webhook endpoint reused");
      return;
    }

    // Create a fresh endpoint. The `secret` is only returned on creation.
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        "checkout.session.completed",
        "payment_intent.amount_capturable_updated",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "payment_intent.canceled",
        "account.updated",
        "charge.refunded",
      ],
    });
    if (created.secret) {
      setWebhookSecret(created.secret);
      logger.info({ webhookUrl, id: created.id }, "Stripe webhook endpoint created");
    } else {
      logger.warn("Stripe webhook created but no secret returned");
    }
  } catch (err) {
    logger.error({ err }, "Stripe webhook init failed — payments may not work until fixed");
  }
}
