/**
 * Canonical category keys for both review directions. Kept in code (not the
 * DB) so we can ship category changes without migrations. Adding a new
 * category is safe — old reviews simply have no value for it.
 */

export const CUSTOMER_TO_MECHANIC_CATEGORIES = [
  "professionalism",
  "communication",
  "punctuality",
  "cleanliness",
  "workmanship",
  "efficiency",
  "honesty",
  "vehicleCare",
] as const;

export const MECHANIC_TO_CUSTOMER_CATEGORIES = [
  "communication",
  "punctuality",
  "safety",
  "professionalism",
  "paymentReliability",
  "accuracyOfDescription",
  "vehicleAccessibility",
  "cooperation",
] as const;

export type CustomerToMechanicCategory = typeof CUSTOMER_TO_MECHANIC_CATEGORIES[number];
export type MechanicToCustomerCategory = typeof MECHANIC_TO_CUSTOMER_CATEGORIES[number];

export function categoriesFor(authorRole: "customer" | "mechanic"): readonly string[] {
  return authorRole === "customer"
    ? CUSTOMER_TO_MECHANIC_CATEGORIES
    : MECHANIC_TO_CUSTOMER_CATEGORIES;
}

/**
 * Validate a categories blob: every value must be 1..5 and every key must be
 * known for the author's direction. Unknown keys are rejected so the client
 * can't silently inject garbage that never gets averaged.
 */
export function validateCategories(
  authorRole: "customer" | "mechanic",
  raw: unknown,
): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "categories must be an object" };
  }
  const allowed = new Set<string>(categoriesFor(authorRole));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k)) return { ok: false, error: `Unknown category: ${k}` };
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      return { ok: false, error: `Category ${k} must be an integer 1..5` };
    }
    out[k] = v;
  }
  return { ok: true, value: out };
}
