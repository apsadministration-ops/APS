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

function makeStub(platform: PostingPlatform, label: string): PostingProvider {
  return {
    platform,
    label,
    isConfigured(): boolean {
      return false;
    },
    async publish(): Promise<never> {
      throw new PostingProviderNotConfiguredError(
        platform,
        `${label} publishing isn't connected yet. Connect the platform's Graph/Marketing API and register a configured provider to enable auto-publishing.`,
      );
    },
  };
}

export const facebookStub  = makeStub("facebook",  "Facebook Pages");
export const instagramStub = makeStub("instagram", "Instagram Graph");
export const tiktokStub    = makeStub("tiktok",    "TikTok Content Posting");
export const twitterStub   = makeStub("twitter",   "X (Twitter) v2");
