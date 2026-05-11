/**
 * Mechanic Amplification Kit assembly.
 *
 * Each mechanic is treated as a local growth node. Given a mechanic record
 * + their amplification customization + their referral code, we derive on
 * the fly:
 *
 *   - personalRefLink     — public landing URL (can be shared anywhere)
 *   - personalBookingLink — same landing, signup-with-referral CTA
 *   - qrPngDataUrl        — base64 PNG of personalBookingLink (printable)
 *   - vCard               — text/vcard contact card (downloadable)
 *   - businessCardSvg     — SVG digital business card (printable / shareable)
 *   - landingHtml(req)    — server-rendered public landing page HTML
 *
 * Nothing here is persisted. Customization lives in mechanic_amplification.
 */

import QRCode from "qrcode";
import type { User, MechanicAmplification } from "@workspace/db";

export interface AmplificationKit {
  mechanic: {
    id: number;
    name: string;
    region: string | null;
    city: string | null;
    referralCode: string | null;
  };
  page: MechanicAmplification | null;
  links: {
    personalRefLink: string;
    personalBookingLink: string;
    appStoreLink: string;
    playStoreLink: string;
  };
  qrPngDataUrl: string;
  vCard: string;
  businessCardSvg: string;
  socialPostStarters: { platform: "facebook" | "instagram" | "tiktok" | "twitter"; text: string }[];
}

const APP_STORE_FALLBACK = "https://apps.apple.com/app/aps-auto-service/id000000000";
const PLAY_STORE_FALLBACK = "https://play.google.com/store/apps/details?id=com.aps.autoservice";

export function publicBaseUrl(): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length > 0) return `https://${domains[0]}`;
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  return "http://localhost:5000";
}

export function personalLinks(referralCode: string | null): AmplificationKit["links"] {
  const base = publicBaseUrl();
  const code = referralCode ?? "APS";
  return {
    personalRefLink: `${base}/api/p/m/${encodeURIComponent(code)}`,
    personalBookingLink: `${base}/api/p/m/${encodeURIComponent(code)}?cta=book`,
    appStoreLink: process.env.APP_STORE_URL ?? APP_STORE_FALLBACK,
    playStoreLink: process.env.PLAY_STORE_URL ?? PLAY_STORE_FALLBACK,
  };
}

export async function buildAmplificationKit(
  mechanic: User,
  page: MechanicAmplification | null,
): Promise<AmplificationKit> {
  const links = personalLinks(mechanic.referralCode);
  const displayName = page?.displayName ?? mechanic.name;
  const tagline = page?.tagline ?? "Verified APS mechanic — book trusted local repair.";
  const brandColor = page?.brandColor ?? "#F97316";

  const qrPngDataUrl = await QRCode.toDataURL(links.personalBookingLink, {
    margin: 1,
    width: 512,
    color: { dark: "#0F172A", light: "#FFFFFFFF" },
    errorCorrectionLevel: "M",
  });

  return {
    mechanic: {
      id: mechanic.id,
      name: displayName,
      region: mechanic.region,
      city: mechanic.city,
      referralCode: mechanic.referralCode,
    },
    page,
    links,
    qrPngDataUrl,
    vCard: buildVCard(displayName, tagline, mechanic, links),
    businessCardSvg: buildBusinessCardSvg({ name: displayName, tagline, brandColor, mechanic, links }),
    socialPostStarters: buildPostStarters(displayName, mechanic, links),
  };
}

function buildVCard(
  name: string,
  tagline: string,
  mechanic: User,
  links: AmplificationKit["links"],
): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCard(name)}`,
    `ORG:APS — Automotive Platform System`,
    `TITLE:${escapeVCard(tagline)}`,
    mechanic.email ? `EMAIL;TYPE=WORK:${mechanic.email}` : "",
    mechanic.city || mechanic.region ? `ADR;TYPE=WORK:;;;${escapeVCard(mechanic.city ?? "")};${escapeVCard(mechanic.region ?? "")};;` : "",
    `URL:${links.personalBookingLink}`,
    `NOTE:${escapeVCard(`Book with me on APS — referral code ${mechanic.referralCode ?? ""}`)}`,
    "END:VCARD",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function escapeVCard(s: string): string {
  return s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

function buildBusinessCardSvg(opts: {
  name: string; tagline: string; brandColor: string;
  mechanic: User; links: AmplificationKit["links"];
}): string {
  // Standard US business card 3.5" x 2" at 300dpi → 1050 x 600 px.
  const { name, tagline, brandColor, mechanic, links } = opts;
  const refCode = mechanic.referralCode ?? "";
  const region = mechanic.city ?? mechanic.region ?? "";
  const safeName = escapeXml(name);
  const safeTag = escapeXml(tagline);
  const safeRegion = escapeXml(region);
  const safeRef = escapeXml(refCode);
  const safeUrl = escapeXml(links.personalBookingLink);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="600" viewBox="0 0 1050 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F172A"/>
      <stop offset="1" stop-color="#1E293B"/>
    </linearGradient>
  </defs>
  <rect width="1050" height="600" fill="url(#bg)"/>
  <rect x="0" y="0" width="14" height="600" fill="${brandColor}"/>
  <text x="60" y="120" fill="#fff" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="48" font-weight="800">${safeName}</text>
  <text x="60" y="170" fill="${brandColor}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" font-weight="700">VERIFIED APS MECHANIC</text>
  <text x="60" y="240" fill="#CBD5E1" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="22">${safeTag}</text>
  <text x="60" y="320" fill="#94A3B8" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="20">Service area: ${safeRegion}</text>
  <text x="60" y="410" fill="#fff" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="20" font-weight="700">Book with me on APS</text>
  <text x="60" y="445" fill="#CBD5E1" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="18">${safeUrl}</text>
  <text x="60" y="515" fill="${brandColor}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" font-weight="800">REFERRAL CODE</text>
  <text x="60" y="555" fill="#fff" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="34" font-weight="800" letter-spacing="3">${safeRef}</text>
  <rect x="800" y="370" width="200" height="200" fill="#fff" rx="8"/>
  <text x="900" y="475" fill="#0F172A" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="16" font-weight="700">QR CODE</text>
  <text x="900" y="500" fill="#475569" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13">Embed PNG client-side</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

function buildPostStarters(
  displayName: string,
  mechanic: User,
  links: AmplificationKit["links"],
): AmplificationKit["socialPostStarters"] {
  const code = mechanic.referralCode ?? "APS";
  const region = mechanic.city ?? mechanic.region ?? "your area";
  return [
    {
      platform: "facebook",
      text: `Hi ${region} — ${displayName} here. I take APS jobs because every service goes into the vehicle's permanent VIN history, so the next owner sees the truth too. If you've been putting off a repair, book with me on APS using code ${code}: ${links.personalBookingLink}`,
    },
    {
      platform: "instagram",
      text: `Verified APS mechanic in ${region}. Transparent pricing, every job tied to your VIN history. Tap link, code ${code}. ${links.personalBookingLink}\n\n#APS #LocalMechanic #${region.replace(/\s+/g, "")} #AutoRepair #VINHistory`,
    },
    {
      platform: "tiktok",
      text: `POV: your mechanic actually documents every repair to your VIN. Book me on APS — code ${code}. #fyp #carrepair #mechanic #APS`,
    },
    {
      platform: "twitter",
      text: `Verified APS mechanic in ${region}. Book with me, code ${code}. ${links.personalBookingLink}`,
    },
  ];
}

/** Small helper for the public landing route. Plain HTML, no auth. */
export function renderLandingHtml(kit: AmplificationKit): string {
  const m = kit.mechanic;
  const page = kit.page;
  const brand = page?.brandColor ?? "#F97316";
  const name = escapeXml(m.name);
  const tagline = escapeXml(page?.tagline ?? "Verified APS mechanic — book trusted local repair.");
  const bio = escapeXml(page?.bio ?? "");
  const region = escapeXml(m.city ?? m.region ?? "");
  const refCode = escapeXml(m.referralCode ?? "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — Book on APS</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, system-ui, sans-serif; background: #0F172A; color: #F8FAFC; line-height: 1.5; min-height: 100vh; }
  .wrap { max-width: 540px; margin: 0 auto; padding: 32px 20px 80px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: ${brand}22; color: ${brand}; font-weight: 700; font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; }
  h1 { font-size: 32px; margin: 14px 0 6px; line-height: 1.15; }
  .tagline { color: #CBD5E1; font-size: 16px; margin-bottom: 16px; }
  .region { color: #94A3B8; font-size: 14px; }
  .card { background: #1E293B; border: 1px solid #334155; border-radius: 16px; padding: 20px; margin-top: 20px; }
  .qr { background: #fff; padding: 14px; border-radius: 12px; display: flex; justify-content: center; }
  .qr img { width: 100%; max-width: 240px; }
  .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; letter-spacing: 2px; color: ${brand}; font-weight: 800; text-align: center; padding: 8px 0; }
  .btn { display: block; width: 100%; padding: 14px 18px; border-radius: 12px; background: ${brand}; color: #0F172A; font-weight: 800; text-align: center; text-decoration: none; margin-top: 10px; font-size: 15px; }
  .btn.secondary { background: transparent; color: #fff; border: 1px solid #334155; }
  .footnote { color: #64748B; font-size: 11px; margin-top: 30px; text-align: center; }
  .bio { color: #CBD5E1; font-size: 14px; white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">Verified APS Mechanic</span>
    <h1>${name}</h1>
    <div class="tagline">${tagline}</div>
    <div class="region">${region}</div>

    <div class="card">
      <div class="qr"><img alt="Booking QR" src="${kit.qrPngDataUrl}"></div>
      ${refCode ? `<div class="ref">Code: ${refCode}</div>` : ""}
      <a class="btn" href="${escapeXml(kit.links.appStoreLink)}">Get APS on iOS</a>
      <a class="btn secondary" href="${escapeXml(kit.links.playStoreLink)}">Get APS on Android</a>
    </div>

    ${bio ? `<div class="card"><div class="bio">${bio}</div></div>` : ""}

    <div class="footnote">APS — Automotive Platform System. Every repair documented to the VIN. No autonomous publishing — this page is shared by your mechanic.</div>
  </div>
</body>
</html>`;
}
