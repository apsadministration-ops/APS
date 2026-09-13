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

function utcParts(date: Date): { dayOfWeek: number; minute: number } {
  return {
    dayOfWeek: date.getUTCDay(),
    minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

/**
 * Returns true when the complete interval fits inside one configured window.
 * Overnight windows (for example 22:00–02:00) are supported. An empty weekly
 * list is the backwards-compatible unrestricted configuration.
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

  const start = utcParts(startsAt);
  const end = utcParts(endsAt);
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;

  return normalized.config.weekly.some((window) => {
    if (window.dayOfWeek !== start.dayOfWeek) return false;
    const open = minutes(window.open);
    const close = minutes(window.close);
    let windowDuration = close - open;
    if (windowDuration <= 0) windowDuration += 24 * 60;
    // A window cannot cover an interval spanning more than one calendar day
    // unless it is an overnight window.
    if (durationMinutes > windowDuration) return false;
    const startOffset = start.minute - open;
    if (startOffset < 0 || startOffset >= windowDuration) return false;
    if (open < close) {
      return end.dayOfWeek === start.dayOfWeek
        && end.minute <= close;
    }
    // Overnight window: the end can be on the following UTC day.
    const endOffset = (end.dayOfWeek === start.dayOfWeek
      ? end.minute
      : end.minute + 24 * 60) - open;
    return endOffset <= windowDuration;
  });
}

export function formatBayAvailabilityConfig(value: unknown): NormalizedBayAvailabilityConfig {
  return normalizeBayAvailabilityConfig(value).config;
}

export type BayAvailabilityConfigValue = BayAvailabilityConfig;