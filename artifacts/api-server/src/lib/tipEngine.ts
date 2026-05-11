/**
 * Tip engine. Tips are 100%-to-mechanic by default (platform fee = 0). Admin
 * can later configure a small platform fee via adminGrowthSettings; the
 * `getTipPlatformFeePct()` helper is the single source of truth.
 *
 * A tip is a SEPARATE Stripe Checkout Session + PaymentIntent so it never
 * blocks or collides with the underlying job payment. Tips can be added at
 * any point AFTER the job is in PAID status (or after successful capture).
 */

import { eq } from "drizzle-orm";
import { db, tipsTable, jobsTable, usersTable } from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient";

const DEFAULT_TIP_PLATFORM_FEE_PCT = 0;

export function getTipPlatformFeePct(): number {
  // Reserved for adminGrowthSettings lookup. Always 0 today.
  return DEFAULT_TIP_PLATFORM_FEE_PCT;
}

export function splitTip(amountCents: number): { platformFeeCents: number; mechanicAmountCents: number } {
  const feePct = getTipPlatformFeePct();
  const platformFeeCents = Math.round(amountCents * feePct);
  const mechanicAmountCents = amountCents - platformFeeCents;
  return { platformFeeCents, mechanicAmountCents };
}

export interface CreateTipInput {
  jobId: number;
  customerId: number;
  amountCents: number;
}

export async function createTipCheckout(input: CreateTipInput): Promise<{ url: string; tipId: number; sessionId: string }> {
  const { jobId, customerId, amountCents } = input;
  if (amountCents < 100) throw new Error("Tip must be at least $1.00");
  if (amountCents > 50000) throw new Error("Tip cannot exceed $500.00");
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) throw new Error("Job not found");
  if (job.customerId !== customerId) throw new Error("Not your job");
  if (!job.mechanicId) throw new Error("No mechanic on this job");
  if (!["COMPLETED", "PAID"].includes(job.status)) {
    throw new Error("Tips can only be added once the job is completed.");
  }

  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, customerId));
  if (!mechanic?.stripeAccountId || !mechanic.stripeAccountReady) {
    throw new Error("Mechanic has not finished payout setup yet.");
  }
  if (!customer) throw new Error("Customer not found");

  const stripe = await getUncachableStripeClient();
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await stripe.customers.create({
      email: customer.email, name: customer.name,
      metadata: { userId: String(customer.id) },
    });
    stripeCustomerId = created.id;
    await db.update(usersTable).set({ stripeCustomerId }).where(eq(usersTable.id, customer.id));
  }

  const { platformFeeCents, mechanicAmountCents } = splitTip(amountCents);

  // Pre-insert the tip row so we have an id to embed in Stripe metadata.
  // This lets the webhook fall back to metadata.tipId if
  // payment_intent.succeeded arrives before checkout.session.completed.
  const [tip] = await db.insert(tipsTable).values({
    jobId, customerId, mechanicId: job.mechanicId,
    amountCents, platformFeeCents, mechanicAmountCents,
    status: "pending",
  }).returning();
  const tipId = tip!.id;

  const baseUrl = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0] ?? ""}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `Tip for ${mechanic.name} — Job #${jobId}`,
          description: "Goes 100% to your mechanic.",
        },
      },
    }],
    payment_intent_data: {
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: mechanic.stripeAccountId },
      metadata: { tipId: String(tipId), tipJobId: String(jobId), customerId: String(customerId), mechanicId: String(mechanic.id), kind: "tip" },
    },
    success_url: `${baseUrl}/api/payments/checkout/return?status=success`,
    cancel_url: `${baseUrl}/api/payments/checkout/return?status=cancel`,
    metadata: { tipId: String(tipId), tipJobId: String(jobId), kind: "tip" },
  });

  await db.update(tipsTable).set({ providerSessionId: session.id }).where(eq(tipsTable.id, tipId));

  return { url: session.url ?? "", tipId, sessionId: session.id };
}
