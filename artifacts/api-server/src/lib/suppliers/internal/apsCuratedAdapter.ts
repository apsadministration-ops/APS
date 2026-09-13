/**
 * APS-curated supplier adapter.
 *
 * The in-house "supplier" backed by the `parts_offers` table. Always
 * registered; serves as the default offer source until real B2B
 * aggregators (PartsTech, Nexpart, WHI, etc.) are configured.
 *
 * `placeOrder` does NOT throw — APS-curated orders stay in the system as
 * a synthetic supplierOrderRef so the mechanic can mark them ordered /
 * received / installed. When a real supplier comes online, the engine
 * routes that supplier's offers to its own adapter automatically because
 * each `parts_offers.supplier_key` is independent.
 */

import { inArray } from "drizzle-orm";
import { db, partsOffersTable } from "@workspace/db";
import type {
  SupplierAdapter, SupplierOffer, SupplierOrderRequest, SupplierOrderResult,
} from "../types";

export const APS_CURATED_KEY = "aps-curated";

class ApsCuratedAdapter implements SupplierAdapter {
  readonly key = APS_CURATED_KEY;
  readonly label = "APS Curated";
  // Curated offers are local records; no external supplier order is placed.
  readonly supportsLiveOrders = false;

  async searchOffers(catalogIds: number[]): Promise<SupplierOffer[]> {
    if (catalogIds.length === 0) return [];
    const rows = await db.select().from(partsOffersTable)
      .where(inArray(partsOffersTable.catalogId, catalogIds));
    return rows
      .filter((r) => r.supplierKey === APS_CURATED_KEY)
      .map((r) => ({
        catalogId: r.catalogId,
        supplierKey: r.supplierKey,
        sku: r.sku,
        priceCents: r.priceCents,
        currency: r.currency,
        inStock: r.inStock,
        etaDays: r.etaDays,
        payload: r.payload ?? {},
      }));
  }

  async placeOrder(req: SupplierOrderRequest): Promise<SupplierOrderResult> {
    // APS-curated has no real supplier API yet. Issue a synthetic ref so
    // the mechanic can transition the order through its lifecycle.
    return {
      supplierOrderRef: `APS-${req.externalRef}`,
      etaDays: 2,
    };
  }
}

export const apsCuratedAdapter = new ApsCuratedAdapter();
