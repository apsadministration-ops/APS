/**
 * Runtime configuration for the mobile API.
 *
 * Expo inlines EXPO_PUBLIC_* values at build time.  Keep all URL construction
 * behind this module so a missing value can never turn into
 * `https://undefined/...` (or silently send credentials to a malformed URL).
 */

export const API_CONFIGURATION_ERROR =
  "This app is missing its server configuration. Please reload or contact support.";

export interface ValidApiConfig {
  valid: true;
  domain: string;
  origin: string;
  apiOrigin: string;
}

export interface InvalidApiConfig {
  valid: false;
  error: typeof API_CONFIGURATION_ERROR;
}

export type ApiConfig = ValidApiConfig | InvalidApiConfig;

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let domain = value.trim();
  if (!domain || domain === "undefined" || domain === "null") return null;

  domain = domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!domain || /\s/.test(domain)) return null;

  // Validate the host without making a network request.  A pathname would
  // produce malformed API URLs, so only host/port values are accepted.
  try {
    const parsed = new URL(`https://${domain}`);
    if (
      !parsed.hostname
      || ["undefined", "null"].includes(parsed.hostname.toLowerCase())
      || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash
    ) {
      return null;
    }
    domain = parsed.host;
  } catch {
    return null;
  }

  return domain;
}

export function getApiConfig(domain = process.env.EXPO_PUBLIC_DOMAIN): ApiConfig {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return { valid: false, error: API_CONFIGURATION_ERROR };
  }

  const origin = `https://${normalized}`;
  return {
    valid: true,
    domain: normalized,
    origin,
    apiOrigin: `${origin}/api`,
  };
}

/**
 * Returns null rather than fabricating a URL.  This is useful for non-rendering
 * module constants; the root layout gates the app before authenticated screens
 * can make requests.
 */
export function getApiOrigin(): string | null {
  const config = getApiConfig();
  return config.valid ? config.origin : null;
}

export function getApiUrl(path: string): string {
  const config = getApiConfig();
  if (!config.valid) {
    throw new Error(config.error);
  }

  if (!path.startsWith("/")) {
    throw new TypeError("API paths must start with '/'.");
  }

  const normalizedPath =
    path === "/api" ? "" : path.startsWith("/api/") ? path.slice(4) : path;
  return `${config.apiOrigin}${normalizedPath}`;
}