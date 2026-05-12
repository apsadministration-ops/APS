import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, jobsTable, paymentsTable, workLogsTable, partsItemsTable, vehiclesTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { customerView as installedPartsCustomerView } from "../lib/partsOrderEngine";

const router: IRouter = Router();

/**
 * Customer-facing invoice. Returns ONLY:
 *   - labor charge
 *   - parts charges (itemized: name + qty + total — NEVER unit cost from
 *     mechanic's supplier, NEVER any commission/payout breakdown)
 *   - tax
 *   - total
 *
 * NEVER returns: APS commission, mechanic payout, Stripe fees, or any
 * internal financial split. Customers must never see those numbers.
 */
router.get("/jobs/:jobId/invoice", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // IDOR: customer of this job, mechanic on this job, or admin.
  const isOwner = job.customerId === req.userId;
  const isMechanic = job.mechanicId === req.userId;
  if (!(req.userRole === "admin" || isOwner || isMechanic)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  const [wl] = await db.select().from(workLogsTable).where(eq(workLogsTable.jobId, jobId));
  const items = wl
    ? await db.select().from(partsItemsTable).where(eq(partsItemsTable.workLogId, wl.id))
    : [];
  const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
  // VIN-Integrated Parts Matching: pull brand + warranty + msrp for any
  // parts the mechanic actually installed via the new parts_orders flow.
  // customerView() is intentionally airgapped — it never returns
  // supplier_key, supplier sku, internal cost, or margin/payout numbers.
  const installedParts = await installedPartsCustomerView(jobId);

  // Source-of-truth amounts: prefer the captured payment row, fall back to
  // worklog (legacy) and finally to job.estimatedPrice (pre-completion).
  const taxCents = pmt?.taxCents ?? job.taxCents ?? 0;
  const totalCents = pmt?.amountCents ?? Math.round((wl?.totalCost ?? job.finalPrice ?? job.estimatedPrice ?? 0) * 100) + taxCents;
  const partsCents = items.length > 0
    ? items.reduce((s, p) => s + p.totalCents, 0)
    : Math.round((wl?.partsCost ?? 0) * 100);
  const laborCents = Math.max(0, totalCents - taxCents - partsCents);

  res.json({
    jobId,
    invoiceNumber: `APS-${String(jobId).padStart(6, "0")}`,
    issuedAt: job.completedAt ?? job.createdAt,
    status: pmt?.status ?? "pending",
    customer: customer ? { name: customer.name, email: customer.email } : null,
    vehicle: veh ? { vin: veh.vin, year: veh.year, make: veh.make, model: veh.model } : null,
    serviceDescription: job.description,
    lineItems: {
      labor: {
        description: wl?.serviceDescription ?? job.description,
        amountCents: laborCents,
      },
      parts: items.map((p) => ({
        name: p.name,
        // Brand may be useful for warranty lookup — safe to surface.
        brand: p.brand,
        quantity: p.quantity,
        // We deliberately surface ONLY the line total, not the unit cost
        // and not the supplier — that's mechanic/admin-only data.
        amountCents: p.totalCents,
      })),
      // Curated parts the mechanic installed via Source Parts. Brand +
      // warranty are intentionally surfaced (helps the customer file
      // warranty claims later); supplier/cost/margin are NOT.
      installedParts: installedParts.map((p) => ({
        brand: p.brand,
        name: p.name,
        quantity: p.qty,
        warrantyMonths: p.warrantyMonths,
        msrpCents: p.msrpCents,
      })),
      tax: { amountCents: taxCents },
    },
    totalCents,
  });
});

export default router;
