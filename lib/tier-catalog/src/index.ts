/**
 * APS Mechanic Tier System — single source of truth.
 *
 * Both the API server and the mobile app import this module. Commission
 * percentages, tier ordering, the full service catalog, FLAT-RATE PRICING,
 * and the European-vehicle premium MUST live here so quotes, earnings,
 * payouts, and admin views never drift.
 *
 * Internal tier keys (preserved for backward DB compatibility):
 *   detailer    → Tier 1 (Detailer)
 *   technician  → Tier 2 (Basic Mechanic)
 *   senior      → Tier 3 (Intermediate Mechanic)
 *   advanced    → Tier 4 (Advanced Mechanic)
 *   master      → Tier 5 (Master Mechanic)
 */

export type TierKey = "detailer" | "technician" | "senior" | "advanced" | "master";

export type ServiceCategory = "repair" | "diagnostic" | "maintenance" | "detailing";

export interface TierDef {
  key: TierKey;
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  blurb: string;
}

export const TIERS: readonly TierDef[] = [
  { key: "detailer",   level: 1, label: "Detailer",              blurb: "Cosmetic & exterior care, light maintenance." },
  { key: "technician", level: 2, label: "Basic Mechanic",        blurb: "Routine maintenance, brakes, fluids, electrical basics." },
  { key: "senior",     level: 3, label: "Intermediate Mechanic", blurb: "Steering, suspension, drivetrain, cooling, fuel system." },
  { key: "advanced",   level: 4, label: "Advanced Mechanic",     blurb: "Major brake, electrical, AC, engine timing & advanced diagnostics." },
  { key: "master",     level: 5, label: "Master Mechanic",       blurb: "EV/hybrid, ADAS, engine/transmission rebuilds, performance." },
] as const;

const TIER_BY_KEY = new Map(TIERS.map((t) => [t.key, t]));

export function tierLevel(key: TierKey): number {
  const t = TIER_BY_KEY.get(key);
  return t ? t.level : 0;
}

export function tierLabel(key: TierKey): string {
  return TIER_BY_KEY.get(key)?.label ?? key;
}

/** Mechanic of `mechanicTier` is qualified to perform a job requiring `jobTier`. */
export function mechanicQualifiedFor(mechanicTier: TierKey, jobTier: TierKey): boolean {
  return tierLevel(mechanicTier) >= tierLevel(jobTier);
}

/** True iff `mechanicTier` strictly outranks `jobTier` (i.e. accepting it is a "work down"). */
export function isWorkingDown(mechanicTier: TierKey, jobTier: TierKey): boolean {
  return tierLevel(mechanicTier) > tierLevel(jobTier);
}

/* -------------------------------------------------------------------------- */
/* SERVICE CATALOG                                                            */
/* -------------------------------------------------------------------------- */

export interface ServiceDef {
  /** Stable machine slug stored on the job row. */
  slug: string;
  /** Human-readable label shown to customer + mechanic. */
  name: string;
  /** Required tier — minimum tier a mechanic must have to accept this job. */
  tier: TierKey;
  /** Maps to the legacy `jobs.job_type` enum. */
  category: ServiceCategory;
  /**
   * Domestic (non-European) flat-rate price the customer pays — labor +
   * typical parts included. WHOLE DOLLARS. Both bounds inclusive.
   *
   * If undefined, the service is not currently quotable through the customer
   * request flow (mechanics may still log work for it via /worklogs).
   */
  priceMin?: number;
  priceMax?: number;
  /**
   * Estimated share of the booked total that is true *parts cost* (not
   * markup). Drives the "True Net Profit" commission split — APS commission
   * applies to (bookedTotal − partsCost), and the mechanic gets the parts
   * cost back at 100%.
   *
   * If omitted, falls back to the per-category default in
   * `defaultPartsCostPct(category)`. Range: 0..1.
   */
  partsCostPct?: number;
}

export const JOB_CATALOG: readonly ServiceDef[] = [
  // ── TIER 1 — DETAILER ────────────────────────────────────────────────────
  { slug: "interior_exterior_wash",       name: "Basic Exterior Wash & Vacuum",         tier: "detailer", category: "detailing",   priceMin: 89,   priceMax: 129 },
  { slug: "full_interior_detailing",      name: "Full Interior Detail",                 tier: "detailer", category: "detailing",   priceMin: 229,  priceMax: 299 },
  { slug: "full_exterior_detailing",      name: "Full Exterior Detail",                 tier: "detailer", category: "detailing",   priceMin: 199,  priceMax: 269 },
  { slug: "complete_detail",              name: "Complete Interior + Exterior Detail",  tier: "detailer", category: "detailing",   priceMin: 349,  priceMax: 449 },
  { slug: "headlight_restoration",        name: "Headlight Restoration (Pair)",         tier: "detailer", category: "detailing",   priceMin: 129,  priceMax: 179 },
  { slug: "tail_light_restoration",       name: "Tail Light Restoration (Pair)",        tier: "detailer", category: "detailing",   priceMin: 99,   priceMax: 139 },
  { slug: "ceramic_coating",              name: "Ceramic Coating (Basic)",              tier: "detailer", category: "detailing",   priceMin: 649,  priceMax: 899 },
  { slug: "ceramic_coating_premium",      name: "Premium Ceramic Coating",              tier: "detailer", category: "detailing",   priceMin: 999,  priceMax: 1499 },
  { slug: "engine_bay_detail",            name: "Engine Bay Detail",                    tier: "detailer", category: "detailing",   priceMin: 99,   priceMax: 149 },
  { slug: "tire_shine_wheel_cleaning",    name: "Wheel & Tire Detail Package",          tier: "detailer", category: "detailing",   priceMin: 79,   priceMax: 119 },
  { slug: "interior_shampoo",             name: "Interior Shampoo & Conditioning",      tier: "detailer", category: "detailing",   priceMin: 149,  priceMax: 219 },
  { slug: "clay_bar_treatment",           name: "Clay Bar Treatment",                   tier: "detailer", category: "detailing",   priceMin: 99,   priceMax: 149 },
  { slug: "bug_tar_removal",              name: "Bug & Tar Removal",                    tier: "detailer", category: "detailing",   priceMin: 69,   priceMax: 99 },
  { slug: "wiper_blade_replacement",      name: "Wiper Blade Replacement",              tier: "detailer", category: "maintenance", priceMin: 39,   priceMax: 59 },
  // — Detailer-tier services kept in catalog for legacy/internal use (no public price yet)
  { slug: "waxing_paint_sealant",         name: "Waxing / Paint Sealant",               tier: "detailer", category: "detailing" },
  { slug: "tire_plug_patch",              name: "Tire Plug / Patch Repair",             tier: "detailer", category: "repair" },
  { slug: "minor_paint_touch_up",         name: "Minor Paint Touch-Up",                 tier: "detailer", category: "detailing" },

  // ── TIER 2 — BASIC MECHANIC ──────────────────────────────────────────────
  { slug: "oil_change",                   name: "Conventional Oil Change",              tier: "technician", category: "maintenance", priceMin: 129, priceMax: 159 },
  { slug: "oil_change_synthetic",         name: "Full Synthetic Oil Change",            tier: "technician", category: "maintenance", priceMin: 159, priceMax: 199 },
  { slug: "brake_pad_replacement",        name: "Front Brake Pads",                     tier: "technician", category: "repair",      priceMin: 349, priceMax: 449 },
  { slug: "brake_pad_replacement_rear",   name: "Rear Brake Pads",                      tier: "technician", category: "repair",      priceMin: 329, priceMax: 429 },
  { slug: "front_brakes_pads_rotors",     name: "Front Brakes (Pads + Rotors)",         tier: "technician", category: "repair",      priceMin: 549, priceMax: 679 },
  { slug: "rear_brakes_pads_rotors",      name: "Rear Brakes (Pads + Rotors)",          tier: "technician", category: "repair",      priceMin: 499, priceMax: 629 },
  { slug: "battery_test_replacement",     name: "Battery Replacement",                  tier: "technician", category: "repair",      priceMin: 229, priceMax: 299 },
  { slug: "tire_rotation_balance",        name: "Tire Rotation + Balance (4 tires)",    tier: "technician", category: "maintenance", priceMin: 119, priceMax: 159 },
  { slug: "spark_plug_replacement",       name: "Spark Plug Replacement (Full Set)",    tier: "technician", category: "maintenance", priceMin: 199, priceMax: 279 },
  { slug: "air_filter_replacement",       name: "Air Filter Replacement",               tier: "technician", category: "maintenance", priceMin: 69,  priceMax: 99 },
  { slug: "cabin_air_filter_replacement", name: "Cabin Air Filter Replacement",         tier: "technician", category: "maintenance", priceMin: 79,  priceMax: 109 },
  { slug: "coolant_flush",                name: "Coolant Flush",                        tier: "technician", category: "maintenance", priceMin: 149, priceMax: 189 },
  { slug: "brake_fluid_flush",            name: "Brake Fluid Flush",                    tier: "technician", category: "maintenance", priceMin: 139, priceMax: 179 },
  { slug: "transmission_fluid_flush_basic", name: "Transmission Fluid Flush (Basic)",   tier: "technician", category: "maintenance", priceMin: 179, priceMax: 229 },
  // — Tier-2 services without listed public price (kept for internal/work-log use)
  { slug: "basic_diagnostic_scan",        name: "Basic Diagnostic Scan + Code Reading", tier: "technician", category: "diagnostic" },
  { slug: "horn_replacement",             name: "Horn Replacement",                     tier: "technician", category: "repair" },
  { slug: "washer_fluid_system_repair",   name: "Windshield Washer Fluid System Repair", tier: "technician", category: "repair" },

  // ── TIER 3 — INTERMEDIATE MECHANIC ───────────────────────────────────────
  { slug: "starter_replacement",          name: "Starter Replacement",                  tier: "senior", category: "repair", priceMin: 399, priceMax: 499 },
  { slug: "alternator_replacement",       name: "Alternator Replacement",               tier: "senior", category: "repair", priceMin: 479, priceMax: 599 },
  { slug: "cv_axle_replacement",          name: "CV Axle Replacement (One Side)",       tier: "senior", category: "repair", priceMin: 349, priceMax: 449 },
  { slug: "front_strut_shock_replacement", name: "Front Strut Replacement (Pair)",      tier: "senior", category: "repair", priceMin: 599, priceMax: 749 },
  { slug: "rear_shock_replacement",       name: "Rear Shock Replacement (Pair)",        tier: "senior", category: "repair", priceMin: 349, priceMax: 449 },
  { slug: "control_arm_replacement",      name: "Control Arm Replacement (One Side)",   tier: "senior", category: "repair", priceMin: 349, priceMax: 449 },
  { slug: "power_steering_pump_replacement", name: "Power Steering Pump",               tier: "senior", category: "repair", priceMin: 399, priceMax: 499 },
  { slug: "radiator_replacement",         name: "Radiator Replacement",                 tier: "senior", category: "repair", priceMin: 479, priceMax: 599 },
  { slug: "water_pump_replacement",       name: "Water Pump Replacement",               tier: "senior", category: "repair", priceMin: 449, priceMax: 569 },
  { slug: "thermostat_replacement",       name: "Thermostat Replacement",               tier: "senior", category: "repair", priceMin: 229, priceMax: 299 },
  { slug: "exhaust_muffler_repair",       name: "Muffler Replacement",                  tier: "senior", category: "repair", priceMin: 349, priceMax: 479 },
  { slug: "fuel_pump_replacement",        name: "Fuel Pump Replacement",                tier: "senior", category: "repair", priceMin: 449, priceMax: 579 },
  { slug: "serpentine_belt_replacement",  name: "Serpentine Belt Replacement",          tier: "senior", category: "repair", priceMin: 179, priceMax: 249 },
  // — Tier-3 service without listed public price
  { slug: "ball_joint_replacement",       name: "Ball Joint Replacement",               tier: "senior", category: "repair" },
  { slug: "sway_bar_link_replacement",    name: "Sway Bar Link Replacement",            tier: "senior", category: "repair" },
  { slug: "idler_tensioner_pulley",       name: "Idler / Tensioner Pulley Replacement", tier: "senior", category: "repair" },
  { slug: "full_brake_job",               name: "Full Front Brake Job (Pads + Rotors + Calipers)", tier: "senior", category: "repair",      priceMin: 799, priceMax: 999 },
  { slug: "full_brake_job_rear",          name: "Full Rear Brake Job (Pads + Rotors + Calipers)",  tier: "senior", category: "repair",      priceMin: 749, priceMax: 949 },

  // ── TIER 4 — ADVANCED MECHANIC ───────────────────────────────────────────
  { slug: "steering_rack_replacement",    name: "Steering Rack Replacement",            tier: "advanced", category: "repair",      priceMin: 899, priceMax: 1199 },
  { slug: "timing_belt_chain_service",    name: "Timing Belt Service (incl. Water Pump)", tier: "advanced", category: "repair",    priceMin: 899, priceMax: 1299 },
  { slug: "ac_compressor_replacement",    name: "AC Compressor Replacement",            tier: "advanced", category: "repair",      priceMin: 679, priceMax: 899 },
  { slug: "fuel_injector_replacement",    name: "Fuel Injector Replacement (Set of 4)", tier: "advanced", category: "repair",      priceMin: 549, priceMax: 749 },
  { slug: "transmission_fluid_filter",    name: "Transmission Fluid + Filter + Pan Service", tier: "advanced", category: "maintenance", priceMin: 349, priceMax: 449 },
  { slug: "engine_mount_replacement",     name: "Engine Mount Replacement (Set)",       tier: "advanced", category: "repair",      priceMin: 429, priceMax: 579 },
  { slug: "abs_system_repair",            name: "ABS Module Repair",                    tier: "advanced", category: "repair",      priceMin: 449, priceMax: 599 },
  // — Tier-4 services without listed public price
  { slug: "major_suspension_overhaul",    name: "Major Suspension Overhaul",            tier: "advanced", category: "repair" },
  { slug: "airbag_srs_diagnostics",       name: "Airbag / SRS System Diagnostics",      tier: "advanced", category: "diagnostic" },
  { slug: "drivability_diagnostics",      name: "In-depth Drivability Diagnostics",     tier: "advanced", category: "diagnostic" },

  // ── TIER 5 — MASTER MECHANIC ─────────────────────────────────────────────
  { slug: "ev_high_voltage_service",      name: "Hybrid/EV High Voltage Diagnostic & Service",     tier: "master", category: "repair",      priceMin: 599,  priceMax: 999 },
  { slug: "adas_calibration",             name: "ADAS Calibration (Full System)",                  tier: "master", category: "diagnostic",  priceMin: 499,  priceMax: 799 },
  { slug: "engine_replacement_repair",    name: "Major Engine Repair / Rebuild Labor",             tier: "master", category: "repair",      priceMin: 1999, priceMax: 3499 },
  { slug: "transmission_rebuild",         name: "Transmission Replacement",                        tier: "master", category: "repair",      priceMin: 2499, priceMax: 3999 },
  { slug: "turbocharger_replacement",     name: "Turbocharger Replacement",                        tier: "master", category: "repair",      priceMin: 999,  priceMax: 1499 },
  { slug: "differential_repair",          name: "Differential Repair / Rebuild",                   tier: "master", category: "repair",      priceMin: 849,  priceMax: 1299 },
  { slug: "air_suspension_repair",        name: "Air Suspension System Repair",                    tier: "master", category: "repair",      priceMin: 799,  priceMax: 1299 },
  { slug: "advanced_electrical_repair",   name: "Complex Electrical System Diagnostics & Repair",  tier: "master", category: "diagnostic",  priceMin: 399,  priceMax: 699 },
  { slug: "module_programming_flashing",  name: "Module Programming & Flashing",                   tier: "master", category: "repair",      priceMin: 299,  priceMax: 499 },
  // — Tier-5 services without listed public price
  { slug: "ev_battery_service",           name: "EV Battery Diagnostics & Service",                tier: "master", category: "diagnostic" },
  { slug: "computer_network_diagnostics", name: "Comprehensive Computer & Network Diagnostics",    tier: "master", category: "diagnostic" },
  { slug: "performance_tuning",           name: "Custom Performance Tuning",                       tier: "master", category: "repair" },
  { slug: "fleet_heavy_duty_repair",      name: "Heavy-Duty / Fleet Vehicle Repairs",              tier: "master", category: "repair" },
] as const;

const SERVICE_BY_SLUG = new Map(JOB_CATALOG.map((s) => [s.slug, s]));
export function findServiceBySlug(slug: string | null | undefined): ServiceDef | null {
  if (!slug) return null;
  return SERVICE_BY_SLUG.get(slug) ?? null;
}

export function servicesForTier(tier: TierKey): ServiceDef[] {
  return JOB_CATALOG.filter((s) => s.tier === tier);
}

/** All services a mechanic of `tier` may pick up (their tier + everything below). */
export function servicesQualifiedFor(tier: TierKey): ServiceDef[] {
  const max = tierLevel(tier);
  return JOB_CATALOG.filter((s) => tierLevel(s.tier) <= max);
}

/** Services that have a published flat-rate price (i.e. customer-bookable). */
export function pricedServices(): ServiceDef[] {
  return JOB_CATALOG.filter(isPricedService);
}

export function isPricedService(s: ServiceDef): s is ServiceDef & { priceMin: number; priceMax: number } {
  return typeof s.priceMin === "number" && typeof s.priceMax === "number";
}

/* -------------------------------------------------------------------------- */
/* PARTS COST / TRUE NET PROFIT                                               */
/* -------------------------------------------------------------------------- */

/**
 * Per-category default for the share of the booked total that is true parts
 * cost (cost to the mechanic, NOT markup). Used when a service doesn't
 * declare its own `partsCostPct`. Tuned for typical APS service mix:
 *   - detailing: chemicals & supplies are negligible against labor → 0
 *   - diagnostic: scanner labor only, no parts → 0
 *   - maintenance: filters/fluids ≈ 30% of total
 *   - repair: replacement parts ≈ 40% of total
 *
 * APS commission applies to revenue MINUS this cost (True Net Profit), so
 * tighter numbers here = larger mechanic take. These are intentionally
 * conservative (favoring the mechanic) until per-service overrides are
 * tuned in `JOB_CATALOG`.
 */
export function defaultPartsCostPct(category: ServiceCategory): number {
  switch (category) {
    case "detailing":   return 0;
    case "diagnostic":  return 0;
    case "maintenance": return 0.30;
    case "repair":      return 0.40;
  }
}

/** Resolved parts-cost share for a service (per-service override → category default). */
export function partsCostPctFor(svc: ServiceDef): number {
  return typeof svc.partsCostPct === "number"
    ? Math.max(0, Math.min(1, svc.partsCostPct))
    : defaultPartsCostPct(svc.category);
}

/** Parts cost in CENTS for a job — clamped to [0, amountCents]. */
export function partsCostCentsFor(svc: ServiceDef, amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  const cost = Math.round(amountCents * partsCostPctFor(svc));
  return Math.max(0, Math.min(amountCents, cost));
}

/* -------------------------------------------------------------------------- */
/* EUROPEAN-VEHICLE PREMIUM                                                   */
/* -------------------------------------------------------------------------- */

/**
 * European-built vehicles get a +25%..+35% premium on the base flat rate to
 * cover higher part costs and complexity. The MIDPOINT (30%) is what we
 * actually charge — the min/max are surfaced in the customer's quote as the
 * range so the higher end is never a surprise.
 */
export const EUROPEAN_PREMIUM = {
  minPct: 25,
  maxPct: 35,
  /** What the server actually applies when stamping the booked price. */
  appliedPct: 30,
} as const;

/**
 * VIN World Manufacturer Identifier (WMI) prefixes for European-built
 * vehicles. We match on the FIRST CHARACTER for region (W=Germany, Z=Italy,
 * V=France, S/X=UK, Y=Sweden/Finland, T=Switzerland/Czech, U=Romania) plus
 * a small allowlist of multi-char prefixes for marques whose first letter
 * overlaps with non-European regions.
 *
 * Single-letter region prefixes are checked AFTER the explicit allowlist so
 * a Volvo built in the US ("YV1" but starting with the US-assembled "1...")
 * is correctly classified by the underlying WMI, not the marque.
 */
const EUROPEAN_WMI_FIRST_CHAR = new Set([
  "W", // Germany (BMW, Mercedes, VW, Audi, Porsche, Smart, Mini)
  "Z", // Italy   (Fiat, Alfa Romeo, Lamborghini, Ferrari, Maserati)
  "V", // France / Spain / Austria
  "S", // United Kingdom (Aston Martin, Bentley, Rolls-Royce, McLaren, Jaguar, Land Rover, MG)
  "X", // Russia / former USSR / some UK
  "Y", // Sweden / Finland / Belgium / Netherlands (Volvo, Saab)
  "T", // Switzerland / Czech / Hungary (Skoda)
  "U", // Romania (Dacia)
]);

/**
 * Marque-name fallback when we don't have a VIN. The server will prefer VIN
 * detection — this is a safety net for legacy vehicles created before VIN
 * decode was mandatory.
 */
const EUROPEAN_MAKES = new Set([
  "bmw", "mercedes", "mercedes-benz", "audi", "volkswagen", "vw", "porsche", "mini",
  "smart", "volvo", "saab", "jaguar", "land rover", "land-rover", "range rover",
  "rolls-royce", "rolls royce", "bentley", "aston martin", "mclaren", "lotus",
  "fiat", "alfa romeo", "alfa-romeo", "ferrari", "lamborghini", "maserati",
  "peugeot", "renault", "citroen", "citroën", "skoda", "seat", "dacia", "opel", "vauxhall",
]);

/**
 * Returns true if the VIN's WMI indicates a European-built vehicle. VINs
 * shorter than 3 chars or non-string inputs return false.
 */
export function isEuropeanVin(vin: string | null | undefined): boolean {
  if (!vin || typeof vin !== "string") return false;
  const v = vin.trim().toUpperCase();
  if (v.length < 3) return false;
  return EUROPEAN_WMI_FIRST_CHAR.has(v[0]!);
}

/** Marque-name fallback for vehicles without a usable VIN. */
export function isEuropeanMake(make: string | null | undefined): boolean {
  if (!make) return false;
  return EUROPEAN_MAKES.has(make.trim().toLowerCase());
}

/** True if EITHER the VIN or the make indicates a European vehicle. */
export function isEuropeanVehicle(input: { vin?: string | null; make?: string | null }): boolean {
  return isEuropeanVin(input.vin) || isEuropeanMake(input.make);
}

/* -------------------------------------------------------------------------- */
/* QUOTING                                                                    */
/* -------------------------------------------------------------------------- */

export interface ServiceQuote {
  slug: string;
  name: string;
  tier: TierKey;
  category: ServiceCategory;
  /** Domestic base price range (whole dollars). */
  baseMin: number;
  baseMax: number;
  /** True if the European premium was applied. */
  isEuropean: boolean;
  /** Premium percentages surfaced in the customer-facing range. */
  premiumMinPct: number;
  premiumMaxPct: number;
  /** Single applied premium percentage (used for the booked total). */
  appliedPremiumPct: number;
  /** Final customer-facing price range (whole dollars, premium applied if European). */
  finalMin: number;
  finalMax: number;
  /** The single "booked" total the server stamps on the job — uses the base
   *  midpoint × (1 + applied premium). Whole dollars. */
  bookedTotal: number;
  /** Estimated true parts cost in WHOLE DOLLARS — passes through 100% to
   *  the mechanic at capture; not subject to commission. */
  partsCostEstimate: number;
  /** True Net Profit estimate in WHOLE DOLLARS — `bookedTotal − partsCostEstimate`.
   *  This is what the commission percentage applies against. */
  netProfitEstimate: number;
}

/** Quote a service, optionally applying the European premium. */
export function quoteForService(
  slugOrService: string | ServiceDef,
  opts: { isEuropean?: boolean } = {},
): ServiceQuote | null {
  const svc = typeof slugOrService === "string" ? findServiceBySlug(slugOrService) : slugOrService;
  if (!svc || !isPricedService(svc)) return null;
  const isEuropean = opts.isEuropean === true;
  const baseMin = svc.priceMin;
  const baseMax = svc.priceMax;
  const premiumMinPct = isEuropean ? EUROPEAN_PREMIUM.minPct : 0;
  const premiumMaxPct = isEuropean ? EUROPEAN_PREMIUM.maxPct : 0;
  const appliedPremiumPct = isEuropean ? EUROPEAN_PREMIUM.appliedPct : 0;
  const finalMin = Math.round(baseMin * (1 + premiumMinPct / 100));
  const finalMax = Math.round(baseMax * (1 + premiumMaxPct / 100));
  const baseMid = (baseMin + baseMax) / 2;
  const bookedTotal = Math.round(baseMid * (1 + appliedPremiumPct / 100));
  const partsCostEstimate = Math.round(bookedTotal * partsCostPctFor(svc));
  const netProfitEstimate = Math.max(0, bookedTotal - partsCostEstimate);
  return {
    slug: svc.slug, name: svc.name, tier: svc.tier, category: svc.category,
    baseMin, baseMax, isEuropean,
    premiumMinPct, premiumMaxPct, appliedPremiumPct,
    finalMin, finalMax, bookedTotal,
    partsCostEstimate, netProfitEstimate,
  };
}

/* -------------------------------------------------------------------------- */
/* COMMISSION ENGINE                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Commission rules — these percentages drive Stripe `application_fee_amount`,
 * the customer-facing quote breakdown, the mechanic earnings calculator, and
 * admin payout reports. **Do NOT inline these numbers anywhere else.**
 */
export const COMMISSION = {
  /** Default split when mechanic accepts a job at their own tier. */
  normal:      { platformPct: 20, mechanicPct: 80 },
  /** Lower split when mechanic accepts a job at a strictly lower tier. */
  workingDown: { platformPct: 25, mechanicPct: 75 },
  /** Detailing services always get the highest mechanic share. */
  detailing:   { platformPct: 15, mechanicPct: 85 },
} as const;

export type CommissionReason = "detailing" | "normal" | "working_down";

export interface CommissionResult {
  platformPct: number;        // integer 0..100
  mechanicPct: number;        // integer 0..100
  platformRate: number;       // 0..1 — what `application_fee_amount` is computed against
  mechanicRate: number;       // 0..1
  reason: CommissionReason;
  reasonLabel: string;        // human-readable, surfaced on quotes + earnings
}

/**
 * Commission for a job. `jobTier` is the catalog-required tier of the service;
 * `mechanicTier` is who's actually doing it. `category` is needed because
 * detailing always wins (15/85) regardless of who performs it.
 */
export function commissionForJob(input: {
  category: ServiceCategory;
  jobTier: TierKey;
  mechanicTier: TierKey;
}): CommissionResult {
  const { category, jobTier, mechanicTier } = input;
  if (category === "detailing") {
    return makeResult(COMMISSION.detailing, "detailing", "Detailing service — flat 15% platform fee.");
  }
  if (isWorkingDown(mechanicTier, jobTier)) {
    return makeResult(
      COMMISSION.workingDown, "working_down",
      `Working down — accepted a ${tierLabel(jobTier)} job as ${tierLabel(mechanicTier)}.`,
    );
  }
  return makeResult(COMMISSION.normal, "normal", `${tierLabel(jobTier)} job at your tier.`);
}

function makeResult(rule: { platformPct: number; mechanicPct: number }, reason: CommissionReason, reasonLabel: string): CommissionResult {
  return {
    platformPct: rule.platformPct,
    mechanicPct: rule.mechanicPct,
    platformRate: rule.platformPct / 100,
    mechanicRate: rule.mechanicPct / 100,
    reason,
    reasonLabel,
  };
}

/**
 * LEGACY — splits the FULL amount by the commission rate. Retained for
 * tip pass-through (where rate.platformRate=0 → 100% to mechanic) and any
 * caller that has no parts-cost context. New code should use
 * `splitOnNetProfit` so commission applies to (revenue − parts cost) per
 * the True Net Profit policy.
 */
export function splitCents(amountCents: number, rate: CommissionResult): { platformFeeCents: number; mechanicPayoutCents: number } {
  const platformFeeCents = Math.round(amountCents * rate.platformRate);
  const mechanicPayoutCents = amountCents - platformFeeCents;
  return { platformFeeCents, mechanicPayoutCents };
}

/**
 * "True Net Profit" split — APS commission applies ONLY to
 * `(amountCents − partsCostCents)`. The mechanic receives the full parts-cost
 * passthrough plus their share of the net profit.
 *
 * Rounding favors the mechanic: the platform fee is rounded, then mechanic
 * payout = total − fee. Clamps `partsCostCents` to [0, amountCents] so a
 * mis-stamped parts cost can never push the platform fee negative.
 */
export function splitOnNetProfit(
  amountCents: number,
  partsCostCents: number,
  rate: CommissionResult,
): { platformFeeCents: number; mechanicPayoutCents: number; partsPassthroughCents: number; netProfitCents: number } {
  const safeAmount = Math.max(0, Math.round(amountCents));
  const safeParts = Math.max(0, Math.min(safeAmount, Math.round(partsCostCents)));
  const netProfitCents = safeAmount - safeParts;
  const platformFeeCents = Math.round(netProfitCents * rate.platformRate);
  const mechanicPayoutCents = safeAmount - platformFeeCents;
  return {
    platformFeeCents,
    mechanicPayoutCents,
    partsPassthroughCents: safeParts,
    netProfitCents,
  };
}
