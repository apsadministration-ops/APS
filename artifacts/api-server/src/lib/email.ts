/**
 * Transactional email helper.
 *
 * Uses Resend when the connection is configured. If not configured (e.g. dev
 * environments where the Replit connection hasn't been bound yet), the
 * helper returns a failure to the caller. Email bodies and reset links are
 * never written to logs.
 *
 * Never cache the Resend client — tokens expire. Always re-fetch credentials
 * via `getResendClient()` on each send.
 */

import { logger } from "./logger";
import { isValidProviderHostname } from "./providerConfig";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

interface ResendCreds {
  apiKey: string;
  fromEmail: string;
}

let _credsCache: { value: ResendCreds | null; expiresAt: number } = { value: null, expiresAt: 0 };

async function getResendCreds(): Promise<ResendCreds | null> {
  const now = Date.now();
  if (_credsCache.value && now < _credsCache.expiresAt) return _credsCache.value;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken =
    process.env.REPL_IDENTITY ? `repl ${process.env.REPL_IDENTITY}` :
    process.env.WEB_REPL_RENEWAL ? `depl ${process.env.WEB_REPL_RENEWAL}` :
    null;
  if (!isValidProviderHostname(hostname) || !xReplitToken) return null;

  try {
    const url = `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`;
    const r = await fetch(url, {
      headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
    });
    if (!r.ok) return null;
    const data = await r.json() as { items?: { settings?: Record<string, unknown> }[] };
    const settings = data.items?.[0]?.settings ?? {};
    const apiKey = settings.api_key as string | undefined;
    const fromEmail = (settings.from_email as string | undefined) ?? "noreply@example.com";
    if (!apiKey) return null;
    const creds: ResendCreds = { apiKey, fromEmail };
    // Cache 4 minutes, well under any token lifetime.
    _credsCache = { value: creds, expiresAt: now + 4 * 60 * 1000 };
    return creds;
  } catch (err) {
    logger.warn({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "Resend credential fetch failed");
    return null;
  }
}

/**
 * Send an email. Returns `{ ok: true }` if delivered, or
 * `{ ok: false, reason }` so callers can decide whether to surface the error.
 *
 * For password reset: always return `ok: true` to the user regardless, to
 * prevent account enumeration. The caller should still log a failure.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; reason?: string }> {
  const creds = await getResendCreds();
  if (!creds) {
    logger.warn({ subject: args.subject }, "Resend not configured — email NOT sent");
    return { ok: false, reason: "email_provider_not_configured" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from ?? creds.fromEmail,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!r.ok) {
      // Do not log the provider response: it can echo recipient or message
      // material, including a reset link.
      await r.text().catch(() => "");
      logger.error({ status: r.status }, "Resend send failed");
      return { ok: false, reason: `resend_${r.status}` };
    }
    return { ok: true };
  } catch {
    logger.error("Resend send threw");
    return { ok: false, reason: "send_exception" };
  }
}
