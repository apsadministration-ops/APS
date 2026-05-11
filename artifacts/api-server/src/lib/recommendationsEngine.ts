/**
 * Vehicle-specific service recommendations. Combines:
 *  - mileage-interval rules (oil, brakes, transmission, etc.)
 *  - work_log history scan (recurring tags, prior wear notes)
 *  - model-specific known failure points
 *
 * All output is ADVISORY ONLY — never auto-creates jobs. The mechanic can
 * convert any recommendation to a customer-facing message via the existing
 * /messages endpoint.
 */

import type { workLogsTable, vehiclesTable } from "@workspace/db";

type WorkLog = typeof workLogsTable.$inferSelect;
type Vehicle = typeof vehiclesTable.$inferSelect;

export type Severity = "info" | "due-soon" | "overdue" | "safety";
export type Source = "mileage-interval" | "history-pattern" | "known-failure" | "recurring-tag";

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  source: Source;
  suggestedAction: string;
  estimatedCostRangeUsd?: [number, number];
}

const MILEAGE_INTERVALS: { name: string; intervalMi: number; severityWindow: number; cost: [number, number]; action: string }[] = [
  { name: "Engine oil + filter change", intervalMi: 5000, severityWindow: 1000, cost: [60, 120], action: "Replace oil + filter, reset maintenance light." },
  { name: "Tire rotation", intervalMi: 5000, severityWindow: 1500, cost: [25, 60], action: "Rotate tires, check pressures, inspect tread depth." },
  { name: "Cabin air filter", intervalMi: 15000, severityWindow: 3000, cost: [25, 70], action: "Replace cabin air filter." },
  { name: "Engine air filter", intervalMi: 30000, severityWindow: 5000, cost: [25, 80], action: "Replace engine air filter." },
  { name: "Brake fluid flush", intervalMi: 30000, severityWindow: 5000, cost: [80, 150], action: "Flush + replace brake fluid (DOT 3/4 per spec)." },
  { name: "Transmission fluid service", intervalMi: 60000, severityWindow: 10000, cost: [200, 400], action: "Drain + refill ATF (or CVT fluid). Check for metal." },
  { name: "Coolant flush", intervalMi: 60000, severityWindow: 10000, cost: [120, 220], action: "Flush + refill coolant. Pressure test cap + system." },
  { name: "Spark plug replacement", intervalMi: 90000, severityWindow: 10000, cost: [120, 350], action: "Replace plugs (iridium per OE spec). Inspect coils." },
];

const RECURRING_TAG_RULES: { tag: string; rec: Omit<Recommendation, "id"> }[] = [
  {
    tag: "cv-axle-wear",
    rec: {
      title: "Opposite-side CV axle inspection recommended",
      detail: "Prior CV-axle wear documented in this vehicle's history. CV axles typically wear at similar rates on the same vehicle — recommend inspecting the opposite side for boot tears and joint play.",
      severity: "due-soon",
      source: "recurring-tag",
      suggestedAction: "Visual + hands-on CV inspection on the opposite side; replace if play >2mm or boot torn.",
      estimatedCostRangeUsd: [180, 320],
    },
  },
  {
    tag: "tie-rod-wear",
    rec: {
      title: "Re-check tie rod alignment",
      detail: "Tie rod work logged previously — confirm toe is still within spec and there's no new play.",
      severity: "info",
      source: "recurring-tag",
      suggestedAction: "Toe-only alignment check; full alignment if any tie rod movement detected.",
      estimatedCostRangeUsd: [80, 120],
    },
  },
  {
    tag: "brake-wear",
    rec: {
      title: "Brake pad re-measure",
      detail: "Prior brake service in history — measure remaining pad thickness and rotor runout.",
      severity: "due-soon",
      source: "recurring-tag",
      suggestedAction: "Measure pad depth front + rear; flag if <4mm.",
      estimatedCostRangeUsd: [0, 30],
    },
  },
];

interface KnownFailureRule {
  match: (v: Vehicle) => boolean;
  rec: Omit<Recommendation, "id">;
}

const KNOWN_FAILURES: KnownFailureRule[] = [
  {
    match: (v) => v.make.toLowerCase() === "subaru" && v.model.toLowerCase() === "outback" && v.year >= 2015 && v.year <= 2019 && (v.mileage ?? 0) >= 70000,
    rec: {
      title: "Subaru Outback CV axle wear watch (75k–100k mi window)",
      detail: "2015–2019 Outback front CV axle inner joints commonly develop wear in this mileage band. Listen for clicking on hard-left turns under throttle.",
      severity: "due-soon",
      source: "known-failure",
      suggestedAction: "Hands-on CV inspection during next service. Replace if clicking present or play detected.",
      estimatedCostRangeUsd: [180, 320],
    },
  },
  {
    match: (v) => v.make.toLowerCase() === "ford" && v.model.toLowerCase() === "f-150" && v.year >= 2015 && v.year <= 2020 && (v.mileage ?? 0) >= 80000,
    rec: {
      title: "F-150 upper ball joint wear watch",
      detail: "2015–2020 F-150 upper control arm ball joints commonly fail past 80k mi. Symptom: clunk over bumps + uneven front tire wear.",
      severity: "due-soon",
      source: "known-failure",
      suggestedAction: "Pry-bar test ball joints; replace as a pair if any vertical play.",
      estimatedCostRangeUsd: [350, 600],
    },
  },
];

export function generateRecommendations(vehicle: Vehicle, history: WorkLog[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const currentMileage = vehicle.mileage ?? 0;

  // 1. Mileage-interval rules — find what's overdue or due soon
  for (const interval of MILEAGE_INTERVALS) {
    const lastService = history
      .filter((w) => w.serviceDescription?.toLowerCase().includes(interval.name.split(" ")[0].toLowerCase()))
      .sort((a, b) => (b.mileageAtService ?? 0) - (a.mileageAtService ?? 0))[0];

    const lastMi = lastService?.mileageAtService ?? 0;
    const milesSince = currentMileage - lastMi;
    const dueIn = interval.intervalMi - milesSince;

    if (dueIn <= -interval.severityWindow) {
      recs.push({
        id: `interval-${interval.name}-overdue`,
        title: `${interval.name} OVERDUE`,
        detail: `Last performed at ${lastMi.toLocaleString()} mi. Now ${milesSince.toLocaleString()} mi past — ${Math.abs(dueIn).toLocaleString()} mi overdue.`,
        severity: "overdue",
        source: "mileage-interval",
        suggestedAction: interval.action,
        estimatedCostRangeUsd: interval.cost,
      });
    } else if (dueIn <= interval.severityWindow) {
      recs.push({
        id: `interval-${interval.name}-due-soon`,
        title: `${interval.name} due soon`,
        detail: lastService
          ? `Last performed at ${lastMi.toLocaleString()} mi (${milesSince.toLocaleString()} mi ago). Due within ${dueIn.toLocaleString()} mi.`
          : `No record of this service. Recommend within ${dueIn.toLocaleString()} mi.`,
        severity: "due-soon",
        source: "mileage-interval",
        suggestedAction: interval.action,
        estimatedCostRangeUsd: interval.cost,
      });
    }
  }

  // 2. Recurring-tag rules from worklog history
  const allTags = new Set<string>();
  for (const log of history) {
    const tags = (log.recurringIssueTags as string[] | null) ?? [];
    for (const t of tags) allTags.add(t);
  }
  for (const rule of RECURRING_TAG_RULES) {
    if (allTags.has(rule.tag)) {
      recs.push({ id: `tag-${rule.tag}`, ...rule.rec });
    }
  }

  // 3. Known model failure points
  for (const f of KNOWN_FAILURES) {
    if (f.match(vehicle)) {
      recs.push({ id: `known-${f.rec.title.slice(0, 24).replace(/\s/g, "-").toLowerCase()}`, ...f.rec });
    }
  }

  // Sort: safety > overdue > due-soon > info
  const order: Record<Severity, number> = { safety: 0, overdue: 1, "due-soon": 2, info: 3 };
  recs.sort((a, b) => order[a.severity] - order[b.severity]);

  return recs;
}
