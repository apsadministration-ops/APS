/**
 * Integration Catalog — single source of truth for every external-service
 * credential the Growth platform knows how to consume. The admin
 * Integrations UI renders one row per entry here; the credential store
 * accepts/rejects keys based on this catalog (unknown keys are rejected).
 *
 * Adding a new platform is two steps:
 *   1. Append entries below.
 *   2. Implement a `PostingProvider` (or `MediaProvider`) that reads the
 *      relevant keys via `credentialStore.getCredential()`.
 *
 * `envFallback` lets ops set a credential via Replit Secrets too — the
 * store reads DB first, env second. `secret: false` is for non-sensitive
 * config (page IDs, account handles) that we still surface in the UI.
 */

export type IntegrationGroupKey =
  | "openai"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "twitter";

export interface IntegrationGroup {
  key: IntegrationGroupKey;
  label: string;
  description: string;
  /** Doc / signup URL admin can open in a browser. */
  docsUrl: string;
  /** Icon hint for the mobile UI (Feather icon name). */
  icon: string;
  color: string;
}

export interface IntegrationCredentialDef {
  /** Canonical key — must match what runtime adapters call `getCredential()` with. */
  key: string;
  group: IntegrationGroupKey;
  label: string;
  description: string;
  /** Optional Replit Secret name to fall back to when the DB row is missing. */
  envFallback?: string;
  /** Required for the group to be considered fully configured. */
  required: boolean;
  /** When false, the value is rendered in plain text (e.g. an account handle). */
  secret: boolean;
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    key: "openai",
    label: "OpenAI (Bring Your Own Key)",
    description:
      "Optional — APS works out-of-the-box with the Replit OpenAI integration. " +
      "Add your own key here to bill image/video generation to your own OpenAI account.",
    docsUrl: "https://platform.openai.com/api-keys",
    icon: "cpu",
    color: "#10A37F",
  },
  {
    key: "facebook",
    label: "Facebook Pages",
    description:
      "Long-lived Page access token + Page ID. Required for auto-publishing to a Facebook Page.",
    docsUrl: "https://developers.facebook.com/docs/pages-api/getting-started",
    icon: "facebook",
    color: "#1877F2",
  },
  {
    key: "instagram",
    label: "Instagram Graph",
    description:
      "IG Business account linked to a Facebook Page. Uses a Page access token + IG User ID.",
    docsUrl: "https://developers.facebook.com/docs/instagram-api/getting-started",
    icon: "instagram",
    color: "#E4405F",
  },
  {
    key: "tiktok",
    label: "TikTok Content Posting",
    description:
      "OAuth access token + open ID from the TikTok for Developers Content Posting API.",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
    icon: "video",
    color: "#000000",
  },
  {
    key: "twitter",
    label: "X (Twitter) v2",
    description:
      "OAuth 2.0 user access token from the X Developer Portal — needed for posting tweets via the v2 API.",
    docsUrl: "https://developer.x.com/en/portal/dashboard",
    icon: "twitter",
    color: "#1DA1F2",
  },
];

export const INTEGRATION_CREDENTIALS: IntegrationCredentialDef[] = [
  // OpenAI BYO
  {
    key: "openai_api_key",
    group: "openai",
    label: "OpenAI API key",
    description: "Starts with `sk-`. Used for gpt-image-1 and future video models.",
    envFallback: "OPENAI_API_KEY",
    required: true,
    secret: true,
  },

  // Facebook
  {
    key: "facebook_page_token",
    group: "facebook",
    label: "Page access token",
    description: "Long-lived Page access token (NOT a User token).",
    envFallback: "FACEBOOK_PAGE_TOKEN",
    required: true,
    secret: true,
  },
  {
    key: "facebook_page_id",
    group: "facebook",
    label: "Page ID",
    description: "Numeric Facebook Page ID the posts will publish to.",
    envFallback: "FACEBOOK_PAGE_ID",
    required: true,
    secret: false,
  },

  // Instagram
  {
    key: "instagram_access_token",
    group: "instagram",
    label: "Access token",
    description: "Same long-lived Page token that owns the linked IG Business account.",
    envFallback: "INSTAGRAM_ACCESS_TOKEN",
    required: true,
    secret: true,
  },
  {
    key: "instagram_user_id",
    group: "instagram",
    label: "IG User ID",
    description: "Numeric IG Business User ID (NOT the username).",
    envFallback: "INSTAGRAM_USER_ID",
    required: true,
    secret: false,
  },

  // TikTok
  {
    key: "tiktok_access_token",
    group: "tiktok",
    label: "Access token",
    description: "OAuth user access token with `video.publish` scope.",
    envFallback: "TIKTOK_ACCESS_TOKEN",
    required: true,
    secret: true,
  },
  {
    key: "tiktok_open_id",
    group: "tiktok",
    label: "Open ID",
    description: "TikTok open_id returned by the OAuth flow.",
    envFallback: "TIKTOK_OPEN_ID",
    required: true,
    secret: false,
  },

  // X / Twitter
  {
    key: "twitter_access_token",
    group: "twitter",
    label: "Access token",
    description: "OAuth 2.0 user access token with `tweet.write` scope.",
    envFallback: "TWITTER_ACCESS_TOKEN",
    required: true,
    secret: true,
  },
  {
    key: "twitter_access_token_secret",
    group: "twitter",
    label: "Access token secret",
    description: "Required if you're using OAuth 1.0a; leave blank for OAuth 2.0.",
    envFallback: "TWITTER_ACCESS_TOKEN_SECRET",
    required: false,
    secret: true,
  },
];

export function credentialsForGroup(group: IntegrationGroupKey): IntegrationCredentialDef[] {
  return INTEGRATION_CREDENTIALS.filter((c) => c.group === group);
}

export function findCredentialDef(key: string): IntegrationCredentialDef | undefined {
  return INTEGRATION_CREDENTIALS.find((c) => c.key === key);
}
