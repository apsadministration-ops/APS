import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { stripeWebhookHandler } from "./routes/stripeWebhook";
import { logger } from "./lib/logger";
import { initStripeWebhook } from "./lib/stripeInit";

const app: Express = express();

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

export default app;
