/**
 * Password reset flow.
 *
 *   POST /auth/forgot-password   { email }
 *     - Always responds 200 to avoid leaking which emails exist.
 *     - On match: generates a 32-byte token, stores its SHA-256 hash with a
 *       1-hour expiry, and emails the user a reset link.
 *     - The link points to a server-rendered page (no app install required).
 *
 *   GET  /auth/reset-password?token=...
 *     - Renders an HTML form to choose a new password.
 *     - Returns 410 (with friendly HTML) if the token is invalid, expired,
 *       or already used.
 *
 *   POST /auth/reset-password    { token, newPassword }
 *     - Validates and atomically marks the token used + updates the password.
 *
 * Security:
 *   - Only the SHA-256 hash of the token is stored. The raw token only ever
 *     exists in the email link.
 *   - Tokens are single-use (`used_at` stamped inside the same UPDATE).
 *   - Tokens expire after 1 hour.
 *   - Rate-limited to 5 requests / 15 min per IP for /forgot-password and
 *     POST /reset-password.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import { hashPassword } from "../lib/auth";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const PASSWORD_MIN = 8;

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests. Please try again later." },
});

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function getResetBaseUrl(): string {
  // SECURITY: Never derive this from request headers (Host / X-Forwarded-Host
  // are attacker-controlled on a public endpoint and would let someone send
  // victims phishing links pointing at their own domain). Use a trusted
  // configuration value:
  //   1. APP_BASE_URL (explicit override, e.g. "https://aps.example.com")
  //   2. First entry of REPLIT_DOMAINS (set in production deployments)
  //   3. REPLIT_DEV_DOMAIN (dev preview)
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const prodDomains = process.env.REPLIT_DOMAINS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (prodDomains && prodDomains.length > 0) return `https://${prodDomains[0]}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const forgotSchema = z.object({ email: z.string().email().max(320) });

router.post("/auth/forgot-password", forgotLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid email" }); return; }
  const email = parsed.data.email.trim().toLowerCase();

  // Generic response — always 200, regardless of whether the email exists.
  const generic = { ok: true, message: "If an account exists for that email, a reset link has been sent." };

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.json(generic);
    return;
  }
  if (user.status === "suspended") {
    res.json(generic);
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    expiresAt,
    requestedIp: req.ip ?? null,
  });

  const baseUrl = getResetBaseUrl();
  const resetUrl = `${baseUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;

  const subject = "Reset your APS password";
  const text = [
    `Hi ${user.name},`,
    "",
    "We got a request to reset your APS password.",
    "Open the link below to choose a new one (valid for 1 hour):",
    "",
    resetUrl,
    "",
    "If you didn't request this, you can ignore this email — your password",
    "will not change.",
    "",
    "— APS",
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:22px;margin:0 0 12px">Reset your APS password</h1>
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>We got a request to reset your APS password. Click the button below to choose a new one. This link is valid for <strong>1 hour</strong>.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(resetUrl)}"
           style="background:#F97316;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Reset password
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">Or copy this link into your browser:<br>
        <span style="word-break:break-all">${escapeHtml(resetUrl)}</span>
      </p>
      <p style="color:#64748b;font-size:13px">If you didn't request this, you can ignore this email — your password won't change.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:32px">— APS · Automotive Platform System</p>
    </div>
  `.trim();

  const result = await sendEmail({ to: email, subject, html, text });
  if (!result.ok) {
    // Never log the reset URL, token, recipient, or email body. The generic
    // response below still prevents account enumeration.
    req.log?.warn({ userId: user.id, reason: result.reason }, "Password reset email NOT sent");
  } else {
    req.log?.info({ userId: user.id }, "Password reset email sent");
  }
  res.json(generic);
});

router.get("/auth/reset-password", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query.token ?? "").trim();
  if (!token) { res.status(400).type("text/html").send(invalidTokenHtml("Missing token")); return; }
  const tokenHash = sha256(token);
  const [row] = await db.select().from(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.tokenHash, tokenHash),
      gt(passwordResetTokensTable.expiresAt, new Date()),
      isNull(passwordResetTokensTable.usedAt),
    ));
  if (!row) {
    res.status(410).type("text/html").send(invalidTokenHtml("This reset link is invalid, expired, or already used. Please request a new one."));
    return;
  }
  res.type("text/html").send(resetFormHtml(token));
});

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(PASSWORD_MIN).max(200),
});

router.post("/auth/reset-password", forgotLimiter, async (req: Request, res: Response): Promise<void> => {
  // Accept either JSON or form-urlencoded (the server-rendered page submits as form).
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    if (req.accepts(["html", "json"]) === "html") {
      res.status(400).type("text/html").send(invalidTokenHtml(`Password must be at least ${PASSWORD_MIN} characters.`));
    } else {
      res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters.` });
    }
    return;
  }
  const tokenHash = sha256(parsed.data.token);

  // Bcrypt is expensive — do it OUTSIDE the transaction so we don't hold a
  // row lock while hashing. The token claim inside the transaction is the
  // single source of truth for atomicity.
  const newHash = await hashPassword(parsed.data.newPassword);

  // All-or-nothing: claim the token, update the password, invalidate sibling
  // tokens. If anything throws, the token is NOT consumed and the user can
  // retry with the same link.
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        gt(passwordResetTokensTable.expiresAt, new Date()),
        isNull(passwordResetTokensTable.usedAt),
      ))
      .returning();
    if (!row) return null;
    await tx.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, row.userId));
    // Defense-in-depth: invalidate any other live tokens for this user.
    await tx.update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(passwordResetTokensTable.userId, row.userId),
        isNull(passwordResetTokensTable.usedAt),
      ));
    return row;
  });

  if (!claimed) {
    if (req.accepts(["html", "json"]) === "html") {
      res.status(410).type("text/html").send(invalidTokenHtml("This reset link is invalid, expired, or already used."));
    } else {
      res.status(410).json({ error: "Invalid or expired token" });
    }
    return;
  }

  req.log?.info({ userId: claimed.userId }, "Password reset successfully");

  if (req.accepts(["html", "json"]) === "html") {
    res.type("text/html").send(successHtml());
  } else {
    res.json({ ok: true, message: "Password updated. You can now sign in." });
  }
});

/* -------------------------------------------------------------------------- */
/* Server-rendered HTML pages                                                 */
/* -------------------------------------------------------------------------- */

function pageShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · APS</title>
<style>
  body { font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:0; }
  .wrap { max-width:440px; margin:64px auto; padding:32px 28px; background:#fff; border-radius:16px; box-shadow:0 4px 24px rgba(15,23,42,0.06); }
  h1 { font-size:24px; margin:0 0 6px; }
  p { color:#475569; line-height:1.5; }
  label { display:block; font-size:13px; font-weight:600; margin:18px 0 6px; }
  input { width:100%; box-sizing:border-box; padding:12px 14px; font-size:15px; border:1px solid #cbd5e1; border-radius:10px; }
  button { width:100%; margin-top:20px; padding:13px; font-size:15px; font-weight:700; color:#fff; background:#F97316; border:0; border-radius:10px; cursor:pointer; }
  button:hover { background:#ea660a; }
  .badge { display:inline-block; background:#F97316; color:#fff; font-weight:800; padding:6px 12px; border-radius:8px; letter-spacing:1px; font-size:14px; }
  .err { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; padding:10px 12px; border-radius:8px; font-size:13px; margin-top:14px; }
  .ok { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; padding:10px 12px; border-radius:8px; font-size:13px; margin-top:14px; }
  .muted { color:#94a3b8; font-size:12px; margin-top:24px; text-align:center; }
</style>
</head><body><div class="wrap">${body}</div></body></html>`;
}

function resetFormHtml(token: string): string {
  return pageShell("Choose a new password", `
    <div style="text-align:center;margin-bottom:18px"><span class="badge">APS</span></div>
    <h1>Choose a new password</h1>
    <p>Pick something at least ${PASSWORD_MIN} characters long. After saving, you can sign in with your new password.</p>
    <form method="POST" action="/api/auth/reset-password" autocomplete="off">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label for="newPassword">New password</label>
      <input id="newPassword" name="newPassword" type="password" minlength="${PASSWORD_MIN}" required autofocus>
      <button type="submit">Update password</button>
    </form>
    <p class="muted">This link is single-use and will expire after one hour.</p>
  `);
}

function successHtml(): string {
  return pageShell("Password updated", `
    <div style="text-align:center;margin-bottom:18px"><span class="badge">APS</span></div>
    <h1>Password updated</h1>
    <p class="ok">Your password was changed successfully.</p>
    <p>Open the APS app and sign in with your new password.</p>
  `);
}

function invalidTokenHtml(message: string): string {
  return pageShell("Reset link issue", `
    <div style="text-align:center;margin-bottom:18px"><span class="badge">APS</span></div>
    <h1>Reset link issue</h1>
    <p class="err">${escapeHtml(message)}</p>
    <p>Open the APS app and tap <strong>Forgot password</strong> to request a new link.</p>
  `);
}

export default router;
