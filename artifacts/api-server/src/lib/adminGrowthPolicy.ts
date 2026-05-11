/**
 * Admin Growth Policy — runtime accessor for the singleton admin_growth_settings
 * row + helpers that enforce the AI restrictions documented in the Growth
 * Intelligence Center spec:
 *
 *   - AI must NEVER autonomously publish content
 *   - AI must NEVER bypass admin approval
 *   - Admins can pause AI generation entirely
 *   - Admins can cap daily draft volume
 *
 * The pause check is consulted at every /admin/growth/content/generate*
 * route. The daily-cap check counts social_posts created today.
 */

import { eq, gte, sql } from "drizzle-orm";
import { db, adminGrowthSettingsTable, socialPostsTable, type AdminGrowthSettings } from "@workspace/db";

let cached: { value: AdminGrowthSettings; expiresAt: number } | null = null;
const CACHE_MS = 5_000;

export async function getAdminGrowthSettings(): Promise<AdminGrowthSettings> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const rows = await db.select().from(adminGrowthSettingsTable).where(eq(adminGrowthSettingsTable.id, 1));
  let value: AdminGrowthSettings;
  if (rows.length === 0) {
    const [inserted] = await db.insert(adminGrowthSettingsTable)
      .values({ id: 1, aiContentGenerationPaused: false, maxDailyDrafts: 100 })
      .returning();
    value = inserted!;
  } else {
    value = rows[0]!;
  }
  cached = { value, expiresAt: now + CACHE_MS };
  return value;
}

export async function updateAdminGrowthSettings(
  patch: Partial<Pick<AdminGrowthSettings, "aiContentGenerationPaused" | "maxDailyDrafts">>,
  updatedById: number,
): Promise<AdminGrowthSettings> {
  await getAdminGrowthSettings(); // ensure row exists
  const [row] = await db.update(adminGrowthSettingsTable)
    .set({ ...patch, updatedById, updatedAt: new Date() })
    .where(eq(adminGrowthSettingsTable.id, 1))
    .returning();
  cached = null;
  return row!;
}

/** Throws an Error tagged with statusCode for the route layer to surface. */
export class PolicyError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export async function assertAiGenerationAllowed(): Promise<void> {
  const settings = await getAdminGrowthSettings();
  if (settings.aiContentGenerationPaused) {
    throw new PolicyError(423, "AI content generation is paused by admin policy.");
  }
  // Daily cap — counts drafts created since UTC midnight.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(socialPostsTable)
    .where(gte(socialPostsTable.createdAt, startOfDay));
  if (c >= settings.maxDailyDrafts) {
    throw new PolicyError(429, `Daily draft cap reached (${settings.maxDailyDrafts}). Adjust in Admin Controls.`);
  }
}

/**
 * Public, read-only summary of the AI restriction policy. Surfaced verbatim
 * in the admin UI so the policy is discoverable and unchangeable.
 */
export const AI_RESTRICTIONS = [
  "AI must never autonomously publish content.",
  "AI must never send public communications without admin approval.",
  "AI must never modify marketplace pricing.",
  "AI must never modify mechanic rankings or tier promotions.",
  "AI must never fabricate names, testimonials, or statistics.",
  "All AI drafts enter the approval queue as `pending_review` and require an admin to approve, schedule, and mark published.",
] as const;

export const ADMIN_PERMISSIONS = [
  "approve / reject AI-generated content",
  "edit caption, hashtags, and CTA before approval",
  "view all growth analytics & CPA data",
  "schedule and mark posts as published",
  "manage mechanic amplification settings & pages",
  "override AI recommendations and trend suggestions",
  "pause AI generation globally",
  "cap daily draft volume",
] as const;
