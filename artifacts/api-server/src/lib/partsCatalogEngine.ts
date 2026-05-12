/**
 * VIN-aware parts catalog search engine.
 *
 * Given a vehicle profile (enriched NHTSA decode persisted on
 * `mechanic_vehicle_profiles`) and a category, returns the matching
 * catalog entries scored by confidence, with all live supplier offers
 * fanned in from the supplier adapter registry.
 *
 * Confidence ladder (highest first):
 *
 *   exact_vin           — year + make + model + engine + drivetrain ALL match
 *   oem_confirmed       — year + make + model match, engine matches
 *   supplier_confirmed  — make + model match (year wildcard or engine null)
 *   universal           — fitment row has wildcard make/model
 *   manual_verify       — no fitment row matched; mechanic must confirm
 *
 * Engine is intentionally permissive: an empty/null pattern in fitment
 * means "any" for that dimension. The score reasons are surfaced to the
 * mechanic verbatim so they can audit WHY a confidence was assigned.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  partsCatalogTable, partsCatalogFitmentTable,
  type PartsCatalogEntry, type PartsCatalogFitment,
  type MechanicVehicleProfile,
  type PartsOrderConfidence,
} from "@workspace/db";
import { listAdapters } from "./suppliers/registry";
import type { SupplierOffer } from "./suppliers/types";

export interface CatalogRecommendation {
  catalog: PartsCatalogEntry;
  fitment: PartsCatalogFitment | null;
  confidence: PartsOrderConfidence;
  reasons: string[];
  offers: SupplierOffer[];
}

function lc(v: string | null | undefined): string | null {
  return v ? v.toLowerCase() : null;
}

function patternMatch(pattern: string | null, value: string | null): boolean {
  if (!pattern) return true;          // wildcard
  if (!value) return false;
  return value.toLowerCase().includes(pattern.toLowerCase());
}

function yearMatch(min: number | null, max: number | null, year: number | null): boolean {
  if (min === null && max === null) return true;
  if (year === null) return false;
  if (min !== null && year < min) return false;
  if (max !== null && year > max) return false;
  return true;
}

function scoreFitment(
  fit: PartsCatalogFitment,
  profile: Pick<MechanicVehicleProfile, "make" | "model" | "modelYear" | "engine" | "transmission" | "drivetrain" | "trim">,
): { confidence: PartsOrderConfidence; reasons: string[] } | null {
  const reasons: string[] = [];

  // Make/model gate first. Universal entries (both null) match anything.
  const universal = !fit.make && !fit.model;
  if (!universal) {
    if (!patternMatch(fit.make, profile.make)) return null;
    if (!patternMatch(fit.model, profile.model)) return null;
    reasons.push(`Make/model match (${fit.make} ${fit.model})`);
  } else {
    reasons.push("Universal fitment entry");
  }

  if (!yearMatch(fit.yearMin, fit.yearMax, profile.modelYear)) return null;
  if (fit.yearMin || fit.yearMax) {
    reasons.push(`Year ${profile.modelYear} in ${fit.yearMin ?? "*"}–${fit.yearMax ?? "*"}`);
  }

  const engineOk = patternMatch(fit.enginePattern, profile.engine);
  const trimOk = patternMatch(fit.trimPattern, profile.trim);
  const drivetrainOk = patternMatch(fit.drivetrainPattern, profile.drivetrain);
  const transmissionOk = patternMatch(fit.transmissionPattern, profile.transmission);

  if (!engineOk || !trimOk || !drivetrainOk || !transmissionOk) {
    // Make/model/year ok but a constraining pattern failed → soft decline.
    return null;
  }

  if (fit.enginePattern) reasons.push(`Engine matches "${fit.enginePattern}"`);
  if (fit.drivetrainPattern) reasons.push(`Drivetrain matches "${fit.drivetrainPattern}"`);
  if (fit.transmissionPattern) reasons.push(`Transmission matches "${fit.transmissionPattern}"`);
  if (fit.trimPattern) reasons.push(`Trim matches "${fit.trimPattern}"`);

  // Tier the confidence based on how specific the match is.
  let confidence: PartsOrderConfidence;
  if (universal) confidence = "universal";
  else if (fit.enginePattern && fit.drivetrainPattern && (fit.yearMin || fit.yearMax)) confidence = "exact_vin";
  else if ((fit.yearMin || fit.yearMax) && fit.enginePattern) confidence = "oem_confirmed";
  else if (fit.make && fit.model) confidence = "supplier_confirmed";
  else confidence = "universal";

  return { confidence, reasons };
}

const CONF_RANK: Record<PartsOrderConfidence, number> = {
  exact_vin: 5, oem_confirmed: 4, supplier_confirmed: 3, universal: 2, manual_verify: 1,
};

/**
 * Search the catalog for parts in `category` that fit the given profile.
 * Returns at most `limit` rows, sorted by confidence DESC then quality
 * tier (oem first) then price ascending.
 */
export async function searchCompatibleParts(
  profile: MechanicVehicleProfile | null,
  category: string,
  limit = 25,
): Promise<CatalogRecommendation[]> {
  // 1) Pull every active catalog row for the category.
  const catalog = await db.select().from(partsCatalogTable)
    .where(and(eq(partsCatalogTable.category, category), eq(partsCatalogTable.active, true)));
  if (catalog.length === 0) return [];

  const catalogIds = catalog.map((c) => c.id);

  // 2) Pull every fitment row for those catalog entries up front.
  const fitments = await db.select().from(partsCatalogFitmentTable)
    .where(inArray(partsCatalogFitmentTable.catalogId, catalogIds));
  const fitByCatalog = new Map<number, PartsCatalogFitment[]>();
  for (const f of fitments) {
    if (!fitByCatalog.has(f.catalogId)) fitByCatalog.set(f.catalogId, []);
    fitByCatalog.get(f.catalogId)!.push(f);
  }

  // 3) Score every catalog entry against the profile.
  const scored: CatalogRecommendation[] = catalog.map((c) => {
    const candidateFitments = fitByCatalog.get(c.id) ?? [];
    if (candidateFitments.length === 0 || !profile) {
      return {
        catalog: c, fitment: null, confidence: "manual_verify" as const,
        reasons: profile ? ["No fitment data — verify before ordering"] : ["Vehicle profile not yet decoded"],
        offers: [],
      };
    }
    let best: { fit: PartsCatalogFitment; confidence: PartsOrderConfidence; reasons: string[] } | null = null;
    for (const fit of candidateFitments) {
      const s = scoreFitment(fit, profile);
      if (!s) continue;
      if (!best || CONF_RANK[s.confidence] > CONF_RANK[best.confidence]) {
        best = { fit, confidence: s.confidence, reasons: s.reasons };
      }
    }
    if (best) {
      return { catalog: c, fitment: best.fit, confidence: best.confidence, reasons: best.reasons, offers: [] };
    }
    return {
      catalog: c, fitment: null, confidence: "manual_verify" as const,
      reasons: ["Catalog has fitment rows but none matched this VIN — verify before ordering"],
      offers: [],
    };
  });

  // 4) Sort by confidence then quality tier then price (filled in step 5).
  scored.sort((a, b) => {
    const cdiff = CONF_RANK[b.confidence] - CONF_RANK[a.confidence];
    if (cdiff !== 0) return cdiff;
    const qrank = (q: string) => q === "oem" ? 4 : q === "premium" ? 3 : q === "standard" ? 2 : 1;
    return qrank(b.catalog.qualityTier) - qrank(a.catalog.qualityTier);
  });

  const top = scored.slice(0, limit);

  // 5) Fan out to every registered supplier adapter for offers.
  const topIds = top.map((r) => r.catalog.id);
  const adapters = listAdapters();
  const offerLists = await Promise.all(
    adapters.map((a) => a.searchOffers(topIds).catch(() => [] as SupplierOffer[])),
  );
  const offersByCatalog = new Map<number, SupplierOffer[]>();
  for (const offers of offerLists) {
    for (const o of offers) {
      if (!offersByCatalog.has(o.catalogId)) offersByCatalog.set(o.catalogId, []);
      offersByCatalog.get(o.catalogId)!.push(o);
    }
  }
  for (const r of top) {
    r.offers = (offersByCatalog.get(r.catalog.id) ?? [])
      .sort((a, b) => a.priceCents - b.priceCents);
  }
  return top;
}

/**
 * One-off score for a single catalog entry — used by the order
 * validation gate to recompute confidence at order time, independent of
 * what the picker showed.
 */
export async function scoreCatalogEntry(
  profile: MechanicVehicleProfile | null,
  catalogId: number,
): Promise<{ confidence: PartsOrderConfidence; reasons: string[] }> {
  if (!profile) return { confidence: "manual_verify", reasons: ["Vehicle profile not decoded"] };
  const fitments = await db.select().from(partsCatalogFitmentTable)
    .where(eq(partsCatalogFitmentTable.catalogId, catalogId));
  if (fitments.length === 0) return { confidence: "manual_verify", reasons: ["No fitment data — verify before ordering"] };
  let best: { confidence: PartsOrderConfidence; reasons: string[] } | null = null;
  for (const fit of fitments) {
    const s = scoreFitment(fit, profile);
    if (!s) continue;
    if (!best || CONF_RANK[s.confidence] > CONF_RANK[best.confidence]) best = s;
  }
  return best ?? { confidence: "manual_verify", reasons: ["Catalog has fitment rows but none matched this VIN"] };
}

// Tiny re-exports so callers don't have to import drizzle helpers directly.
export const _orInternal = or;
export const _sqlInternal = sql;
