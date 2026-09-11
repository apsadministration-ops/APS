// Startup is read-only against Stripe: endpoint provisioning is explicit.
import { setWebhookSecret, getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";
import { configureStripeWebhook } from "./stripeWebhookSetup";

export async function initStripeWebhook(): Promise<void> {
  try {
    const result = await configureStripeWebhook({
      signingSecret: process.env["STRIPE_WEBHOOK_SECRET"],
      domain: (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0],
      setSecret: setWebhookSecret,
      listEndpoints: async () => {
        const stripe = await getUncachableStripeClient();
        return (await stripe.webhookEndpoints.list({ limit: 100 })).data;
      },
    });
    if (result.status === "configured") {
      logger.info("Stripe webhook signature verification initialized from configured secret");
    } else {
      logger.error(
        result,
        "Stripe webhook NOT ready: configure STRIPE_WEBHOOK_SECRET for the intended existing endpoint. No endpoints were created, modified, or deleted. See docs/phase2-stabilization.md.",
      );
    }
  } catch {
    // Do not log provider error objects: they can contain request details.
    logger.error("Stripe webhook configuration inspection failed. Check the Stripe connection and STRIPE_WEBHOOK_SECRET. No endpoints were changed.");
  }
}