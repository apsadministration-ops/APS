/**
 * Detects whether a service request needs a shop lift / bay (Ghost Garage).
 * Customers no longer toggle this manually — it's auto-derived from the
 * description text. Mechanics + admins can still override server-side.
 *
 * Keyword categories the user explicitly called out:
 *   - New tires (tire / tires / wheel mount / mounting / balance)
 *   - Exhaust work (exhaust / muffler / catalytic / cat-back)
 *   - Transmission (transmission / clutch / differential / driveshaft)
 *   - Suspension (suspension / strut / shock / control arm / ball joint /
 *     tie rod / sway bar / coilover / alignment)
 */
const LIFT_KEYWORDS: ReadonlyArray<RegExp> = [
  /\btire(s)?\b/i,
  /\bwheel\s+(mount|mounting|balance|balancing)\b/i,
  /\bexhaust\b/i,
  /\bmuffler\b/i,
  /\bcatalytic\b/i,
  /\bcat[-\s]?back\b/i,
  /\btransmission\b/i,
  /\bclutch\b/i,
  /\bdifferential\b/i,
  /\bdriveshaft\b/i,
  /\bsuspension\b/i,
  /\bstrut(s)?\b/i,
  /\bshock(s)?\b/i,
  /\bcontrol\s+arm\b/i,
  /\bball\s+joint\b/i,
  /\btie\s+rod\b/i,
  /\bsway\s+bar\b/i,
  /\bcoilover(s)?\b/i,
  /\balignment\b/i,
];

export function describeLiftReason(description: string): string | null {
  const text = (description ?? "").toLowerCase();
  if (/\btire/i.test(text) || /\bwheel\s+(mount|balance)/i.test(text)) return "New tires / wheel work";
  if (/\bexhaust|muffler|catalytic|cat[-\s]?back/i.test(text)) return "Exhaust work";
  if (/\btransmission|clutch|differential|driveshaft/i.test(text)) return "Transmission / drivetrain";
  if (/\bsuspension|strut|shock|control\s+arm|ball\s+joint|tie\s+rod|sway\s+bar|coilover|alignment/i.test(text)) return "Suspension / alignment";
  return null;
}

export function requiresLiftFromDescription(description: string): boolean {
  if (!description) return false;
  return LIFT_KEYWORDS.some((re) => re.test(description));
}
