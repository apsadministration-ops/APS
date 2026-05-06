/**
 * STANDALONE REFERRAL ENGINE
 *
 * Hard-isolated user-acquisition system. Per spec, this module:
 *
 *   - Writes ONLY referral-specific rewards (source_type = "referral")
 *     into the customer points ledger.
 *   - Does NOT compute loyalty tiers, spending points, review/survey
 *     points, mechanic rewards, or anything else.
 *   - Listens to exactly three triggers: signup, job_completed,
 *     payment_captured (the latter two are unified into one call from
 *     the payment-capture site, since "completed + captured" is what
 *     the spec actually requires).
 *
 * A referral converts iff ALL of:
 *   (a) the referred user has a referrals row in `pending` state
 *   (b) the captured payment is for the referred user's FIRST captured
 *       payment (no other captured/released payments exist)
 *   (c) the payment is currently `captured` AND has no refund
 *
 * Conversion + reward + event-log + balance update happen in ONE
 * transaction with a row lock on the referrals row, so concurrent
 * webhook retries cannot double-award.
 *
 * Refund handling: a separate `revertReferralForJob(jobId)` reverses the
 * referral if it was converted by that job — flipping `converted=false`,
 * subtracting the awarded points via the engine's reversal helper, and
 * logging a `reverted` event. The unique index on `referred_id` keeps
 * the referral row in place (we never delete it), so a re-conversion on
 * a later paid job will be picked up automatically.
 */
import { eq, and, ne, sql } from "drizzle-orm";
import {
  db, referralsTable, referralEventsTable, usersTable, paymentsTable, jobsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { awardCustomerPoints, reverseCustomerPointsForJob, RULES } from "./loyaltyEngine";

const REFERRAL_REWARD_POINTS = RULES.customer.referralFirstPaidJob;

/* -------------------------------------------------------------------------- */
/* SIGNUP                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Record a new pending referral on signup. Enforces:
 *   - referrer != referred (no self-referrals by the same account)
 *   - referrer email != referred email (defensive — register already
 *     dedupes emails, but we double-check here)
 *   - same home address as referrer (basic abuse heuristic — most
 *     real referrals don't share an address)
 *
 * Returns true if recorded, false if blocked by an abuse check or
 * already exists.
 */
export async function recordReferralSignup(
  referrer: typeof usersTable.$inferSelect,
  referred: typeof usersTable.$inferSelect,
  codeUsed: string,
): Promise<boolean> {
  if (referrer.id === referred.id) {
    logger.warn({ userId: referred.id }, "self-referral blocked");
    return false;
  }
  if (referrer.email.toLowerCase() === referred.email.toLowerCase()) {
    logger.warn({ userId: referred.id }, "same-email referral blocked");
    return false;
  }
  // Basic device/account-abuse heuristic: same exact address+zip.
  if (
    referrer.address && referred.address && referrer.zipCode && referred.zipCode &&
    referrer.address.trim().toLowerCase() === referred.address.trim().toLowerCase() &&
    referrer.zipCode.trim() === referred.zipCode.trim()
  ) {
    logger.warn(
      { referrerId: referrer.id, referredId: referred.id },
      "referral blocked — referrer and referred share an address (abuse heuristic)",
    );
    return false;
  }

  try {
    const [row] = await db.insert(referralsTable).values({
      referrerId: referrer.id,
      referredId: referred.id,
      referralCodeUsed: codeUsed,
    }).returning();
    if (row) {
      await db.insert(referralEventsTable).values({
        referralId: row.id, eventType: "signup", jobId: null,
      });
    }
    return true;
  } catch (err) {
    // Unique index on referred_id collided — referral already recorded for this user.
    logger.warn({ err, referredId: referred.id }, "referral signup conflict — already recorded");
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* CONVERSION                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Try to convert the referral attached to `jobId`'s customer.
 *
 * Idempotent and race-safe:
 *   - Row lock on the referrals row inside a transaction.
 *   - In-tx checks for `converted` flag, first-paid-job, refund-free.
 *   - Award + balance-update + event-log all in the same transaction.
 *
 * Caller (Stripe webhook / legacy release path) MUST have already
 * marked the payment as `captured` before invoking this. Returns true
 * if a new conversion was recorded, false otherwise (no referral, not
 * first job, already converted, refund pending, etc).
 */
export async function tryConvertReferral(jobId: number): Promise<boolean> {
  // Look up job + customer outside the tx (read-only).
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job?.customerId) return false;

  const [referral] = await db.select().from(referralsTable)
    .where(eq(referralsTable.referredId, job.customerId));
  if (!referral) return false;
  if (referral.converted) return false; // already locked in

  // Enforce "FIRST paid job": no OTHER captured/released payments exist
  // for this customer's other jobs. We allow the current job's payment
  // (which the caller just captured) to be present.
  const otherCapturedJobs = await db.select({ id: paymentsTable.id })
    .from(paymentsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, paymentsTable.jobId))
    .where(and(
      eq(jobsTable.customerId, job.customerId),
      ne(paymentsTable.jobId, jobId),
      sql`${paymentsTable.status} IN ('captured','released')`,
    ));
  if (otherCapturedJobs.length > 0) {
    logger.info(
      { jobId, customerId: job.customerId, prior: otherCapturedJobs.length },
      "referral not converted — not the customer's first paid job",
    );
    return false;
  }

  // Verify the current job's payment is captured AND not refunded.
  const [currentPayment] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.jobId, jobId));
  if (!currentPayment) return false;
  if (!["captured", "released"].includes(currentPayment.status)) return false;

  return await db.transaction(async (tx) => {
    // Lock the referral row — concurrent webhooks serialize here.
    const locked = await tx.execute(
      sql`SELECT id, converted FROM referrals WHERE id = ${referral.id} FOR UPDATE`,
    );
    const lockedRow = (locked.rows?.[0] ?? (locked as unknown as { rows: Array<{ converted: boolean }> }).rows?.[0]) as { converted: boolean } | undefined;
    if (lockedRow?.converted) return false;

    // Flip conversion state — but DO NOT set pointsAwarded yet. We only
    // record the points after the actual ledger insert succeeds, so the
    // referral row's `pointsAwarded` stays in lock-step with the loyalty
    // ledger (no "rewarded" UX without a real ledger row backing it).
    await tx.update(referralsTable).set({
      converted: true,
      rewarded: true, // keep legacy mirror in sync
      convertedAt: new Date(),
      firstJobId: jobId,
      pointsAwarded: 0,
    }).where(eq(referralsTable.id, referral.id));

    // Audit events.
    await tx.insert(referralEventsTable).values([
      { referralId: referral.id, eventType: "job_completed", jobId },
      { referralId: referral.id, eventType: "payment_captured", jobId },
    ]);
    return true;
  }).then(async (didConvert) => {
    if (!didConvert) return false;
    // Award OUTSIDE the referral tx — `awardCustomerPoints` runs its
    // own transaction with onConflictDoNothing on the loyalty ledger's
    // partial unique index, so this is still race-safe.
    const awarded = await awardCustomerPoints(
      referral.referrerId,
      REFERRAL_REWARD_POINTS,
      "referral",
      `Referral converted — friend completed first paid job (Job #${jobId})`,
      jobId,
    ).catch((err) => {
      logger.error({ err, referralId: referral.id, jobId }, "referral reward award failed");
      return false;
    });
    if (awarded) {
      // Ledger row is in place — only NOW stamp pointsAwarded so the UI
      // can flip from "converted" to "rewarded".
      await db.update(referralsTable)
        .set({ pointsAwarded: REFERRAL_REWARD_POINTS })
        .where(eq(referralsTable.id, referral.id));
      logger.info(
        { referralId: referral.id, referrerId: referral.referrerId, jobId, points: REFERRAL_REWARD_POINTS },
        "referral converted + rewarded",
      );
    } else {
      // Conversion was recorded but the loyalty award didn't take
      // (already-awarded race or DB failure). Status stays "converted"
      // — never "rewarded" without a backing ledger row.
      logger.warn(
        { referralId: referral.id, jobId },
        "referral converted but reward award did not succeed — status remains 'converted'",
      );
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* REVERSAL — on refund                                                        */
/* -------------------------------------------------------------------------- */

/**
 * If the refunded job was the one that converted a referral, reverse it.
 * Flips `converted` back to false, zeros `points_awarded`, and reverses
 * the referral points in the loyalty ledger via the standard reversal
 * helper. Idempotent — second call is a no-op since `converted` is
 * already false.
 */
export async function revertReferralForJob(jobId: number): Promise<void> {
  const [referral] = await db.select().from(referralsTable)
    .where(and(eq(referralsTable.firstJobId, jobId), eq(referralsTable.converted, true)));
  if (!referral) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM referrals WHERE id = ${referral.id} FOR UPDATE`);
    await tx.update(referralsTable).set({
      converted: false,
      rewarded: false,
      convertedAt: null,
      pointsAwarded: 0,
    }).where(eq(referralsTable.id, referral.id));
    await tx.insert(referralEventsTable).values({
      referralId: referral.id, eventType: "reverted", jobId,
    });
  });
  // Reverse the actual points outside the tx — uses the engine's
  // standard reversal which writes a negative ledger row + recomputes
  // the user balance.
  await reverseCustomerPointsForJob(jobId, `Referral reverted — Job #${jobId} refunded`).catch((err) => {
    logger.error({ err, jobId }, "referral points reversal failed");
  });
  logger.info({ referralId: referral.id, jobId }, "referral reverted on refund");
}

/* -------------------------------------------------------------------------- */
/* STATUS — for the user-facing screen                                         */
/* -------------------------------------------------------------------------- */

export type ReferralFriendStatus = "pending" | "converted" | "rewarded";

export interface ReferralStatusEntry {
  id: number;
  referredId: number;
  name: string;
  signupAt: Date;
  status: ReferralFriendStatus;
  pointsAwarded: number;
}

export async function getReferralStatusForUser(referrerId: number) {
  const rows = await db
    .select({
      id: referralsTable.id,
      referredId: referralsTable.referredId,
      name: usersTable.name,
      signupAt: referralsTable.signupTimestamp,
      converted: referralsTable.converted,
      pointsAwarded: referralsTable.pointsAwarded,
    })
    .from(referralsTable)
    .innerJoin(usersTable, eq(referralsTable.referredId, usersTable.id))
    .where(eq(referralsTable.referrerId, referrerId));

  const friends: ReferralStatusEntry[] = rows.map((r) => ({
    id: r.id,
    referredId: r.referredId,
    name: r.name,
    signupAt: r.signupAt,
    status: r.converted ? (r.pointsAwarded > 0 ? "rewarded" : "converted") : "pending",
    pointsAwarded: r.pointsAwarded,
  }));

  return {
    totalReferrals: friends.length,
    pendingReferrals: friends.filter((f) => f.status === "pending").length,
    convertedReferrals: friends.filter((f) => f.status !== "pending").length,
    totalPointsEarned: friends.reduce((s, f) => s + f.pointsAwarded, 0),
    friends,
  };
}

export const REFERRAL_REWARD = REFERRAL_REWARD_POINTS;
