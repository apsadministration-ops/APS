import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { stripeWebhookHandler } from "./routes/stripeWebhook";
import { logger } from "./lib/logger";
import { initStripeWebhook } from "./lib/stripeInit";
import { startPayoutScheduler } from "./lib/payoutSchedulerInit";
import { initSuppliers } from "./lib/suppliers/init";
import { initMediaProviders } from "./lib/mediaProviders";
import { initPostingProviders } from "./lib/publishingProviders";
import { startGrowthScheduler } from "./lib/growthSchedulerInit";
import { loadCredentialCache } from "./lib/credentialStore";

const app: Express = express();

// We sit behind Replit's reverse proxy. Trusting it lets Express resolve
// `req.ip`, `req.protocol`, and `req.hostname` from the X-Forwarded-* headers
// — required for express-rate-limit and for building correct password reset
// links (https://<real-host> instead of http://localhost).
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors());

// Stripe webhook MUST receive a raw Buffer for signature verification — and
// the raw parser MUST be scoped to ONLY the webhook path. If we mounted raw
// on the entire /api prefix we would consume bodies for every /api route and
// break express.json() downstream.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

// JSON body parsing for everything else.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Fire-and-forget: register webhook endpoint with Stripe + cache the signing secret.
void initStripeWebhook();

// In-process cron — sweeps approval expiry (60s) and work-confirmation
// expiry (24h capture release) every minute. See payoutSchedulerInit.ts.
startPayoutScheduler();

// Register the in-house APS-curated supplier + any external supplier
// stubs (PartsTech, Nexpart, ...) so the parts-catalog engine can fan
// offer queries out the moment a request lands.
initSuppliers();

// Register AI media-generation providers (OpenAI gpt-image-1 today; Runway /
// Pika / Kling slot into the same registry as they're wired up).
initMediaProviders();

// Register social-posting providers — all stubs today; real Facebook /
// Instagram / TikTok / X adapters plug into the same registry.
initPostingProviders();

// Hydrate the encrypted credential cache from DB BEFORE the growth
// scheduler can fire publish ticks — otherwise the first sweep would see
// `hasCredentialSync()` return false for legitimately-saved credentials
// and skip the platform with a misleading "not configured" error.
loadCredentialCache().then(() => {
  // Growth scheduler: 1-min publish sweep, 30-min winner-iteration sweep,
  // 60-min reuse sweep. Separate from the payout scheduler so a slow
  // platform API can't block payout ticks.
  startGrowthScheduler();
});

export default app;
