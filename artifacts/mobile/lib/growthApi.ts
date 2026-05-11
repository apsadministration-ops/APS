/**
 * Thin authed-fetch helper shared across the Growth Intelligence Center
 * screens. Matches the raw-fetch + AsyncStorage pattern used by the rest of
 * the admin section (index/users/payments/jobs).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const domain = process.env.EXPO_PUBLIC_DOMAIN;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function growthGet<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`https://${domain}/api${path}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function growthSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T | null> {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`https://${domain}/api${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export const PLATFORMS = [
  { value: "facebook", label: "Facebook", color: "#1877F2", icon: "facebook" },
  { value: "instagram", label: "Instagram", color: "#E1306C", icon: "instagram" },
  { value: "tiktok", label: "TikTok", color: "#000000", icon: "music" },
  { value: "twitter", label: "X / Twitter", color: "#1DA1F2", icon: "twitter" },
] as const;

export type PlatformValue = typeof PLATFORMS[number]["value"];

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#9CA3AF" },
  pending_review: { label: "Pending review", color: "#F59E0B" },
  approved: { label: "Approved", color: "#22C55E" },
  rejected: { label: "Rejected", color: "#EF4444" },
  scheduled: { label: "Scheduled", color: "#6366F1" },
  published: { label: "Published", color: "#0EA5E9" },
};

export const TOPIC_LABELS: Record<string, string> = {
  mechanic_spotlight: "Mechanic spotlight",
  maintenance_reminder: "Maintenance reminder",
  customer_education: "Customer education",
  referral_campaign: "Referral campaign",
  local_engagement: "Local engagement",
  seasonal: "Seasonal automotive",
  weather_alert: "Weather maintenance alert",
  trust_safety: "Trust & safety",
  book_through_aps: "Book through APS",
  success_story: "Mechanic success story",
  tip: "Quick tip",
  testimonial: "Customer testimonial",
};
