/**
 * Organic Content Engine
 *
 * AI-assisted, admin-supervised content generation for APS social media
 * channels. Uses Anthropic to author platform-tailored captions, hashtags,
 * media ideas, and hooks. NEVER publishes autonomously — every output lands
 * in the social_posts approval queue.
 *
 * Brand voice: trusted, local, transparent, mechanic-first marketplace.
 * No paid-ad copy. Organic, community-rooted, referral-amplifying.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";

export type Platform = "facebook" | "instagram" | "tiktok" | "twitter";

export type TopicKind =
  | "mechanic_spotlight"
  | "maintenance_reminder"
  | "customer_education"
  | "referral_campaign"
  | "local_engagement"
  | "seasonal"
  | "weather_alert"
  | "trust_safety"
  | "book_through_aps"
  | "success_story"
  | "tip"
  | "testimonial";

export const TOPIC_KINDS: TopicKind[] = [
  "mechanic_spotlight", "maintenance_reminder", "customer_education",
  "referral_campaign", "local_engagement", "seasonal", "weather_alert",
  "trust_safety", "book_through_aps", "success_story", "tip", "testimonial",
];

export const TOPIC_LABELS: Record<TopicKind, string> = {
  mechanic_spotlight: "Mechanic spotlight",
  maintenance_reminder: "Maintenance reminder",
  customer_education: "Customer education",
  referral_campaign: "Referral campaign",
  local_engagement: "Local engagement",
  seasonal: "Seasonal automotive content",
  weather_alert: "Weather-related maintenance alert",
  trust_safety: "Trust & safety messaging",
  book_through_aps: "Book through APS",
  success_story: "Mechanic success story",
  tip: "Quick automotive tip",
  testimonial: "Customer testimonial",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X / Twitter",
};

const PLATFORM_RULES: Record<Platform, string> = {
  facebook:
    "Community-oriented. 2–4 short paragraphs (~120–180 words). Local focus. End with a question to invite comments. 2–4 hashtags max.",
  instagram:
    "Concise, visually evocative caption (~80–120 words). Open with a hook line, then a compact body, then a CTA. Use 8–12 hashtags total mixing broad + niche + local.",
  tiktok:
    "Front-loaded hook in the first 3 seconds. Provide a `hookText` (≤8 words) AND a 3-beat short script in the caption (~50–80 words). 4–8 trend-style hashtags.",
  twitter:
    "≤260 characters total including hashtags. Tight, punchy, alert-style or quick-tip. 1–3 hashtags max.",
};

export interface GenerateContentInput {
  topicKind: TopicKind;
  platform: Platform;
  region?: string | null;
  /** Free-form context: e.g. mechanic name, season, weather event, regional shortage. */
  briefingContext?: string | null;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  mediaIdeas: string[];
  hookText: string | null;
  callToAction: string;
  prompt: string;
  model: string;
}

const SYSTEM_PROMPT = `You are the in-house social content director for APS — Automotive Precision Services, a VIN-centric marketplace that connects vehicle owners with local mechanics for repairs, diagnostics, maintenance, and detailing.

Brand voice:
- trusted, transparent, neighborhood-rooted, mechanic-first
- never sleazy, never clickbait, never paid-ad pushy
- emphasizes safety, reliability, fair pricing, mechanic craftsmanship
- amplifies referrals and organic community growth

Hard rules:
- NEVER fabricate testimonials, names, or stats. If specific names/figures aren't in the briefing, write evergreen copy or use generic phrasing like "drivers in your area".
- NEVER promise discounts, free service, or guarantees that aren't in the briefing.
- NEVER write paid-ad style copy. We are organic-first.
- Always end every post with an inclusive CTA that points to APS (download, signup, refer, book) without sounding pushy.
- Use clear, plain English. No emoji spam (1–3 max, only when natural).

Output format: respond ONLY with valid JSON, no markdown, no commentary, matching this schema exactly:
{
  "caption": string,        // platform-formatted body copy
  "hashtags": string[],     // each starting with '#', no spaces
  "mediaIdeas": string[],   // 2–4 short visual/video concepts the team can shoot
  "hookText": string|null,  // ≤8 words, only for tiktok/twitter, otherwise null
  "callToAction": string    // 1 sentence, max 80 chars
}`;

function buildUserPrompt(input: GenerateContentInput): string {
  const region = input.region?.trim() || "the local community";
  const lines: string[] = [
    `Topic: ${TOPIC_LABELS[input.topicKind]}`,
    `Platform: ${PLATFORM_LABELS[input.platform]}`,
    `Region focus: ${region}`,
    `Platform rules: ${PLATFORM_RULES[input.platform]}`,
  ];
  if (input.briefingContext) {
    lines.push(`Additional briefing: ${input.briefingContext.trim()}`);
  }
  lines.push(
    "",
    "Generate ONE post for this topic + platform combination. Mix local hashtags (city/region), automotive niche tags, and broad maintenance/repair tags appropriate to platform conventions. Hashtags must be discoverable but not spammy.",
    "",
    "Respond with the JSON only.",
  );
  return lines.join("\n");
}

const MODEL = "claude-sonnet-4-6";

export async function generateContent(input: GenerateContentInput): Promise<GeneratedContent> {
  const prompt = buildUserPrompt(input);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = parseGeneratedJson(text);
  return {
    caption: String(parsed.caption ?? "").trim(),
    hashtags: normalizeHashtags(parsed.hashtags),
    mediaIdeas: Array.isArray(parsed.mediaIdeas) ? parsed.mediaIdeas.map(String).slice(0, 6) : [],
    hookText: parsed.hookText && typeof parsed.hookText === "string" ? parsed.hookText.trim() : null,
    callToAction: String(parsed.callToAction ?? "Download APS to book a trusted local mechanic.").trim(),
    prompt,
    model: MODEL,
  };
}

interface GeneratedJson {
  caption?: unknown;
  hashtags?: unknown;
  mediaIdeas?: unknown;
  hookText?: unknown;
  callToAction?: unknown;
}

function parseGeneratedJson(raw: string): GeneratedJson {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as GeneratedJson;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as GeneratedJson; } catch { /* fall through */ }
    }
    throw new Error("Content engine returned non-JSON output");
  }
}

function normalizeHashtags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((h) => String(h).trim())
    .filter((h) => h.length > 0)
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .map((h) => h.replace(/\s+/g, ""))
    .slice(0, 14);
}

/**
 * Trend & Seasonal Opportunity Engine — asks Claude for a ranked list of
 * timely topic ideas given the current date + regional context. Returns short
 * recommendations the admin can one-click into the content generator.
 */
export interface TrendIdea {
  topicKind: TopicKind;
  title: string;
  rationale: string;
  suggestedRegions?: string[];
}

export async function suggestTrendingTopics(opts: {
  now: Date;
  topRegions: string[];
  shortages: { region: string; balance: string }[];
}): Promise<TrendIdea[]> {
  const month = opts.now.toLocaleString("en-US", { month: "long" });
  const userPrompt = [
    `Today is ${opts.now.toDateString()} (${month}). Suggest 6 timely organic content opportunities for APS.`,
    `Top regions by activity: ${opts.topRegions.slice(0, 5).join(", ") || "n/a"}.`,
    `Marketplace imbalances flagged: ${opts.shortages.map((s) => `${s.region} (${s.balance})`).join(", ") || "none"}.`,
    `Allowed topicKind values: ${TOPIC_KINDS.join(", ")}.`,
    `Respond with JSON: { "ideas": [ { "topicKind": "...", "title": "≤80 char title", "rationale": "≤140 char why-now reason", "suggestedRegions": ["..."] } ] }`,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: "You are an organic growth strategist for APS. Return JSON only. Never propose paid-ad ideas.",
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = parseGeneratedJson(text) as { ideas?: unknown };
  const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  return ideas
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.topicKind === "string" && TOPIC_KINDS.includes(i.topicKind as TopicKind))
    .map((i) => ({
      topicKind: i.topicKind as TopicKind,
      title: String(i.title ?? "").slice(0, 200),
      rationale: String(i.rationale ?? "").slice(0, 240),
      suggestedRegions: Array.isArray(i.suggestedRegions) ? i.suggestedRegions.map(String) : undefined,
    }))
    .slice(0, 8);
}

/**
 * Marketplace balancing recommendations — uses regional density signals
 * to recommend whether the next content batch should target customers,
 * mechanics, or be balanced.
 */
export interface BalanceRecommendation {
  region: string;
  balance: "mechanic_shortage" | "customer_shortage" | "balanced";
  contentFocus: "recruit_mechanics" | "acquire_customers" | "engage_both";
  topicKinds: TopicKind[];
  rationale: string;
}

export function recommendForBalance(snapshot: {
  region: string;
  customerCount: number;
  mechanicCount: number;
  jobsLast30: number;
  averageWaitMinutes: number;
}): BalanceRecommendation {
  const ratio = snapshot.mechanicCount === 0 ? Infinity : snapshot.customerCount / Math.max(1, snapshot.mechanicCount);
  let balance: BalanceRecommendation["balance"];
  let focus: BalanceRecommendation["contentFocus"];
  let kinds: TopicKind[];
  let rationale: string;
  if (snapshot.mechanicCount === 0 || ratio > 25 || snapshot.averageWaitMinutes > 60) {
    balance = "mechanic_shortage";
    focus = "recruit_mechanics";
    kinds = ["success_story", "mechanic_spotlight", "trust_safety"];
    rationale = `${snapshot.region}: ${snapshot.customerCount} customers vs ${snapshot.mechanicCount} mechanics — recruit mechanics.`;
  } else if (ratio < 3 && snapshot.jobsLast30 < snapshot.mechanicCount * 2) {
    balance = "customer_shortage";
    focus = "acquire_customers";
    kinds = ["maintenance_reminder", "tip", "book_through_aps", "referral_campaign"];
    rationale = `${snapshot.region}: ${snapshot.mechanicCount} mechanics underutilized — drive customer demand.`;
  } else {
    balance = "balanced";
    focus = "engage_both";
    kinds = ["customer_education", "local_engagement", "testimonial"];
    rationale = `${snapshot.region}: marketplace balanced — keep both sides engaged.`;
  }
  return { region: snapshot.region, balance, contentFocus: focus, topicKinds: kinds, rationale };
}
