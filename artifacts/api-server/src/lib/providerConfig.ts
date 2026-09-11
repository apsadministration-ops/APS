/**
 * Validate provider base URLs before constructing an SDK client. Environment
 * interpolation such as `https://${undefined}` must never count as configured.
 */
function isProductionEnvironment(): boolean {
  const deployment = process.env.REPLIT_DEPLOYMENT?.trim().toLowerCase();
  return (
    process.env.NODE_ENV?.trim().toLowerCase() === "production" ||
    Boolean(deployment && deployment !== "0" && deployment !== "false")
  );
}

export function isValidProviderBaseUrl(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    if (url.protocol === "http:" && (isProductionEnvironment() || !isLoopback)) return false;
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      hostname.length > 0 &&
      hostname !== "undefined" &&
      hostname !== "null" &&
      !hostname.includes("undefined")
    );
  } catch {
    return false;
  }
}

export function isValidProviderHostname(value: string | undefined): value is string {
  const hostname = value?.trim();
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return (
    lower !== "undefined" &&
    lower !== "null" &&
    !lower.includes("undefined") &&
    /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(hostname)
  );
}