/**
 * One stub adapter per platform. They all throw `PostingProviderNotConfiguredError`
 * — the publishing engine catches and stamps `last_publish_error` so admins
 * see an actionable message in the UI rather than a silent skip.
 *
 * Real implementations replace these by registering a configured provider
 * for the same `platform` key in the registry.
 */
import {
  PostingProviderNotConfiguredError,
  type PostingPlatform,
  type PostingProvider,
} from "./types";
import { hasCredentialSync } from "../credentialStore";

/**
 * Per-platform list of credential keys whose presence indicates the
 * platform "has its keys" — the publish call still throws (no real
 * adapter wired up yet), but `isConfigured()` becomes true so the admin
 * UI shows a green status and we can flip the publish call to a real
 * implementation in a single localized PR.
 */
const REQUIRED_KEYS: Record<PostingPlatform, string[]> = {
  facebook:  ["facebook_page_token",   "facebook_page_id"],
  instagram: ["instagram_access_token","instagram_user_id"],
  tiktok:    ["tiktok_access_token",   "tiktok_open_id"],
  twitter:   ["twitter_access_token"],
};

function makeStub(platform: PostingPlatform, label: string): PostingProvider {
  return {
    platform,
    label,
    isConfigured(): boolean {
      return REQUIRED_KEYS[platform].every((k) => hasCredentialSync(k));
    },
    async publish(): Promise<never> {
      const hasKeys = REQUIRED_KEYS[platform].every((k) => hasCredentialSync(k));
      throw new PostingProviderNotConfiguredError(
        platform,
        hasKeys
          ? `${label} credentials are saved but the live posting adapter is not yet implemented. ` +
            `Implement the platform's Graph/Marketing API call in a real PostingProvider to enable publishing.`
          : `${label} publishing isn't connected yet. Add the required API credentials in Growth → Integrations to enable auto-publishing.`,
      );
    },
  };
}

export const facebookStub  = makeStub("facebook",  "Facebook Pages");
export const instagramStub = makeStub("instagram", "Instagram Graph");
export const tiktokStub    = makeStub("tiktok",    "TikTok Content Posting");
export const twitterStub   = makeStub("twitter",   "X (Twitter) v2");
