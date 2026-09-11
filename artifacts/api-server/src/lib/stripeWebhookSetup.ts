/**
 * Stripe only returns an endpoint's signing secret on creation, not list/retrieve.
 * Startup must never create another endpoint to try to recover that secret.
 */
export const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "account.updated",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "transfer.created",
  "transfer.reversed",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
] as const;

interface EndpointSummary {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
}

export async function configureStripeWebhook(options: {
  signingSecret?: string;
  domain?: string;
  setSecret: (secret: string) => void;
  listEndpoints: () => Promise<EndpointSummary[]>;
}) {
  const secret = options.signingSecret?.trim();
  if (secret) {
    if (!secret.startsWith("whsec_") || secret.length <= 6) {
      return { status: "invalid_signing_secret" as const };
    }
    options.setSecret(secret);
    return { status: "configured" as const };
  }
  const domain = options.domain?.trim();
  if (
    !domain ||
    domain.toLowerCase().includes("undefined") ||
    domain.toLowerCase() === "null" ||
    !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)
  ) {
    return { status: "missing_configuration" as const, matchingEndpoints: 0 };
  }
  const webhookUrl = `https://${domain}/api/stripe/webhook`;
  const endpoints = await options.listEndpoints();
  const matches = endpoints.filter((endpoint) => endpoint.url === webhookUrl);
  return {
    status: "missing_signing_secret" as const,
    webhookUrl,
    matchingEndpoints: matches.length,
    endpoints: matches.map((endpoint) => ({
      id: endpoint.id,
      status: endpoint.status,
      missingEvents: endpoint.enabled_events.includes("*")
        ? []
        : REQUIRED_STRIPE_EVENTS.filter((event) => !endpoint.enabled_events.includes(event)),
    })),
  };
}