/**
 * Parse route identifiers strictly before they reach a database query.
 * Number("undefined") is NaN and Number("1.5") is not a valid serial id;
 * both should be rejected with a client error instead of becoming a DB error.
 */
export function parsePositiveSafeInteger(value: unknown): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" && typeof candidate !== "number") return null;
  if (typeof candidate === "string" && candidate.trim() === "") return null;
  if (typeof candidate === "string" && !/^\d+$/.test(candidate.trim())) return null;

  const parsed = typeof candidate === "number" ? candidate : Number(candidate.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}