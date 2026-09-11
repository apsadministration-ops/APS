/**
 * Trusted public URL configuration shared by links sent to users and
 * provider callbacks. Never manufacture a production URL from a missing
 * domain; in particular, do not emit `https://undefined`.
 */

export class PublicUrlNotConfiguredError extends Error {
  readonly code = "public_url_not_configured";
  readonly statusCode = 503;

  constructor() {
    super("Public URL is not configured.");
    this.name = "PublicUrlNotConfiguredError";
  }
}

export type PublicUrlPurpose =
  | "reset"
  | "payment"
  | "payout"
  | "tip"
  | "domain_callback"
  | "amplification"
  | "referral";

function isPlaceholderHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "undefined" || lower === "null" || lower.includes("undefined");
}

function normalizeUrl(value: string | undefined, production: boolean): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || isPlaceholderHostname(url.hostname)) return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;
    if (production && url.protocol !== "https:") return null;
    if (production && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | undefined, production: boolean): string | null {
  const domain = value?.trim();
  if (!domain || isPlaceholderHostname(domain)) return null;
  return normalizeUrl(`https://${domain}`, production);
}

function isProductionEnvironment(): boolean {
  const deployment = process.env.REPLIT_DEPLOYMENT?.trim().toLowerCase();
  return (
    process.env.NODE_ENV?.trim().toLowerCase() === "production" ||
    Boolean(deployment && deployment !== "0" && deployment !== "false")
  );
}

function configuredDomain(production: boolean): string | null | undefined {
  const raw = process.env.REPLIT_DOMAINS;
  if (!raw?.trim()) return undefined;
  const first = raw.split(",").map((value) => value.trim()).find(Boolean);
  // A configured-but-invalid value fails closed; it must not silently fall
  // through to a different URL source.
  return normalizeDomain(first, production);
}

function configuredDevelopmentDomain(production: boolean): string | null | undefined {
  const raw = process.env.REPLIT_DEV_DOMAIN;
  if (!raw?.trim()) return undefined;
  return normalizeDomain(raw, production);
}

/**
 * Returns a trusted base URL, or null when production lacks one. Localhost is
 * intentionally available only outside production for isolated development.
 */
export function getPublicBaseUrl(purpose: PublicUrlPurpose): string | null {
  const production = isProductionEnvironment();

  let configured: string | null | undefined;
  switch (purpose) {
    case "reset": {
      const raw = process.env.APP_BASE_URL;
      configured = raw?.trim() ? normalizeUrl(raw, production) : undefined;
      break;
    }
    case "amplification": {
      const raw = process.env.PUBLIC_BASE_URL;
      configured = raw?.trim() ? normalizeUrl(raw, production) : undefined;
      break;
    }
    case "payment":
    case "payout":
    case "tip":
    case "domain_callback":
    case "referral":
      configured = undefined;
      break;
  }
  if (configured !== undefined) return configured;

  configured = configuredDomain(production);
  if (configured !== undefined) return configured;

  configured = configuredDevelopmentDomain(production);
  if (configured !== undefined) return configured;

  return production ? null : "http://localhost";
}

export function requirePublicBaseUrl(purpose: PublicUrlPurpose): string {
  const baseUrl = getPublicBaseUrl(purpose);
  if (!baseUrl) throw new PublicUrlNotConfiguredError();
  return baseUrl;
}

export function getPublicDomain(purpose: PublicUrlPurpose): string | null {
  const baseUrl = getPublicBaseUrl(purpose);
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.host;
  } catch {
    return null;
  }
}