/**
 * Parts-order lifecycle engine.
 *
 * Responsibilities:
 *
 *   - validateOrder: hard server-side check that the catalog entry is
 *     compatible with the job's vehicle. Returns blocked|warned|passed.
 *     Mechanics CANNOT bypass this — even if the picker showed the part,
 *     the order route refuses on `blocked` and stamps the warning
 *     reasons on the row when `warned`.
 *
 *   - createOrder: insert a `parts_orders` row at status=candidate with
 *     a snapshotted confidence + validation state.
 *
 *   - placeOrder: ask the supplier adapter to actually order the part.
 *     Adapters that don't support live ordering throw
 *     SupplierNotConfiguredError; we catch and leave the row in
 *     candidate so the mechanic can fulfill manually.
 *
 *   - transitionStatus: ordered → received → installed (or
 *     cancelled/returned). Each transition is gated against the prior
 *     state so we never skip steps.
 *
 *   - customerView: customer-safe slice — brand, name, qty, warranty,
 *     msrp. NEVER the supplier_key, supplier sku, internal cost, or
 *     margin/payout fields. Used by the customer invoice screen.
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  partsOrdersTable, partsCatalogTable,
  mechanicVehicleProfilesTable, jobsTable,
  type PartsOrder, type PartsCatalogEntry,
  type PartsOrderStatus, type PartsOrderConfidence,
  type PartsOrderValidation,
} from "@workspace/db";
import { scoreCatalogEntry } from "./partsCatalogEngine";
import { getSupplier } from "./suppliers/registry";
import { SupplierNotConfiguredError } from "./suppliers/types";

export interface ValidationOutcome {
  state: PartsOrderValidation;
  reasons: string[];
  confidence: PartsOrderConfidence;
}

/**
 * Server-side compatibility check. Customers/mechanics cannot manipulate
 * this — every order route runs it before insert and stamps the result
 * on the row.
 */
export async function validateOrder(jobId: number, catalogId: number, qty: number): Promise<ValidationOutcome> {
  const reasons: string[] = [];
  if (qty < 1 || qty > 99) {
    return { state: "blocked", confidence: "manual_verify", reasons: ["Quantity must be 1–99"] };
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return { state: "blocked", confidence: "manual_verify", reasons: ["Job not found"] };

  const [catalog] = await db.select().from(partsCatalogTable).where(eq(partsCatalogTable.id, catalogId));
  if (!catalog || !catalog.active) {
    return { state: "blocked", confidence: "manual_verify", reasons: ["Catalog entry not found or inactive"] };
  }

  const [profile] = await db.select().from(mechanicVehicleProfilesTable)
    .where(eq(mechanicVehicleProfilesTable.vehicleId, job.vehicleId));

  const score = await scoreCatalogEntry(profile ?? null, catalogId);

  // Mapping: exact_vin/oem_confirmed → passed. supplier_confirmed → warned.
  // universal → warned (acceptable but not VIN-specific). manual_verify →
  // warned (engine literally couldn't confirm — mechanic must override).
  let state: PartsOrderValidation;
  if (score.confidence === "exact_vin" || score.confidence === "oem_confirmed") {
    state = "passed";
  } else {
    state = "warned";
  }

  return { state, confidence: score.confidence, reasons: [...reasons, ...score.reasons] };
}

export async function createOrder(input: {
  jobId: number;
  mechanicId: number;
  catalogId: number;
  supplierKey: string;
  sku: string;
  qty: number;
  unitPriceCents: number;
}): Promise<{ ok: true; order: PartsOrder } | { ok: false; status: number; error: string; reasons?: string[] }> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, input.jobId));
  if (!job) return { ok: false, status: 404, error: "Job not found" };
  if (!job.mechanicId || job.mechanicId !== input.mechanicId) {
    return { ok: false, status: 403, error: "Only the assigned mechanic can order parts for this job." };
  }

  const validation = await validateOrder(input.jobId, input.catalogId, input.qty);
  if (validation.state === "blocked") {
    return { ok: false, status: 422, error: "Order blocked by compatibility engine.", reasons: validation.reasons };
  }

  const totalPriceCents = input.unitPriceCents * input.qty;
  const [order] = await db.insert(partsOrdersTable).values({
    jobId: input.jobId,
    vehicleId: job.vehicleId,
    vin: job.vin,
    mechanicId: input.mechanicId,
    catalogId: input.catalogId,
    supplierKey: input.supplierKey,
    sku: input.sku,
    qty: input.qty,
    unitPriceCents: input.unitPriceCents,
    totalPriceCents,
    status: "candidate",
    confidence: validation.confidence,
    validationState: validation.state,
    validationReasons: validation.reasons,
  }).returning();
  return { ok: true, order };
}

/**
 * Ask the supplier adapter to actually fulfill an existing candidate
 * order. Mutates the row to status=ordered + stamps supplierOrderRef
 * + supplierInvoiceUrl on success. Best-effort — if the adapter doesn't
 * support live ordering, the order stays candidate and the reason is
 * appended to validationReasons.
 */
export async function placeOrder(orderId: number): Promise<PartsOrder> {
  const [order] = await db.select().from(partsOrdersTable).where(eq(partsOrdersTable.id, orderId));
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status !== "candidate") return order;

  const adapter = getSupplier(order.supplierKey);
  if (!adapter) {
    const [updated] = await db.update(partsOrdersTable)
      .set({ validationReasons: [...order.validationReasons, `Supplier "${order.supplierKey}" not registered`] })
      .where(eq(partsOrdersTable.id, orderId)).returning();
    return updated!;
  }

  try {
    const result = await adapter.placeOrder({
      catalogId: order.catalogId,
      sku: order.sku,
      qty: order.qty,
      externalRef: `job-${order.jobId}-order-${order.id}`,
    });
    const [updated] = await db.update(partsOrdersTable).set({
      status: "ordered",
      orderedAt: new Date(),
      supplierOrderRef: result.supplierOrderRef,
      supplierInvoiceUrl: result.invoiceUrl ?? order.supplierInvoiceUrl,
    }).where(eq(partsOrdersTable.id, orderId)).returning();
    return updated!;
  } catch (e) {
    const reason = e instanceof SupplierNotConfiguredError ? e.message : (e as Error).message;
    const [updated] = await db.update(partsOrdersTable)
      .set({ validationReasons: [...order.validationReasons, reason] })
      .where(eq(partsOrdersTable.id, orderId)).returning();
    return updated!;
  }
}

const NEXT_STATES: Record<PartsOrderStatus, PartsOrderStatus[]> = {
  candidate: ["ordered", "cancelled"],
  ordered:   ["received", "cancelled", "returned"],
  received:  ["installed", "returned"],
  installed: ["returned"],
  returned:  [],
  cancelled: [],
};

export async function transitionStatus(
  orderId: number, mechanicId: number | null, isAdmin: boolean,
  next: PartsOrderStatus, opts: { supplierInvoiceUrl?: string; supplierOrderRef?: string } = {},
): Promise<{ ok: true; order: PartsOrder } | { ok: false; status: number; error: string }> {
  return await db.transaction(async (tx) => {
    const [order] = await tx.select().from(partsOrdersTable).where(eq(partsOrdersTable.id, orderId));
    if (!order) return { ok: false as const, status: 404, error: "Order not found" };
    if (!isAdmin && order.mechanicId !== mechanicId) {
      return { ok: false as const, status: 403, error: "Only the ordering mechanic or an admin can change this order." };
    }
    const allowed = NEXT_STATES[order.status];
    if (!allowed.includes(next)) {
      return { ok: false as const, status: 409, error: `Cannot transition ${order.status} → ${next}` };
    }
    const now = new Date();
    const stamp: Record<string, unknown> = { status: next };
    if (next === "ordered")   stamp.orderedAt   = now;
    if (next === "received")  stamp.receivedAt  = now;
    if (next === "installed") stamp.installedAt = now;
    if (next === "cancelled") stamp.cancelledAt = now;
    if (opts.supplierInvoiceUrl) stamp.supplierInvoiceUrl = opts.supplierInvoiceUrl;
    if (opts.supplierOrderRef)   stamp.supplierOrderRef   = opts.supplierOrderRef;
    const [updated] = await tx.update(partsOrdersTable).set(stamp)
      .where(eq(partsOrdersTable.id, orderId)).returning();
    return { ok: true as const, order: updated! };
  });
}

export async function listForJob(jobId: number): Promise<Array<PartsOrder & { catalog: PartsCatalogEntry | null }>> {
  const orders = await db.select().from(partsOrdersTable).where(eq(partsOrdersTable.jobId, jobId));
  if (orders.length === 0) return [];
  const ids = Array.from(new Set(orders.map((o) => o.catalogId)));
  const cats = await db.select().from(partsCatalogTable).where(inArray(partsCatalogTable.id, ids));
  const catMap = new Map<number, PartsCatalogEntry>();
  for (const c of cats) catMap.set(c.id, c);
  return orders.map((o) => ({ ...o, catalog: catMap.get(o.catalogId) ?? null }));
}

/**
 * Customer-safe view of the parts on a job. Brand, item name, qty,
 * warranty, msrp ONLY. NEVER expose supplier_key, supplier sku, internal
 * unit cost, validation reasons, or any payout/margin field.
 */
export interface CustomerPartLine {
  brand: string;
  name: string;
  qty: number;
  warrantyMonths: number;
  msrpCents: number;
}

export async function customerView(jobId: number): Promise<CustomerPartLine[]> {
  const rows = await listForJob(jobId);
  return rows
    .filter((r) => r.status === "installed" && r.catalog)
    .map((r) => ({
      brand: r.catalog!.brand,
      name: r.catalog!.name,
      qty: r.qty,
      warrantyMonths: r.catalog!.warrantyMonths,
      msrpCents: r.catalog!.msrpCents,
    }));
}
