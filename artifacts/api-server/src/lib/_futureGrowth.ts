/**
 * Future Growth Architecture — interface stubs (NOT WIRED).
 *
 * Per the Growth Intelligence Center spec, these capability surfaces are
 * declared up-front so future features can be plugged in without a rewrite.
 * Nothing in this file is exported into runtime code paths today.
 *
 *   - Paid advertising (the platform is currently organic-only by policy)
 *   - Predictive growth analytics (next-30-day forecasts)
 *   - Autonomous campaign recommendations (would still require admin approval)
 *   - Multi-language / international expansion
 *
 * Any future implementation should use these as the contract and keep them
 * additive — do not break existing organic flows.
 */

export interface PaidAdAdapter {
  name: "meta" | "google" | "tiktok_ads" | string;
  /** Disabled by default. Toggling requires admin policy update. */
  enabled: boolean;
  estimateCpa(opts: { region: string; budgetUsd: number }): Promise<{ estimatedSignups: number; estimatedCpaUsd: number }>;
}

export interface GrowthForecaster {
  forecast(opts: {
    horizonDays: number;
    region?: string;
    role?: "customer" | "mechanic";
  }): Promise<{ date: string; projected: number; confidenceLow: number; confidenceHigh: number }[]>;
}

export interface CampaignRecommender {
  /** Recommendations only — must be queued through the existing approval queue. */
  recommend(opts: { region: string; horizonDays: number }): Promise<{
    title: string; rationale: string; suggestedTopicKinds: string[]; estimatedImpact: string;
  }[]>;
}

export interface LocaleAdapter {
  /** Supported BCP-47 locales. Default is en-US. */
  supported(): readonly string[];
  /** Translate a generated content payload to the target locale. */
  translateContent(opts: { locale: string; caption: string; hashtags: string[] }): Promise<{ caption: string; hashtags: string[] }>;
}

export const FUTURE_CAPABILITIES = [
  "paid_advertising",
  "predictive_growth_analytics",
  "autonomous_campaign_recommendations",
  "multi_language_translation",
  "international_region_expansion",
] as const;

export type FutureCapability = typeof FUTURE_CAPABILITIES[number];
