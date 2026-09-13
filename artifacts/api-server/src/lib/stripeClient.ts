// Stripe client — credentials fetched from Replit connection API on every call.
// NEVER cache. NEVER store card data anywhere.
import Stripe from "stripe";
import { isValidProviderHostname } from "./providerConfig";

interface StripeConnection {
  settings: {
    publishable?: string;
    secret?: string;
  };
}

export class StripeNotConfiguredError extends Error {
  readonly code = "stripe_provider_not_configured";
  readonly statusCode = 503;

  constructor() {
    super("Stripe is not configured.");
    this.name = "StripeNotConfiguredError";
  }
}

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!xReplitToken || !isValidProviderHostname(hostname)) {
    throw new StripeNotConfiguredError();
  }

  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
    });
  } catch {
    throw new StripeNotConfiguredError();
  }
  if (!response.ok) throw new StripeNotConfiguredError();
  const data = (await response.json()) as { items?: StripeConnection[] };
  const conn = data.items?.[0];

  if (!conn || !conn.settings.publishable || !conn.settings.secret) {
    throw new StripeNotConfiguredError();
  }
  return { publishableKey: conn.settings.publishable, secretKey: conn.settings.secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  if (TEST_STRIPE_CLIENT) return TEST_STRIPE_CLIENT;
  const { secretKey } = await getCredentials();
  // apiVersion is omitted so the SDK picks its pinned default; Stripe servers
  // accept any recent version. Pin in env STRIPE_API_VERSION if needed.
  return new Stripe(secretKey);
}

export async function getStripePublishableKey(): Promise<string> {
  return (await getCredentials()).publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  return (await getCredentials()).secretKey;
}

// In-memory cache of webhook signing secret (set on startup).
let WEBHOOK_SECRET: string | null = null;
export function setWebhookSecret(secret: string): void { WEBHOOK_SECRET = secret; }
export function getWebhookSecret(): string | null { return WEBHOOK_SECRET; }

// Development-only provider seam for database integration tests. It is never
// accepted in production and does not persist provider state or credentials.
let TEST_STRIPE_CLIENT: Stripe | null = null;
export function setStripeClientForTests(client: Stripe | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Stripe test client cannot be configured in production.");
  }
  TEST_STRIPE_CLIENT = client;
}
