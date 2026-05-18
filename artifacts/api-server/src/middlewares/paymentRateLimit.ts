/**
 * Rate limiters for payment-adjacent routes.
 *
 * Card-testing defense: an attacker who steals a list of stolen cards will
 * try them rapidly against any "create-PaymentIntent / Checkout" endpoint to
 * find which ones still work. We can't (and shouldn't) replace Stripe
 * Radar — Radar still does the heavy lifting — but a coarse rate gate at
 * the edge prevents the attacker from burning through thousands of attempts
 * before Radar's signal accumulates.
 *
 * Keys:
 *  - Authenticated routes key by user id (req.user.id) — a legit user has a
 *    single account; a bot that creates many users still gets caught by IP.
 *  - Both limiters key by IP as a fallback so a brute-force pre-auth burst
 *    on `/payments/config` doesn't slip through.
 *
 * Limits are deliberately generous (a real customer never hits them) but
 * tight enough that an automated card-tester is shut out within seconds.
 */
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import type { AuthRequest } from "./authenticate";

function userOrIpKey(req: Request): string {
  const uid = (req as AuthRequest).user?.id;
  return uid ? `u:${uid}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/**
 * Checkout-creation gate. Each call mints a Stripe Checkout Session +
 * PaymentIntent (real $ side-effects), so the limit is the tightest.
 * 10 attempts / minute / user|ip is well above any legitimate UX (the
 * customer would have to tap "Pay" once every 6 seconds for a minute
 * straight to hit it) but cuts a card-tester off fast.
 */
export const checkoutCreationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many checkout attempts. Please wait a minute and try again." },
});

/**
 * Connect / config / status reads. These don't mint charges but they DO
 * touch Stripe's API on every call and a tight loop can rack up costs.
 * 60/min/user is generous for any UI polling pattern.
 */
export const paymentReadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many requests. Please slow down." },
});

/**
 * Tip-creation gate. Same reasoning as checkout but lower volume — a
 * customer is realistically tipping once per job, not ten times.
 */
export const tipCreationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many tip attempts. Please wait a minute." },
});
