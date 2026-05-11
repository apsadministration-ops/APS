/**
 * Parts compatibility / confidence engine.
 *
 * The mission: VIN decoding alone is NOT enough to recommend the exact part.
 * Trim levels, tow packages, heavy-duty packages, production date cutoffs, and
 * aftermarket modifications all affect what part actually fits. So this engine
 * combines:
 *
 *   1) Static category metadata — some categories (oil filter, cabin filter,
 *      wiper blades, spark plugs, air filter) are reliable from VIN alone.
 *      Others (brake pads/rotors, alternator, starter, suspension/steering)
 *      are flagged as "verify" by default.
 *
 *   2) Installed-parts history — if APS already has a previously-installed
 *      record for the same vehicle + category, we promote confidence to
 *      "high" and surface that exact part number first. APS becomes smarter
 *      than VIN alone exactly because of this layer.
 *
 *   3) Mechanic override log — if a previous mechanic overrode the engine's
 *      recommendation for this vehicle + category, the override note is
 *      included in the response so the next mechanic sees the institutional
 *      memory ("last guy used X because Y").
 *
 * This file is pure logic — no Express types — so it can be reused from
 * any future surface (background AI diagnostic prep, supplier integration,
 * etc.).
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db, installedPartsTable } from "@workspace/db";

export type Confidence = "high" | "medium" | "verify";

export interface CategoryMeta {
  key: string;
  label: string;
  baseConfidence: Confidence;
  /** Why verification is recommended — surfaced verbatim in the UI tooltip. */
  verifyReason?: string;
}

/**
 * Catalog of categories APS reasons about today. Adding a new category here
 * ships without a DB migration. Keep keys snake_case so they match the
 * `installed_parts.category` strings.
 */
export const PARTS_CATEGORIES: CategoryMeta[] = [
  // High-confidence (VIN alone is enough for the vast majority of vehicles).
  { key: "oil_filter",   label: "Oil Filter",   baseConfidence: "high" },
  { key: "cabin_filter", label: "Cabin Filter", baseConfidence: "high" },
  { key: "air_filter",   label: "Engine Air Filter", baseConfidence: "high" },
  { key: "wiper_blades", label: "Wiper Blades", baseConfidence: "high" },
  { key: "spark_plugs",  label: "Spark Plugs",  baseConfidence: "high" },
  // Medium — usually right but worth a glance.
  { key: "battery",      label: "Battery",      baseConfidence: "medium",
    verifyReason: "Group size varies by trim and cold-cranking-amp option." },
  // Verification recommended — known to vary heavily by trim / package.
  { key: "brake_pads_front",  label: "Front Brake Pads",  baseConfidence: "verify",
    verifyReason: "Pad size differs between base, sport, tow, and HD packages." },
  { key: "brake_pads_rear",   label: "Rear Brake Pads",   baseConfidence: "verify",
    verifyReason: "Some trims use rear drums; verify caliper type." },
  { key: "rotor_front",       label: "Front Rotors",      baseConfidence: "verify",
    verifyReason: "Diameter varies by brake package — measure before ordering." },
  { key: "rotor_rear",        label: "Rear Rotors",       baseConfidence: "verify",
    verifyReason: "Drum vs disc varies by trim." },
  { key: "alternator",        label: "Alternator",        baseConfidence: "verify",
    verifyReason: "Amperage varies by HD electrical package and accessories." },
  { key: "starter",           label: "Starter",           baseConfidence: "verify",
    verifyReason: "Torque rating differs across engine variants." },
  { key: "suspension_strut",  label: "Suspension Strut",  baseConfidence: "verify",
    verifyReason: "Sport/tow/HD packages use different springs and struts." },
  { key: "tie_rod",           label: "Tie Rod",           baseConfidence: "verify",
    verifyReason: "Inner vs outer; verify before ordering." },
  { key: "tires",             label: "Tires",             baseConfidence: "verify",
    verifyReason: "Confirm OEM size on door-jamb sticker; many vehicles run plus-sized aftermarket fitments." },
];

const CATEGORY_BY_KEY = new Map(PARTS_CATEGORIES.map((c) => [c.key, c]));

export function getCategoryMeta(key: string): CategoryMeta | null {
  return CATEGORY_BY_KEY.get(key) ?? null;
}

export interface CompatibilityRecommendation {
  category: string;
  label: string;
  confidence: Confidence;
  /**
   * Plain-English reason the confidence is what it is. Always populated —
   * mechanics need to know WHY before they trust the engine.
   */
  rationale: string;
  /** Suggested part number from prior APS history, if any. */
  suggestedPartNumber?: string;
  suggestedBrand?: string;
  suggestedSupplier?: string;
  /** Last-installed metadata (for the "previously installed" badge). */
  lastInstall?: {
    partNumber: string | null;
    brand: string | null;
    supplier: string | null;
    installedAt: string;
    installMileage: number | null;
    mechanicId: number;
    photoUrl: string | null;
  };
  /** Most recent override note for this category, if a mechanic has ever overridden. */
  lastOverride?: {
    reason: string;
    recommendedPartNumber?: string;
    recommendedBrand?: string;
    overriddenAt: string;
  };
  /** Verification steps the engine wants the mechanic to perform before ordering. */
  verifySteps: string[];
}

const VERIFY_STEPS_BY_KEY: Record<string, string[]> = {
  brake_pads_front: ["Measure pad thickness", "Identify caliper bracket bolt size", "Confirm rotor diameter"],
  brake_pads_rear:  ["Confirm disc vs drum", "Measure pad thickness if disc"],
  rotor_front:      ["Measure rotor diameter and thickness", "Confirm vented vs solid"],
  rotor_rear:       ["Confirm disc vs drum", "Measure if disc"],
  alternator:       ["Read amperage rating off existing unit", "Confirm pulley count and serpentine routing"],
  starter:          ["Confirm tooth count", "Confirm mounting bolt pattern"],
  suspension_strut: ["Confirm trim/package", "Measure spring free length"],
  tie_rod:          ["Confirm inner vs outer", "Measure thread length"],
  tires:            ["Read OEM size from door-jamb sticker", "Confirm load and speed rating"],
  battery:          ["Confirm group size from existing battery", "Confirm CCA requirement"],
};

/**
 * Compute a confidence recommendation for a (vehicle, category) pair, blending
 * the static category metadata with the installed-parts history APS has on
 * file. Returns null if the category key is unknown.
 */
export async function computeCompatibility(
  vehicleId: number,
  categoryKey: string,
): Promise<CompatibilityRecommendation | null> {
  const meta = getCategoryMeta(categoryKey);
  if (!meta) return null;

  // Pull the most recent install across history for this category — active
  // OR removed. If we only looked at active rows we'd miss the institutional
  // memory of "this exact OEM part fit two visits ago, then was replaced
  // with an aftermarket the customer regretted" — historical fitment data
  // is exactly the layer that makes APS smarter than a raw VIN decode.
  const recent = await db.select().from(installedPartsTable).where(
    and(
      eq(installedPartsTable.vehicleId, vehicleId),
      eq(installedPartsTable.category, categoryKey),
    ),
  ).orderBy(desc(installedPartsTable.installedAt)).limit(20);

  const lastActive = recent.find((r) => r.removedAt === null);
  // Best historical install for "we have done this before" promotion: prefer
  // the active row, fall back to the most recent removed row.
  const lastAny = lastActive ?? recent[0];
  // Most recent override across full history (find, don't take the head).
  const lastOverrideRow = recent.find((r) => r.overrideRecommendation !== null);

  let confidence = meta.baseConfidence;
  let rationale = meta.baseConfidence === "high"
    ? "High-confidence category — VIN data is reliable for this part."
    : meta.baseConfidence === "medium"
      ? `Medium confidence — ${meta.verifyReason ?? "consider quick verification."}`
      : `Verification recommended — ${meta.verifyReason ?? "varies by trim/package."}`;

  // History promotion: if APS has installed something in this category on
  // this vehicle before (active OR removed), we know SOMETHING fit. Active
  // bumps to full "high"; historical-only bumps verify→medium so the
  // mechanic still verifies but starts with a strong baseline.
  if (lastActive && lastActive.partNumber) {
    confidence = "high";
    rationale = `APS installed this exact part on this vehicle on ${lastActive.installedAt.toISOString().slice(0, 10)} — known fit.`;
  } else if (lastAny && lastAny.partNumber && meta.baseConfidence === "verify") {
    confidence = "medium";
    rationale = `APS has prior install history (${lastAny.installedAt.toISOString().slice(0, 10)}) for this category on this vehicle — promotes confidence, but verify the spec hasn't changed.`;
  }

  const result: CompatibilityRecommendation = {
    category: meta.key,
    label: meta.label,
    confidence,
    rationale,
    verifySteps: confidence === "high" ? [] : (VERIFY_STEPS_BY_KEY[categoryKey] ?? []),
  };

  const surface = lastActive ?? lastAny;
  if (surface) {
    result.suggestedPartNumber = surface.partNumber ?? undefined;
    result.suggestedBrand = surface.brand ?? undefined;
    result.suggestedSupplier = surface.supplier ?? undefined;
    result.lastInstall = {
      partNumber: surface.partNumber,
      brand: surface.brand,
      supplier: surface.supplier,
      installedAt: surface.installedAt.toISOString(),
      installMileage: surface.installMileage,
      mechanicId: surface.mechanicId,
      photoUrl: surface.photoUrl,
    };
  }

  if (lastOverrideRow && lastOverrideRow.overrideRecommendation) {
    result.lastOverride = {
      reason: lastOverrideRow.overrideRecommendation.reason,
      recommendedPartNumber: lastOverrideRow.overrideRecommendation.recommendedPartNumber,
      recommendedBrand: lastOverrideRow.overrideRecommendation.recommendedBrand,
      overriddenAt: lastOverrideRow.installedAt.toISOString(),
    };
  }

  return result;
}
