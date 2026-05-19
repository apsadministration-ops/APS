/**
 * Fleet & Commercial Job Injection Layer.
 *
 * This is a PURE additive layer on top of the existing job system.
 *
 * Rules of engagement (per product brief):
 *  - Fleet/commercial requests are converted into NORMAL `jobs` rows.
 *  - Once inserted, the existing dispatch + accept + complete flow takes over.
 *  - No special treatment downstream — only metadata tagging
 *    (sourceType, fleetAccountId, fleetContractId, fleetPriority).
 *  - Customer experience is untouched. Mechanic workflow is untouched
 *    (the mechanic gets a small badge + priority pill, nothing more).
 *
 * All endpoints are gated to shop_owner + admin only. shop_owner sees their
 * own fleet accounts; admin sees everything.
 */
import { Router, type IRouter } from "express";
import { eq, inArray, and, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  fleetAccountsTable,
  fleetContractsTable,
  fleetVehiclesTable,
  jobsTable,
  vehiclesTable,
  usersTable,
} from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { findServiceBySlug, type ServiceCategory, type TierKey } from "@workspace/tier-catalog";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function gate(req: AuthRequest): { ok: true } | { ok: false; status: number; msg: string } {
  if (!req.userId) return { ok: false, status: 401, msg: "Unauthorized" };
  if (req.userRole !== "admin" && req.userRole !== "shop_owner") {
    return { ok: false, status: 403, msg: "Fleet management is restricted to shop owners and admins" };
  }
  return { ok: true };
}

async function assertAccountAccess(req: AuthRequest, accountId: number) {
  const [acc] = await db.select().from(fleetAccountsTable).where(eq(fleetAccountsTable.id, accountId));
  if (!acc) return { acc: null as null, error: { status: 404, msg: "Fleet account not found" } };
  if (req.userRole !== "admin" && acc.ownerId !== req.userId) {
    return { acc: null as null, error: { status: 403, msg: "Not your fleet account" } };
  }
  return { acc, error: null as null };
}

/* -------------------------------------------------------------------------- */
/* Fleet accounts                                                             */
/* -------------------------------------------------------------------------- */

const accountSchema = z.object({
  companyName: z.string().min(2).max(120),
  accountKind: z.enum(["fleet", "commercial"]).optional(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  serviceTier: z.enum(["basic", "premium", "enterprise"]).optional(),
  defaultPriority: z.enum(["standard", "priority", "urgent"]).optional(),
  responseTimeMinutes: z.number().int().min(15).max(10080).optional(),
});

router.get("/fleet/accounts", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const rows = req.userRole === "admin"
    ? await db.select().from(fleetAccountsTable).orderBy(desc(fleetAccountsTable.createdAt))
    : await db.select().from(fleetAccountsTable).where(eq(fleetAccountsTable.ownerId, req.userId!)).orderBy(desc(fleetAccountsTable.createdAt));
  res.json(rows);
});

router.post("/fleet/accounts", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [acc] = await db.insert(fleetAccountsTable).values({
    ownerId: req.userId!,
    companyName: parsed.data.companyName,
    accountKind: parsed.data.accountKind ?? "fleet",
    contactEmail: parsed.data.contactEmail ?? null,
    contactPhone: parsed.data.contactPhone ?? null,
    serviceTier: parsed.data.serviceTier ?? "basic",
    defaultPriority: parsed.data.defaultPriority ?? "standard",
    responseTimeMinutes: parsed.data.responseTimeMinutes ?? 240,
  }).returning();
  res.status(201).json(acc);
});

router.get("/fleet/accounts/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const a = await assertAccountAccess(req, id);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const [contracts, vehicles] = await Promise.all([
    db.select().from(fleetContractsTable).where(eq(fleetContractsTable.accountId, id)).orderBy(desc(fleetContractsTable.createdAt)),
    db.select().from(fleetVehiclesTable).where(eq(fleetVehiclesTable.accountId, id)).orderBy(desc(fleetVehiclesTable.createdAt)),
  ]);
  res.json({ account: a.acc, contracts, vehicles });
});

router.patch("/fleet/accounts/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const a = await assertAccountAccess(req, id);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const parsed = accountSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [upd] = await db.update(fleetAccountsTable).set({
    ...(parsed.data.companyName !== undefined ? { companyName: parsed.data.companyName } : {}),
    ...(parsed.data.accountKind !== undefined ? { accountKind: parsed.data.accountKind } : {}),
    ...(parsed.data.contactEmail !== undefined ? { contactEmail: parsed.data.contactEmail } : {}),
    ...(parsed.data.contactPhone !== undefined ? { contactPhone: parsed.data.contactPhone } : {}),
    ...(parsed.data.serviceTier !== undefined ? { serviceTier: parsed.data.serviceTier } : {}),
    ...(parsed.data.defaultPriority !== undefined ? { defaultPriority: parsed.data.defaultPriority } : {}),
    ...(parsed.data.responseTimeMinutes !== undefined ? { responseTimeMinutes: parsed.data.responseTimeMinutes } : {}),
  }).where(eq(fleetAccountsTable.id, id)).returning();
  res.json(upd);
});

/* -------------------------------------------------------------------------- */
/* Contracts                                                                  */
/* -------------------------------------------------------------------------- */

const contractSchema = z.object({
  contractNumber: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  priorityOverride: z.enum(["standard", "priority", "urgent"]).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.post("/fleet/accounts/:id/contracts", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId)) { res.status(400).json({ error: "Bad id" }); return; }
  const a = await assertAccountAccess(req, accountId);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const parsed = contractSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [row] = await db.insert(fleetContractsTable).values({
    accountId,
    contractNumber: parsed.data.contractNumber,
    name: parsed.data.name,
    priorityOverride: parsed.data.priorityOverride ?? null,
    startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
    endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json(row);
});

/* -------------------------------------------------------------------------- */
/* Vehicles                                                                   */
/* -------------------------------------------------------------------------- */

const vehicleSchema = z.object({
  vin: z.string().min(11).max(17),
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1900).max(2100),
  mileage: z.number().int().min(0).default(0),
  label: z.string().max(80).optional().nullable(),
});

router.post("/fleet/accounts/:id/vehicles", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId)) { res.status(400).json({ error: "Bad id" }); return; }
  const a = await assertAccountAccess(req, accountId);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  // Find-or-create the underlying vehicle row (unique by VIN).
  let [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vin, parsed.data.vin));
  if (!vehicle) {
    [vehicle] = await db.insert(vehiclesTable).values({
      vin: parsed.data.vin,
      make: parsed.data.make,
      model: parsed.data.model,
      year: parsed.data.year,
      mileage: parsed.data.mileage,
    }).returning();
  }

  const [fv] = await db.insert(fleetVehiclesTable).values({
    accountId, vehicleId: vehicle.id, vin: vehicle.vin, label: parsed.data.label ?? null,
  }).returning();

  res.status(201).json({ ...fv, vehicle });
});

/* -------------------------------------------------------------------------- */
/* Job intake — converts fleet requests into NORMAL jobs                      */
/* -------------------------------------------------------------------------- */

const intakeRequestSchema = z.object({
  fleetVehicleId: z.number().int().optional(),
  vehicleId: z.number().int().optional(),
  description: z.string().min(5).max(2000),
  serviceSlug: z.string().optional(),
  jobType: z.enum(["repair", "diagnostic", "maintenance", "detailing"]).optional(),
  priority: z.enum(["standard", "priority", "urgent"]).optional(),
  locationAddress: z.string().max(500).optional().nullable(),
  locationLat: z.number().optional().nullable(),
  locationLng: z.number().optional().nullable(),
});
const intakeSchema = z.object({
  accountId: z.number().int(),
  contractId: z.number().int().optional().nullable(),
  requests: z.array(intakeRequestSchema).min(1).max(100),
});

router.post("/fleet/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const a = await assertAccountAccess(req, parsed.data.accountId);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const account = a.acc!;

  // Validate optional contract belongs to this account.
  let contract = null as null | { id: number; priorityOverride: string | null };
  if (parsed.data.contractId != null) {
    const [c] = await db.select().from(fleetContractsTable).where(eq(fleetContractsTable.id, parsed.data.contractId));
    if (!c || c.accountId !== account.id) {
      res.status(400).json({ error: "Contract does not belong to this account" }); return;
    }
    contract = c;
  }

  // Pre-resolve all referenced vehicles (fleet_vehicles row OR plain vehicles row).
  const fvIds = parsed.data.requests.map((r) => r.fleetVehicleId).filter((x): x is number => !!x);
  const vIds = parsed.data.requests.map((r) => r.vehicleId).filter((x): x is number => !!x);
  const fvRows = fvIds.length ? await db.select().from(fleetVehiclesTable).where(inArray(fleetVehiclesTable.id, fvIds)) : [];
  const vRows = vIds.length ? await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vIds)) : [];
  const fvById = new Map(fvRows.map((r) => [r.id, r] as const));
  const vById = new Map(vRows.map((r) => [r.id, r] as const));

  const sourceType: "fleet" | "commercial" = account.accountKind === "commercial" ? "commercial" : "fleet";
  const accountKey = sourceType; // also stamped as sourceType on each job

  const created: Array<{ jobId: number; vin: string }> = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < parsed.data.requests.length; i++) {
    const r = parsed.data.requests[i];
    // Resolve vehicle id (jobs.vehicleId is NOT NULL).
    let vehicleId: number | null = null;
    let vin: string | null = null;
    if (r.fleetVehicleId != null) {
      const fv = fvById.get(r.fleetVehicleId);
      if (!fv || fv.accountId !== account.id || fv.vehicleId == null) {
        skipped.push({ index: i, reason: "fleetVehicleId not found on this account" }); continue;
      }
      vehicleId = fv.vehicleId; vin = fv.vin;
    } else if (r.vehicleId != null) {
      const v = vById.get(r.vehicleId);
      if (!v) { skipped.push({ index: i, reason: "vehicleId not found" }); continue; }
      vehicleId = v.id; vin = v.vin;
    } else {
      skipped.push({ index: i, reason: "must specify fleetVehicleId or vehicleId" }); continue;
    }

    // Same catalog logic as POST /jobs — keeps tier gating + commission math
    // identical to consumer jobs. Fleet intake never overrides pricing.
    const catalogEntry = r.serviceSlug ? findServiceBySlug(r.serviceSlug) : undefined;
    const finalJobType = (catalogEntry?.category ?? r.jobType) as ServiceCategory | undefined;
    if (!finalJobType || !["repair", "diagnostic", "maintenance", "detailing"].includes(finalJobType)) {
      skipped.push({ index: i, reason: "jobType or serviceSlug required" }); continue;
    }
    const finalRequiredTier: TierKey = catalogEntry?.tier ?? "detailer";

    const priority =
      r.priority ?? (contract?.priorityOverride as "standard" | "priority" | "urgent" | undefined) ?? account.defaultPriority;

    const [job] = await db.insert(jobsTable).values({
      vehicleId, vin: vin!,
      customerId: account.ownerId,         // owner-of-record for IDOR + dashboards
      jobType: finalJobType,
      serviceSlug: catalogEntry?.slug ?? null,
      requiredTier: finalRequiredTier,
      description: r.description,
      locationLat: r.locationLat ?? null,
      locationLng: r.locationLng ?? null,
      locationAddress: r.locationAddress ?? null,
      status: "REQUESTED",
      sourceType: accountKey,
      fleetAccountId: account.id,
      fleetContractId: contract?.id ?? null,
      fleetPriority: priority,
    }).returning({ id: jobsTable.id });

    created.push({ jobId: job.id, vin: vin! });
  }

  res.status(201).json({
    accountId: account.id, sourceType: accountKey,
    created, skipped,
    summary: { requested: parsed.data.requests.length, created: created.length, skipped: skipped.length },
  });
});

/* -------------------------------------------------------------------------- */
/* List jobs for a fleet account (read-only view for shop owner / admin)      */
/* -------------------------------------------------------------------------- */

router.get("/fleet/accounts/:id/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const g = gate(req); if (!g.ok) { res.status(g.status).json({ error: g.msg }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const a = await assertAccountAccess(req, id);
  if (a.error) { res.status(a.error.status).json({ error: a.error.msg }); return; }
  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.fleetAccountId, id)).orderBy(desc(jobsTable.createdAt));
  res.json(jobs);
});

export default router;
