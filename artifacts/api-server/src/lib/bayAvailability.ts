import type { BayAvailabilityConfig } from "@workspace/db";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type NormalizedBayAvailabilityConfig = {
  timezone: "UTC";
  weekly: Array<{
    dayOfWeek: number;
    open: string;
    close: string;
  }>;
};

/**
 * Availability is intentionally small and additive. `{}` means the existing
 * always-available behavior, while `weekly` describes windows in UTC. The
 * parser accepts `dayOfWeek/open/close` as the canonical shape and the
 * `day/start/end` aliases used by an early Ghost Garage client draft.
 */
export function normalizeBayAvailabilityConfig(
  value: unknown,
): { config: NormalizedBayAvailabilityConfig; error?: string } {
  if (value == null) {
    return { config: { timezone: "UTC", weekly: [] } };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { config: { timezone: "UTC", weekly: [] }, error: "availabilityConfig must be an object" };
  }

  const raw = value as Record<string, unknown>;
  if (raw.timezone !== undefined && raw.timezone !== "UTC") {
    return { config: { timezone: "UTC", weekly: [] }, error: "availabilityConfig.timezone must be UTC" };
  }
  const weeklyValue = raw.weekly;
  if (weeklyValue === undefined) {
    return { config: { timezone: "UTC", weekly: [] } };
  }
  if (!Array.isArray(weeklyValue) || weeklyValue.length > 14) {
    return { config: { timezone: "UTC", weekly: [] }, error: "availabilityConfig.weekly must be an array of at most 14 windows" };
  }

  const weekly: NormalizedBayAvailabilityConfig["weekly"] = [];
  for (const [index, entry] of weeklyValue.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { config: { timezone: "UTC", weekly: [] }, error: `availabilityConfig.weekly[${index}] must be an object` };
    }
    const item = entry as Record<string, unknown>;
    const dayValue = item.dayOfWeek ?? item.day;
    const openValue = item.open ?? item.start;
    const closeValue = item.close ?? item.end;
    if (
      typeof dayValue !== "number" ||
      !Number.isInteger(dayValue) ||
      dayValue < 0 ||
      dayValue > 6 ||
      typeof openValue !== "string" ||
      !TIME_PATTERN.test(openValue) ||
      typeof closeValue !== "string" ||
      !TIME_PATTERN.test(closeValue)
    ) {
      return {
        config: { timezone: "UTC", weekly: [] },
        error: `availabilityConfig.weekly[${index}] must use dayOfWeek 0..6 and UTC HH:mm open/close times`,
      };
    }
    if (openValue === closeValue) {
      return {
        config: { timezone: "UTC", weekly: [] },
        error: `availabilityConfig.weekly[${index}] must span a non-zero interval`,
      };
    }
    weekly.push({ dayOfWeek: dayValue, open: openValue, close: closeValue });
  }

  return { config: { timezone: "UTC", weekly } };
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Returns true when the complete interval fits inside one configured window.
 * Overnight windows (for example 22:00–02:00) are supported, including an
 * interval that starts on the following day while the previous day's window is
 * still open. An empty weekly list is the backwards-compatible unrestricted
 * configuration.
 */
export function isBayIntervalAvailable(
  value: unknown,
  startsAt: Date,
  endsAt: Date,
): boolean {
  const normalized = normalizeBayAvailabilityConfig(value);
  if (normalized.error || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return false;
  if (normalized.config.weekly.length === 0) return true;
  if (endsAt.getTime() <= startsAt.getTime()) return false;

  return normalized.config.weekly.some((window) => {
    const openingDay = utcDayStart(startsAt);
    const openMinutes = minutes(window.open);
    const closeMinutes = minutes(window.close);
    const isOvernight = closeMinutes < openMinutes;

    // A window is keyed by the day on which it opens. Check both the current
    // day (normal windows and the evening side of overnight windows) and the
    // prior day (the morning continuation of an overnight window).
    for (const dayOffset of [0, 1]) {
      if (dayOffset === 1 && !isOvernight) continue;
      const windowDay = openingDay - dayOffset * DAY_MS;
      if (new Date(windowDay).getUTCDay() !== window.dayOfWeek) continue;

      const windowOpen = windowDay + openMinutes * 60_000;
      let windowClose = windowDay + closeMinutes * 60_000;
      if (isOvernight) windowClose += DAY_MS;
      if (startsAt.getTime() >= windowOpen && endsAt.getTime() <= windowClose) {
        return true;
      }
    }
    return false;
  });
}

export function formatBayAvailabilityConfig(value: unknown): NormalizedBayAvailabilityConfig {
  return normalizeBayAvailabilityConfig(value).config;
}

export type BayAvailabilityConfigValue = BayAvailabilityConfig;