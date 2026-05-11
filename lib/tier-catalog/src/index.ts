/**
 * APS Mechanic Tier System — single source of truth.
 *
 * Both the API server and the mobile app import this module. Commission
 * percentages, tier ordering, and the full service catalog MUST live here so
 * quotes, earnings, payouts, and admin views never drift.
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
}

export const JOB_CATALOG: readonly ServiceDef[] = [
  // ── TIER 1 — DETAILER ────────────────────────────────────────────────────
  { slug: "full_interior_detailing",      name: "Full Interior Detailing",          tier: "detailer", category: "detailing" },
  { slug: "full_exterior_detailing",      name: "Full Exterior Detailing",          tier: "detailer", category: "detailing" },
  { slug: "interior_exterior_wash",       name: "Interior / Exterior Wash",         tier: "detailer", category: "detailing" },
  { slug: "waxing_paint_sealant",         name: "Waxing / Paint Sealant",           tier: "detailer", category: "detailing" },
  { slug: "headlight_restoration",        name: "Headlight Restoration",            tier: "detailer", category: "detailing" },
  { slug: "tail_light_restoration",       name: "Tail Light Restoration",           tier: "detailer", category: "detailing" },
  { slug: "ceramic_coating",              name: "Ceramic Coating Application",      tier: "detailer", category: "detailing" },
  { slug: "tire_shine_wheel_cleaning",    name: "Tire Shine & Wheel Cleaning",      tier: "detailer", category: "detailing" },
  { slug: "wiper_blade_replacement",      name: "Wiper Blade Replacement",          tier: "detailer", category: "maintenance" },
  { slug: "tire_plug_patch",              name: "Tire Plug / Patch Repair",         tier: "detailer", category: "repair" },
  { slug: "bug_tar_removal",              name: "Bug & Tar Removal",                tier: "detailer", category: "detailing" },
  { slug: "clay_bar_treatment",           name: "Clay Bar Treatment",               tier: "detailer", category: "detailing" },
  { slug: "minor_paint_touch_up",         name: "Minor Paint Touch-Up",             tier: "detailer", category: "detailing" },

  // ── TIER 2 — BASIC MECHANIC ──────────────────────────────────────────────
  { slug: "oil_change",                   name: "Oil Change + Filter",              tier: "technician", category: "maintenance" },
  { slug: "brake_pad_replacement",        name: "Brake Pad Replacement",            tier: "technician", category: "repair" },
  { slug: "brake_fluid_flush",            name: "Brake Fluid Flush",                tier: "technician", category: "maintenance" },
  { slug: "coolant_flush",                name: "Coolant Flush",                    tier: "technician", category: "maintenance" },
  { slug: "serpentine_belt_replacement",  name: "Serpentine Belt Replacement",      tier: "technician", category: "repair" },
  { slug: "air_filter_replacement",       name: "Air Filter Replacement",           tier: "technician", category: "maintenance" },
  { slug: "cabin_air_filter_replacement", name: "Cabin Air Filter Replacement",     tier: "technician", category: "maintenance" },
  { slug: "tire_rotation_balance",        name: "Tire Rotation + Balance",          tier: "technician", category: "maintenance" },
  { slug: "battery_test_replacement",     name: "Battery Testing & Replacement",    tier: "technician", category: "repair" },
  { slug: "spark_plug_replacement",       name: "Spark Plug Replacement",           tier: "technician", category: "maintenance" },
  { slug: "basic_diagnostic_scan",        name: "Basic Diagnostic Scan + Code Reading", tier: "technician", category: "diagnostic" },
  { slug: "horn_replacement",             name: "Horn Replacement",                 tier: "technician", category: "repair" },
  { slug: "washer_fluid_system_repair",   name: "Windshield Washer Fluid System Repair", tier: "technician", category: "repair" },

  // ── TIER 3 — INTERMEDIATE MECHANIC ───────────────────────────────────────
  { slug: "starter_replacement",          name: "Starter Replacement",              tier: "senior", category: "repair" },
  { slug: "alternator_replacement",       name: "Alternator Replacement",           tier: "senior", category: "repair" },
  { slug: "cv_axle_replacement",          name: "CV Axle Replacement",              tier: "senior", category: "repair" },
  { slug: "front_strut_shock_replacement", name: "Front Strut / Shock Replacement", tier: "senior", category: "repair" },
  { slug: "control_arm_replacement",      name: "Control Arm Replacement",          tier: "senior", category: "repair" },
  { slug: "ball_joint_replacement",       name: "Ball Joint Replacement",           tier: "senior", category: "repair" },
  { slug: "sway_bar_link_replacement",    name: "Sway Bar Link Replacement",        tier: "senior", category: "repair" },
  { slug: "power_steering_pump_replacement", name: "Power Steering Pump Replacement", tier: "senior", category: "repair" },
  { slug: "radiator_replacement",         name: "Radiator Replacement",             tier: "senior", category: "repair" },
  { slug: "water_pump_replacement",       name: "Water Pump Replacement",           tier: "senior", category: "repair" },
  { slug: "thermostat_replacement",       name: "Thermostat Replacement",           tier: "senior", category: "repair" },
  { slug: "exhaust_muffler_repair",       name: "Exhaust / Muffler Repair",         tier: "senior", category: "repair" },
  { slug: "fuel_pump_replacement",        name: "Fuel Pump Replacement (accessible)", tier: "senior", category: "repair" },
  { slug: "idler_tensioner_pulley",       name: "Idler / Tensioner Pulley Replacement", tier: "senior", category: "repair" },

  // ── TIER 4 — ADVANCED MECHANIC ───────────────────────────────────────────
  { slug: "full_brake_job",               name: "Full Brake Job (Pads + Rotors + Calipers)", tier: "advanced", category: "repair" },
  { slug: "steering_rack_replacement",    name: "Steering Rack Replacement",        tier: "advanced", category: "repair" },
  { slug: "major_suspension_overhaul",    name: "Major Suspension Overhaul",        tier: "advanced", category: "repair" },
  { slug: "transmission_fluid_filter",    name: "Transmission Fluid + Filter Service", tier: "advanced", category: "maintenance" },
  { slug: "advanced_electrical_repair",   name: "Advanced Electrical Diagnostics & Repair", tier: "advanced", category: "diagnostic" },
  { slug: "abs_system_repair",            name: "ABS System Repair",                tier: "advanced", category: "repair" },
  { slug: "airbag_srs_diagnostics",       name: "Airbag / SRS System Diagnostics",  tier: "advanced", category: "diagnostic" },
  { slug: "engine_mount_replacement",     name: "Engine Mount Replacement",         tier: "advanced", category: "repair" },
  { slug: "timing_belt_chain_service",    name: "Timing Belt / Timing Chain Service", tier: "advanced", category: "repair" },
  { slug: "ac_compressor_replacement",    name: "AC Compressor Replacement",        tier: "advanced", category: "repair" },
  { slug: "fuel_injector_replacement",    name: "Fuel Injector Replacement",        tier: "advanced", category: "repair" },
  { slug: "drivability_diagnostics",      name: "In-depth Drivability Diagnostics", tier: "advanced", category: "diagnostic" },

  // ── TIER 5 — MASTER MECHANIC ─────────────────────────────────────────────
  { slug: "ev_high_voltage_service",      name: "Hybrid & Electric Vehicle High-Voltage Service", tier: "master", category: "repair" },
  { slug: "ev_battery_service",           name: "EV Battery Diagnostics & Service", tier: "master", category: "diagnostic" },
  { slug: "adas_calibration",             name: "ADAS Calibration (Cameras, Sensors, Radar)", tier: "master", category: "diagnostic" },
  { slug: "module_programming_flashing",  name: "Complex Module Programming & Flashing", tier: "master", category: "repair" },
  { slug: "engine_replacement_repair",    name: "Engine Replacement / In-depth Engine Repair", tier: "master", category: "repair" },
  { slug: "transmission_rebuild",         name: "Transmission Replacement / Rebuild", tier: "master", category: "repair" },
  { slug: "turbocharger_replacement",     name: "Turbocharger Replacement",         tier: "master", category: "repair" },
  { slug: "differential_repair",          name: "Differential Repair",              tier: "master", category: "repair" },
  { slug: "air_suspension_repair",        name: "Air Suspension System Repair",     tier: "master", category: "repair" },
  { slug: "computer_network_diagnostics", name: "Comprehensive Computer & Network Diagnostics", tier: "master", category: "diagnostic" },
  { slug: "performance_tuning",           name: "Custom Performance Tuning",        tier: "master", category: "repair" },
  { slug: "fleet_heavy_duty_repair",      name: "Heavy-Duty / Fleet Vehicle Repairs", tier: "master", category: "repair" },
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
 * Compute fee/payout in cents, rounding the platform fee (so the mechanic
 * always gets the rounding remainder, never the other way around).
 */
export function splitCents(amountCents: number, rate: CommissionResult): { platformFeeCents: number; mechanicPayoutCents: number } {
  const platformFeeCents = Math.round(amountCents * rate.platformRate);
  const mechanicPayoutCents = amountCents - platformFeeCents;
  return { platformFeeCents, mechanicPayoutCents };
}
