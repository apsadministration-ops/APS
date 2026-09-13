import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  jobsTable,
  partnerOrganizationsTable,
  partnerServiceRequestsTable,
  vehiclesTable,
  usersTable,
  workLogsTable,
  paymentsTable,
  messagesTable,
} from "@workspace/db";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { notifyMechanics, notifyCustomerApprovalPending } from "../lib/notifications";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { awardCustomerPoints, awardMechanicPoints, RULES } from "../lib/loyaltyEngine";
import { startCustomerApproval } from "../lib/customerApprovalEngine";
import { requiresLiftFromDescription } from "../lib/transportKeywords";
import { customerApprovalsTable } from "@workspace/db";
import {
  findServiceBySlug,
  tierLevel,
  mechanicQualifiedFor,
  commissionForJob,
  quoteForService,
  isEuropeanVehicle,
  type TierKey,
  type ServiceCategory,
} from "@workspace/tier-catalog";
import { parsePositiveSafeInteger } from "../lib/validation";
import { isPartnerJobOwner } from "../lib/commercialJobAccess";
import { canCancelJob } from "../lib/authorization";

/**
 * If the job has an uncaptured Stripe authorization, void it so the
 * customer's funds aren't held indefinitely. Best-effort — failures are
 * logged but don't block the cancel/delete operation.
 */
async function voidStripeAuthorizationForJob(jobId: number, log: { error: (o: object, m: string) => void }) {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (!payment) return;
  if (!["pending", "authorized"].includes(payment.status)) return;
  try {
    const stripe = await getUncachableStripeClient();
    // Expire any open Checkout session FIRST so the customer can't still
    // complete it post-cancel and create an orphaned hold. (No-op if the
    // session has already moved past the open state.)
    if (payment.providerSessionId) {
      await stripe.checkout.sessions.expire(payment.providerSessionId).catch(() => {});
    }
    // Then cancel the intent if one was already issued (i.e. we got past
    // checkout.session.completed).
    // If the intent ID isn't on file yet (webhook may be delayed), look it
    // up from the Checkout session so we can cancel it now and avoid leaving
    // a hold on the customer's card.
    let intentId = payment.providerPaymentIntentId;
    if (!intentId && payment.providerSessionId) {
      try {
        const sess = await stripe.checkout.sessions.retrieve(payment.providerSessionId);
        intentId = typeof sess.payment_intent === "string"
          ? sess.payment_intent
          : sess.payment_intent?.id ?? null;
      } catch { /* session may have expired — nothing to cancel */ }
    }
    if (intentId) {
      await stripe.paymentIntents.cancel(intentId).catch(() => {});
    }
    // Clear providerSessionId so a delayed checkout.session.completed webhook
    // won't find a row to update — it'll hit the orphan path and self-cancel.
    await db.update(paymentsTable)
      .set({ status: "canceled", providerSessionId: null, providerPaymentIntentId: intentId ?? payment.providerPaymentIntentId })
      .where(eq(paymentsTable.id, payment.id));
  } catch (err) {
    log.error({ err, jobId }, "Failed to cancel Stripe authorization on job cancel/delete");
  }
}

const router: IRouter = Router();

export async function formatJob(
  job: typeof jobsTable.$inferSelect,
  options: { sanitizeCommercial?: boolean } = {},
) {
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
  const mechanic = job.mechanicId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId)))[0] ?? null
    : null;
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  // A source-linked commercial job is business-facing even though
  // `customerId` remains the human principal for authorization, payment,
  // review, and audit flows. Require the complete reverse link before using
  // the organization label so a malformed/stale pair cannot disclose another
  // organization's identity.
  let commercialOrganization: {
    name: string;
    legalName: string | null;
  } | null = null;
  if (job.sourceOrganizationId != null && job.sourceServiceRequestId != null) {
    const [linked] = await db
      .select({
        name: partnerOrganizationsTable.name,
        legalName: partnerOrganizationsTable.legalName,
      })
      .from(partnerOrganizationsTable)
      .innerJoin(
        partnerServiceRequestsTable,
        and(
          eq(
            partnerServiceRequestsTable.organizationId,
            partnerOrganizationsTable.id,
          ),
          eq(
            partnerServiceRequestsTable.id,
            job.sourceServiceRequestId,
          ),
          eq(partnerServiceRequestsTable.linkedApsJobId, job.id),
        ),
      )
      .where(eq(partnerOrganizationsTable.id, job.sourceOrganizationId));
    commercialOrganization = linked ?? null;
  }
  const customerDisplayName = commercialOrganization
    ? commercialOrganization.name || commercialOrganization.legalName || "Business"
    : customer?.name ?? "Unknown";
  return {
    id: job.id,
    vehicleId: job.vehicleId,
    vin: job.vin,
    customerId: job.customerId,
    // Keep customerId as the human principal. Only the display label changes
    // for a validated commercial source link; ordinary customer jobs retain
    // the existing human name.
    customerName: customerDisplayName,
    mechanicId: job.mechanicId ?? null,
    mechanicName: mechanic?.name ?? null,
    jobType: job.jobType,
    description: job.description,
    locationLat: job.locationLat ?? null,
    locationLng: job.locationLng ?? null,
    locationAddress: job.locationAddress ?? null,
    status: job.status,
    mechanicLat: job.mechanicLat ?? null,
    mechanicLng: job.mechanicLng ?? null,
    mechanicLocationUpdatedAt: job.mechanicLocationUpdatedAt ?? null,
    estimatedPrice: job.estimatedPrice ?? null,
    finalPrice: job.finalPrice ?? null,
    rating: job.rating ?? null,
    ratingNote: job.ratingNote ?? null,
    mechanicReviewText: job.mechanicReviewText ?? null,
    customerRating: job.customerRating ?? null,
    customerReviewText: job.customerReviewText ?? null,
    requestedMechanicId: job.requestedMechanicId ?? null,
    requiresGhostGarage: job.requiresGhostGarage,
    customerTransportApproved: job.customerTransportApproved,
    serviceSlug: job.serviceSlug ?? null,
    requiredTier: (job.requiredTier ?? null) as TierKey | null,
    postedByShopId: job.postedByShopId ?? null,
    partnerKindSnapshot: job.partnerKindSnapshot ?? null,
    sourceOrganizationId: options.sanitizeCommercial ? null : (job.sourceOrganizationId ?? null),
    sourceServiceRequestId: options.sanitizeCommercial ? null : (job.sourceServiceRequestId ?? null),
    // The bridge stores requestedWork as the public job description. Private
    // organization notes/context never enter this mechanic-facing formatter.
    commercialSource: job.sourceOrganizationId != null && job.sourceServiceRequestId != null
      ? {
          organizationId: options.sanitizeCommercial ? null : job.sourceOrganizationId,
          serviceRequestId: options.sanitizeCommercial ? null : job.sourceServiceRequestId,
          subtype: job.partnerKindSnapshot === "fleet" ? "fleet" : "dealership",
          requestedWork: job.description,
        }
      : null,
    urgency: job.urgency,
    juniorVisibleAt: job.juniorVisibleAt ?? null,
    recurringGroupId: job.recurringGroupId ?? null,
    vehicle: vehicle ? {
      id: vehicle.id, vin: vehicle.vin, make: vehicle.make, model: vehicle.model,
      year: vehicle.year, trim: vehicle.trim ?? null, color: vehicle.color ?? null, createdAt: vehicle.createdAt,
    } : null,
    createdAt: job.createdAt,
    acceptedAt: job.acceptedAt ?? null,
    completedAt: job.completedAt ?? null,
  };
}

router.get("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { status, vehicleId, mechanicId } = req.query as { status?: string; vehicleId?: string; mechanicId?: string };
  let allJobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);
  if (req.userRole === "customer") allJobs = allJobs.filter((j) => j.customerId === req.userId);
  else if (req.userRole === "shop_owner") {
    // Partner job posting puts the shop owner on the job as customer-of-record.
    // They should only see their own jobs (NOT every job in the system).
    const owned = await Promise.all(
      allJobs
        .filter((j) => j.customerId === req.userId)
        .map(async (j) => (await isPartnerJobOwner(j, req.userId!)) ? j.id : null),
    );
    const ownedIds = new Set(owned.filter((id): id is number => id !== null));
    allJobs = allJobs.filter((j) => ownedIds.has(j.id));
  }
  else if (req.userRole === "mechanic") {
    allJobs = allJobs.filter((j) =>
      j.mechanicId === req.userId ||
      (j.status === "REQUESTED" && (j.requestedMechanicId == null || j.requestedMechanicId === req.userId))
    );
  }
  if (status) allJobs = allJobs.filter((j) => j.status === status);
  if (vehicleId) allJobs = allJobs.filter((j) => j.vehicleId === parseInt(vehicleId, 10));
  if (mechanicId) allJobs = allJobs.filter((j) => j.mechanicId === parseInt(mechanicId, 10));
  res.json(await Promise.all(allJobs.map((job) => formatJob(job, {
    sanitizeCommercial: req.userRole === "mechanic",
  }))));
});

router.get("/jobs/available", authenticate, async (req: AuthRequest, res): Promise<void> => {
  // Only approved mechanics (and admins) may browse the open bid pool. The
  // payload includes customer addresses + lat/lng — exposing it to customers
  // or shop owners would leak every requesting customer's home address to
  // anyone who signs up.
  if (req.userRole !== "mechanic" && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // Pending mechanics shouldn't be able to scrape customer addresses while
  // their account is awaiting review.
  if (req.userRole === "mechanic" && req.user?.status !== "active") {
    res.status(403).json({ error: "Your mechanic account is pending admin approval." }); return;
  }
  let jobs = await db.select().from(jobsTable).where(eq(jobsTable.status, "REQUESTED")).orderBy(jobsTable.createdAt);

  // If a job is requested for a specific mechanic, only that mechanic sees it.
  if (req.userRole === "mechanic") {
    jobs = jobs.filter((j) => j.requestedMechanicId == null || j.requestedMechanicId === req.userId);
    const [mechanic] = await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!));
    const myTier = (mechanic?.mechanicTier ?? "detailer") as TierKey;
    const myLevel = tierLevel(myTier);
    const mode = String((req.query as { mode?: string }).mode ?? "my_tier");

    // Fleet & Commercial Partner priority window: partner-posted jobs (with
    // a non-null juniorVisibleAt) are visible to senior+ tiers immediately
    // and to junior tiers (technician/detailer) only after the window
    // elapses. Window is urgency-driven (urgent=0s, high=15m, normal=1h,
    // low=4h) and stamped at post-time by partnerJobs.ts.
    const nowMs = Date.now();
    const seniorLevel = tierLevel("senior");
    jobs = jobs.filter((j) => {
      const reqTier = (j.requiredTier as TierKey | null) ?? "detailer";
      const reqLevel = tierLevel(reqTier);
      // Mechanics may NEVER see jobs above their tier — they couldn't
      // accept them anyway and the address/customer info is sensitive.
      if (reqLevel > myLevel) return false;
      // Partner-priority gate: if the job has a juniorVisibleAt and the
      // mechanic is sub-senior, hide until the window elapses.
      if (j.juniorVisibleAt != null && myLevel < seniorLevel) {
        if (new Date(j.juniorVisibleAt).getTime() > nowMs) return false;
      }
      if (mode === "work_down") return true;
      // Default "my_tier": exact-tier-match only (or legacy detailer rows
      // for everyone who's at-or-above detailer, which is everyone).
      return reqLevel === myLevel || j.requiredTier == null;
    });
  }

  res.json(await Promise.all(jobs.map((job) => formatJob(job, {
    sanitizeCommercial: req.userRole === "mechanic",
  }))));
});

router.post("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer" && req.userRole !== "admin") {
    res.status(403).json({ error: "Only customers can create jobs" }); return;
  }
  const { vehicleId, jobType, serviceSlug, description, locationLat, locationLng, locationAddress, requestedMechanicId } = req.body as {
    vehicleId: number; jobType?: string; serviceSlug?: string; description: string;
    locationLat?: number; locationLng?: number; locationAddress?: string;
    requestedMechanicId?: number;
  };
  // NOTE: any client-supplied `estimatedPrice` is intentionally ignored.
  // Pricing is derived server-side from the catalog flat-rate + European
  // premium below so the customer can never see one number and pay another.
  if (!vehicleId || !description) {
    res.status(400).json({ error: "vehicleId and description are required" }); return;
  }
  // Resolve catalog entry. `serviceSlug` is preferred — when present we use
  // the catalog's category + tier as the source of truth so visibility and
  // commission can never disagree with what the customer actually picked.
  const catalogEntry = findServiceBySlug(serviceSlug);
  if (serviceSlug && !catalogEntry) {
    res.status(400).json({ error: `Unknown serviceSlug: ${serviceSlug}` }); return;
  }
  const finalJobType = (catalogEntry?.category ?? jobType) as ServiceCategory | undefined;
  if (!finalJobType || !["repair", "diagnostic", "maintenance", "detailing"].includes(finalJobType)) {
    res.status(400).json({ error: "jobType (or serviceSlug) is required" }); return;
  }
  const finalRequiredTier: TierKey = catalogEntry?.tier ?? "detailer";
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  let validatedReqMech: number | null = null;
  if (requestedMechanicId) {
    const [m] = await db.select().from(usersTable).where(eq(usersTable.id, requestedMechanicId));
    if (!m || m.role !== "mechanic" || m.status !== "active") {
      res.status(400).json({ error: "Requested mechanic is not available" }); return;
    }
    validatedReqMech = requestedMechanicId;
  }

  // Lift requirement is auto-derived from the description (tires, exhaust,
  // transmission, suspension, etc). The customer no longer toggles this
  // manually — keyword detection is the single source of truth so the same
  // job description always classifies the same way regardless of UI version.
  const ghostGarage = requiresLiftFromDescription(description);

  // Server-derived flat-rate price: catalog base × (1 + European premium).
  // Clients NEVER set this — they receive a quote breakdown via
  // GET /quotes/service/:slug?vehicleId=… and what they see is what they pay.
  // Services without a published flat rate (e.g. "Performance Tuning") leave
  // estimatedPrice null until a mechanic logs work or admin sets one.
  const isEuropean = isEuropeanVehicle({ vin: vehicle.vin, make: vehicle.make });
  const quote = catalogEntry ? quoteForService(catalogEntry, { isEuropean }) : null;
  const derivedPrice: number | null = quote ? quote.bookedTotal : null;

  const [job] = await db.insert(jobsTable).values({
    vehicleId, vin: vehicle.vin, customerId: req.userId!,
    jobType: finalJobType,
    serviceSlug: catalogEntry?.slug ?? null,
    requiredTier: finalRequiredTier,
    description, locationLat: locationLat ?? null, locationLng: locationLng ?? null,
    locationAddress: locationAddress ?? null, estimatedPrice: derivedPrice,
    requestedMechanicId: validatedReqMech, status: "REQUESTED",
    requiresGhostGarage: ghostGarage,
    customerTransportApproved: !ghostGarage,
  }).returning();

  // Notify mechanics: if requested-specific, only that mechanic; else all active mechanics.
  const mechWhere = validatedReqMech
    ? and(eq(usersTable.role, "mechanic"), eq(usersTable.id, validatedReqMech))
    : eq(usersTable.role, "mechanic");
  db.select({ pushToken: usersTable.pushToken }).from(usersTable).where(mechWhere)
    .then((mechanics) => {
      const tokens = mechanics.map((m) => m.pushToken).filter(Boolean) as string[];
      notifyMechanics(tokens, finalJobType, description, job.id).catch(() => {});
    })
    .catch(() => {});

  res.status(201).json(await formatJob(job));
});

router.get("/jobs/:jobId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // IDOR guard: only the customer who created the job, the assigned mechanic,
  // an admin, or — while still REQUESTED — a mechanic eligible to bid (no
  // requested-mechanic restriction, or matching the requested-mechanic-id)
  // may view a job.
  const isCustomer = req.userRole === "customer" && job.customerId === req.userId;
  const isPartnerOwner = req.userRole === "shop_owner" && await isPartnerJobOwner(job, req.userId!);
  const isAssignedMechanic = req.userRole === "mechanic" && job.mechanicId === req.userId;
  // Pending/suspended mechanics must not see job details (location, customer
  // info) — only approved (active) mechanics can browse the bid pool.
  const isEligibleBidder = req.userRole === "mechanic" && req.user?.status === "active"
    && job.status === "REQUESTED"
    && (job.requestedMechanicId == null || job.requestedMechanicId === req.userId);
  const isAdmin = req.userRole === "admin";
  if (!isCustomer && !isPartnerOwner && !isAssignedMechanic && !isEligibleBidder && !isAdmin) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(await formatJob(job, {
    sanitizeCommercial: req.userRole === "mechanic",
  }));
});

router.patch("/jobs/:jobId/status", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const { status, estimatedPrice } = req.body as { status: string; estimatedPrice?: number };
  // Pricing is server-derived from the catalog. Only admins can override it
  // (e.g. one-off custom quote outside the catalog) — mechanics are never
  // allowed to change the price the customer sees after booking.
  if (estimatedPrice !== undefined && req.userRole !== "admin") {
    res.status(403).json({ error: "Pricing is set by the catalog and cannot be changed by the mechanic." });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // IDOR guard: only the assigned mechanic (for in-progress status updates)
  // or admin may patch job status. Customers cannot move job state directly —
  // they cancel via /cancel and pay via /payments.
  const isAssignedMechanic = req.userRole === "mechanic" && job.mechanicId === req.userId
    && req.user?.status === "active";
  if (!(req.userRole === "admin" || isAssignedMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // Job completion MUST flow through POST /worklogs so the audit trail
  // (work log, mileage update, payment capture, Ghost Garage inspections)
  // stays in lockstep with the COMPLETED transition. Mechanics flipping
  // the status directly would let them skip those gates.
  if (status === "COMPLETED" && req.userRole !== "admin") {
    res.status(409).json({
      error: "Submit a work log to complete a job — direct status changes to COMPLETED are not allowed.",
    });
    return;
  }
  const updates: Partial<typeof jobsTable.$inferInsert> = { status: status as typeof job.status };
  if (estimatedPrice !== undefined) updates.estimatedPrice = estimatedPrice;
  if (status === "COMPLETED") updates.completedAt = new Date();
  if (status === "ACCEPTED") updates.acceptedAt = new Date();
  const [updated] = await db.update(jobsTable).set(updates).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated, {
    sanitizeCommercial: req.userRole === "mechanic",
  }));
});

// Customer approves transport of their vehicle to a shop bay. Required for
// any job with requiresGhostGarage=true before a bay booking can be made.
router.post("/jobs/:jobId/transport-approval", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const isCustomer = req.userRole === "customer" && job.customerId === req.userId;
  const isPartnerOwner = req.userRole === "shop_owner" && await isPartnerJobOwner(job, req.userId!);
  if (!isCustomer && !isPartnerOwner) {
    res.status(403).json({ error: "Only the job's customer can approve transport" }); return;
  }
  if (!job.requiresGhostGarage) {
    res.status(400).json({ error: "This job does not need transport approval" }); return;
  }
  const [updated] = await db.update(jobsTable)
    .set({ customerTransportApproved: true })
    .where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/accept", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parsePositiveSafeInteger(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
  // Tier gate: load the mechanic's tier ONCE outside the tx so we can fail
  // fast with a clean 403 before locking the job row.
  const [me] = await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!));
  const myTier = (me?.mechanicTier ?? "detailer") as TierKey;
  // Atomic accept: lock the job row, conditionally update only if it's still
  // in an acceptable status, and start the approval row in the SAME tx so we
  // never leave a job in PENDING_APPROVAL without a matching approval row.
  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT id, status, customer_id, required_tier FROM jobs WHERE id = ${jobId} FOR UPDATE`,
    );
    const job = (locked.rows[0] ?? null) as { id: number; status: string; customer_id: number; required_tier: string | null } | null;
    if (!job) return { ok: false as const, status: 404, error: "Job not found" };
    if (job.status !== "REQUESTED" && job.status !== "OFFERED") {
      return { ok: false as const, status: 409, error: "Job cannot be accepted in its current state" };
    }
    const reqTier = (job.required_tier as TierKey | null) ?? "detailer";
    if (!mechanicQualifiedFor(myTier, reqTier)) {
      return { ok: false as const, status: 403, error: `This job requires ${reqTier} tier or higher.` };
    }
    const updatedRows = await tx.update(jobsTable)
      .set({ status: "PENDING_APPROVAL", mechanicId: req.userId!, acceptedAt: new Date() })
      .where(and(
        eq(jobsTable.id, jobId),
        sql`${jobsTable.status} IN ('REQUESTED','OFFERED')`,
      ))
      .returning();
    if (updatedRows.length !== 1) {
      // Lost the race to another mechanic between the lock and the update —
      // shouldn't happen under FOR UPDATE but guard defensively anyway.
      return { ok: false as const, status: 409, error: "Job was just accepted by someone else" };
    }
    await tx.insert(customerApprovalsTable).values({
      jobId,
      mechanicId: req.userId!,
      customerId: job.customer_id,
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 1000),
    }).onConflictDoUpdate({
      target: customerApprovalsTable.jobId,
      set: {
        mechanicId: req.userId!,
        customerId: job.customer_id,
        status: "pending",
        expiresAt: new Date(Date.now() + 60 * 1000),
        respondedAt: null,
        declineReason: null,
      },
    });
    return { ok: true as const, updated: updatedRows[0]! };
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const updated = result.updated;

  // Trust system: the job is in PENDING_APPROVAL, not ACCEPTED yet. Notify the
  // customer that they have ~60s to approve this mechanic. The "Mechanic En
  // Route" notification fires later once the customer (or auto-sweep) approves.
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, updated.customerId));
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, updated.vehicleId));
  if (customer?.pushToken && mechanic) {
    notifyCustomerApprovalPending(customer.pushToken, mechanic.name, jobId).catch(() => {});
  }
  // `notifyCustomerJobAccepted` now fires from the approve handler, not here.
  void vehicle;

  res.json(await formatJob(updated, { sanitizeCommercial: true }));
});

router.post("/jobs/:jobId/cancel", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // Customers can cancel before acceptance. Mechanics may cancel an assigned
  // job only while active and before work starts; this reopens dispatch and
  // may void a payment authorization, so pending mechanics are not allowed.
  if (req.userRole === "mechanic" && req.user?.status !== "active") {
    res.status(403).json({ error: "Your mechanic account is not active." });
    return;
  }
  if (!canCancelJob({
    role: req.userRole,
    status: req.user?.status,
    userId: req.userId,
    customerId: job.customerId,
    mechanicId: job.mechanicId,
    jobStatus: job.status,
  })) {
    if (req.userRole !== "admin"
      && !((req.userRole === "customer" && job.customerId === req.userId)
        || (req.userRole === "mechanic" && job.mechanicId === req.userId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const msg = req.userRole === "mechanic"
      ? "You can only cancel a job before work has started (up through En Route)."
      : "Job cannot be cancelled after it has been accepted.";
    res.status(400).json({ error: msg }); return;
  }

  // If a mechanic cancels, free the job back up so other mechanics can pick
  // it up. The existing Stripe authorization is locked to the ORIGINAL
  // mechanic's Connect account (transfer_data.destination), so we MUST void
  // it — otherwise capture by the next mechanic would route funds to the old
  // mechanic. The customer will re-authorize once a new mechanic is assigned.
  if (req.userRole === "mechanic") {
    await voidStripeAuthorizationForJob(jobId, req.log);
    const [reopened] = await db.update(jobsTable)
      .set({ status: "REQUESTED", mechanicId: null, mechanicLat: null, mechanicLng: null, mechanicLocationUpdatedAt: null })
      .where(eq(jobsTable.id, jobId)).returning();
    res.json(await formatJob(reopened, { sanitizeCommercial: true }));
    return;
  }
  // Customer/admin cancellation: release any uncaptured Stripe hold so the
  // customer's funds are returned (otherwise they'd stay frozen until expiry).
  await voidStripeAuthorizationForJob(jobId, req.log);
  const [updated] = await db.update(jobsTable).set({ status: "CANCELLED" }).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

// Mechanic updates their live GPS location for a job
router.put("/jobs/:jobId/mechanic-location", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const { lat, lng } = req.body as { lat: number; lng: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ error: "lat and lng are required numbers" }); return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }
  await db.update(jobsTable)
    .set({ mechanicLat: lat, mechanicLng: lng, mechanicLocationUpdatedAt: new Date() })
    .where(eq(jobsTable.id, jobId));
  res.json({ ok: true });
});

// Admin can permanently delete a job and all related rows (work logs, payments, messages)
router.delete("/jobs/:jobId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Only admins can delete jobs" }); return;
  }
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  // Void any uncaptured Stripe authorization BEFORE deleting the payment row,
  // otherwise we'd lose the intent reference and orphan the customer's funds.
  await voidStripeAuthorizationForJob(jobId, req.log);
  await db.transaction(async (tx) => {
    await tx.delete(messagesTable).where(eq(messagesTable.jobId, jobId));
    await tx.delete(paymentsTable).where(eq(paymentsTable.jobId, jobId));
    await tx.delete(workLogsTable).where(eq(workLogsTable.jobId, jobId));
    await tx.execute(sql`DELETE FROM flags WHERE job_id = ${jobId}`);
    // Loyalty ledgers FK-reference jobs(id) — wipe before deleting the job.
    await tx.execute(sql`DELETE FROM loyalty_points WHERE job_id = ${jobId}`);
    await tx.execute(sql`DELETE FROM customer_points_ledger WHERE job_id = ${jobId}`);
    await tx.execute(sql`DELETE FROM mechanic_points_ledger WHERE job_id = ${jobId}`);
    await tx.delete(jobsTable).where(eq(jobsTable.id, jobId));
  });
  res.json({ ok: true });
});

router.post("/jobs/:jobId/rate", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Only customers can rate jobs" }); return; }
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.customerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (job.status !== "COMPLETED" && job.status !== "PAID") {
    res.status(400).json({ error: "Job must be completed before rating" }); return;
  }
  if (job.rating != null) { res.status(409).json({ error: "Already rated" }); return; }
  const { rating, note, reviewText } = req.body as { rating: number; note?: string; reviewText?: string };
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ error: "Rating must be between 1 and 5" }); return; }
  const [updated] = await db.update(jobsTable)
    .set({ rating, ratingNote: note ?? null, mechanicReviewText: reviewText ?? note ?? null })
    .where(eq(jobsTable.id, jobId)).returning();

  // CUSTOMER: survey points (any rating) + review points (when text supplied)
  // + quality bonus scaled by star rating.
  await awardCustomerPoints(
    job.customerId, RULES.customer.surveyBase, "survey",
    `Survey — Job #${jobId}`, jobId,
  ).catch(() => {});
  if (reviewText && reviewText.trim().length > 0) {
    const reviewPts = RULES.customer.reviewWithText + RULES.customer.reviewQualityBonus(rating);
    await awardCustomerPoints(
      job.customerId, reviewPts, "review",
      `Verified review (${rating}★) — Job #${jobId}`, jobId,
    ).catch(() => {});
  }
  // MECHANIC: rating bonus.
  if (job.mechanicId) {
    await awardMechanicPoints(
      job.mechanicId, RULES.mechanic.ratingBonus(rating), "rating",
      `Customer rating ${rating}★ — Job #${jobId}`, jobId,
    ).catch(() => {});
  }
  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/rate-customer", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Only mechanics can rate customers" }); return; }
  if (req.user?.status !== "active") { res.status(403).json({ error: "Your mechanic account is not active." }); return; }
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (job.status !== "COMPLETED" && job.status !== "PAID") {
    res.status(400).json({ error: "Job must be completed before rating" }); return;
  }
  if (job.customerRating != null) { res.status(409).json({ error: "Already rated" }); return; }
  const { rating, reviewText } = req.body as { rating: number; reviewText?: string };
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ error: "Rating must be between 1 and 5" }); return; }
  const [updated] = await db.update(jobsTable)
    .set({ customerRating: rating, customerReviewText: reviewText ?? null })
    .where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated, { sanitizeCommercial: true }));
});

export default router;
