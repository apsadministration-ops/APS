/**
 * Customer approval state machine.
 *
 * Lifecycle:
 *   mechanic accepts job  → startCustomerApproval(jobId, mechanicId)
 *                          → inserts customer_approvals(pending, expires=+60s)
 *                          → flips job.status to PENDING_APPROVAL
 *
 *   customer responds (approve / decline) within 60s
 *     approve   → approval.status='approved',     job.status='ACCEPTED'
 *     decline   → approval.status='declined',     job.status='REQUESTED' (re-dispatched), job.mechanicId=NULL
 *
 *   nobody responds within 60s
 *     sweepExpiredApprovals  → approval.status='auto_approved', job.status='ACCEPTED'
 *
 * `unique(job_id)` on the approvals table prevents double-pending; if a job
 * is re-accepted by a new mechanic after a decline, we INSERT … ON CONFLICT
 * to overwrite the previous row.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { db, customerApprovalsTable, jobsTable, usersTable, vehiclesTable } from "@workspace/db";
import {
  notifyMechanicApprovalAccepted, notifyCustomerJobAccepted,
} from "./notifications";

export const APPROVAL_WINDOW_MS = 60 * 1000;

export async function startCustomerApproval(jobId: number, mechanicId: number, customerId: number): Promise<void> {
  const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MS);
  await db.insert(customerApprovalsTable).values({
    jobId, mechanicId, customerId, status: "pending", expiresAt,
  }).onConflictDoUpdate({
    target: customerApprovalsTable.jobId,
    set: {
      mechanicId, customerId, status: "pending",
      expiresAt, respondedAt: null, declineReason: null,
    },
  });
  await db.update(jobsTable).set({ status: "PENDING_APPROVAL" }).where(eq(jobsTable.id, jobId));
}

interface DecisionInput {
  jobId: number;
  viewerId: number;
  viewerRole: string;
  decision: "approved" | "declined";
  reason?: string;
}
type DecisionResult =
  | { ok: true; approval: typeof customerApprovalsTable.$inferSelect; jobStatus: string }
  | { ok: false; status: number; error: string };

export async function applyApprovalDecision(input: DecisionInput): Promise<DecisionResult> {
  return db.transaction(async (tx) => {
    // Lock the approval row to prevent races between approve/decline/sweep.
    const lockedRows = await tx.execute(sql`
      SELECT * FROM customer_approvals WHERE job_id = ${input.jobId} FOR UPDATE
    `);
    const approval = (lockedRows.rows[0] ?? null) as typeof customerApprovalsTable.$inferSelect | null;
    if (!approval) return { ok: false, status: 404, error: "No approval pending for this job." } as DecisionResult;

    if (input.viewerRole !== "admin" && approval.customerId !== input.viewerId) {
      return { ok: false, status: 403, error: "Only the customer can respond to this approval." } as DecisionResult;
    }
    if (approval.status !== "pending") {
      return { ok: false, status: 409, error: `Already ${approval.status}.` } as DecisionResult;
    }
    if (approval.expiresAt.getTime() <= Date.now()) {
      // Expired the moment they tried — auto-approve as the spec requires.
      const [updated] = await tx.update(customerApprovalsTable)
        .set({ status: "auto_approved", respondedAt: new Date() })
        .where(eq(customerApprovalsTable.id, approval.id))
        .returning();
      await tx.update(jobsTable).set({ status: "ACCEPTED" })
        .where(and(eq(jobsTable.id, input.jobId), eq(jobsTable.status, "PENDING_APPROVAL")));
      return { ok: true, approval: updated, jobStatus: "ACCEPTED" };
    }

    const [updated] = await tx.update(customerApprovalsTable)
      .set({
        status: input.decision,
        respondedAt: new Date(),
        declineReason: input.decision === "declined" ? (input.reason ?? null) : null,
      })
      .where(eq(customerApprovalsTable.id, approval.id))
      .returning();

    if (input.decision === "approved") {
      await tx.update(jobsTable).set({ status: "ACCEPTED" })
        .where(and(eq(jobsTable.id, input.jobId), eq(jobsTable.status, "PENDING_APPROVAL")));
      return { ok: true, approval: updated, jobStatus: "ACCEPTED" };
    } else {
      // Re-dispatch: clear the mechanic and put the job back on the board.
      await tx.update(jobsTable).set({ status: "REQUESTED", mechanicId: null })
        .where(and(eq(jobsTable.id, input.jobId), eq(jobsTable.status, "PENDING_APPROVAL")));
      return { ok: true, approval: updated, jobStatus: "REQUESTED" };
    }
  });
}

/**
 * Single source of truth for "the job just became ACCEPTED" side effects.
 * Used by manual approve, lazy sweep, and bulk sweep so notifications never
 * depend on which entry path triggered the transition. Best-effort — never
 * blocks the caller on push delivery.
 */
export async function fireApprovalAcceptedNotifications(jobId: number): Promise<void> {
  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job || !job.mechanicId) return;
    const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
    const [cust] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
    const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
    if (mech?.pushToken) await notifyMechanicApprovalAccepted(mech.pushToken, jobId);
    if (cust?.pushToken && mech && veh) {
      await notifyCustomerJobAccepted(cust.pushToken, mech.name,
        `${veh.year} ${veh.make} ${veh.model}`, jobId);
    }
  } catch { /* best-effort */ }
}

/**
 * Lazy / cron sweeper. Pass `jobId` to scope to a single row (cheap on read
 * paths); omit to sweep the whole table. Fires accepted-notifications for
 * every auto-approved job so mechanics+customers get the same push regardless
 * of whether the approval was manual or expiry-driven.
 */
export async function sweepExpiredApprovals(jobId?: number): Promise<number> {
  const where = jobId === undefined
    ? and(eq(customerApprovalsTable.status, "pending"), lte(customerApprovalsTable.expiresAt, new Date()))
    : and(
        eq(customerApprovalsTable.status, "pending"),
        eq(customerApprovalsTable.jobId, jobId),
        lte(customerApprovalsTable.expiresAt, new Date()),
      );
  const swept = await db.update(customerApprovalsTable)
    .set({ status: "auto_approved", respondedAt: new Date() })
    .where(where)
    .returning();
  for (const a of swept) {
    await db.update(jobsTable).set({ status: "ACCEPTED" })
      .where(and(eq(jobsTable.id, a.jobId), eq(jobsTable.status, "PENDING_APPROVAL")));
    void fireApprovalAcceptedNotifications(a.jobId);
  }
  return swept.length;
}
