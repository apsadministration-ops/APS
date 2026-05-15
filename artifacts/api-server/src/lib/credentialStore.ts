/**
 * Credential store — AES-256-GCM-encrypted persistence for external API
 * keys (OpenAI BYO, Facebook/Instagram/TikTok/X tokens). Plaintext values
 * never leave this module: routes can read the value to use it internally,
 * but `listCredentialStatus()` deliberately omits the value field.
 *
 * Encryption key is derived from `SESSION_SECRET` via scrypt — same secret
 * the rest of the platform already depends on, so rotating SESSION_SECRET
 * invalidates encrypted credentials (intentional — re-enter on rotation).
 *
 * The store maintains an in-memory `Set<key>` of currently-configured
 * credentials so `hasCredentialSync()` can be called from synchronous code
 * paths (e.g. `PostingProvider.isConfigured()`). The set is hydrated at
 * boot via `loadCredentialCache()` and kept fresh on every set/delete.
 */
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, integrationCredentialsTable } from "@workspace/db";
import {
  INTEGRATION_CREDENTIALS,
  INTEGRATION_GROUPS,
  findCredentialDef,
  type IntegrationGroupKey,
} from "./integrationCatalog";
import { logger } from "./logger";

const ALGO = "aes-256-gcm";
const KDF_SALT = "aps-credential-store-v1";

// In-memory state ------------------------------------------------------------

/**
 * Keys that currently have a row in `integration_credentials` (DB-backed).
 * Used by `hasCredentialSync()` ONLY — `getCredential()` is DB-authoritative
 * regardless of this cache so a stale/missing cache can never hide a
 * legitimately-saved credential. Writes always update this set
 * synchronously alongside the DB row to keep the sync probe honest.
 */
const dbConfigured = new Set<string>();

/**
 * Hydrate state guard. Mutations bump the revision so a late-finishing
 * `loadCredentialCache()` cannot clobber an entry that was set/deleted
 * after hydrate started.
 */
let hydrateRevision = 0;

let cachedEncryptionKey: Buffer | null = null;
function encryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "credentialStore: SESSION_SECRET is required (>=16 chars) for credential encryption",
    );
  }
  cachedEncryptionKey = crypto.scryptSync(secret, KDF_SALT, 32);
  return cachedEncryptionKey;
}

// Encryption helpers ---------------------------------------------------------

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("credentialStore: malformed ciphertext");
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// Public API -----------------------------------------------------------------

/**
 * Hydrate the configured-key set from DB. Awaited at server boot before
 * schedulers start. If a `setCredential`/`deleteCredential` lands while
 * we're querying, we skip the clobber and let those writes stand — the
 * revision check guarantees newer in-memory state wins over a slow read.
 */
export async function loadCredentialCache(): Promise<void> {
  const revisionAtStart = hydrateRevision;
  try {
    const rows = await db.select({ key: integrationCredentialsTable.key })
      .from(integrationCredentialsTable);
    if (revisionAtStart !== hydrateRevision) {
      logger.warn({ rows: rows.length }, "Credential cache hydrate skipped — newer mutation occurred mid-load");
      return;
    }
    dbConfigured.clear();
    for (const r of rows) dbConfigured.add(r.key);
    logger.info({ count: rows.length }, "Credential cache loaded");
  } catch (err) {
    logger.error({ err }, "Failed to hydrate credential cache");
  }
}

/**
 * Sync configuration probe — true if either a DB row exists OR the env
 * fallback is set. Safe for `isConfigured()` calls on hot paths.
 */
export function hasCredentialSync(key: string): boolean {
  if (dbConfigured.has(key)) return true;
  const def = findCredentialDef(key);
  if (def?.envFallback && process.env[def.envFallback]) return true;
  return false;
}

/**
 * Read the plaintext value. DB-authoritative: queries the table on every
 * call regardless of cache state so a missing/stale cache can never hide
 * a legitimately-saved credential. Falls back to the env var when no DB
 * row exists. Used by adapter code (`fetch` calls etc.) — never by
 * anything that returns a response to the client.
 */
export async function getCredential(key: string): Promise<string | null> {
  const [row] = await db.select().from(integrationCredentialsTable)
    .where(eq(integrationCredentialsTable.key, key));
  if (row) {
    // Keep cache honest for future sync probes.
    dbConfigured.add(key);
    try {
      return decrypt(row.valueEncrypted);
    } catch (err) {
      logger.error({ err, key }, "credentialStore: decrypt failed — corrupt row");
      return null;
    }
  }
  // No DB row — env fallback only.
  dbConfigured.delete(key);
  const def = findCredentialDef(key);
  if (def?.envFallback) return process.env[def.envFallback] ?? null;
  return null;
}

/** Upsert a credential. Trims whitespace; empty strings are rejected. */
export async function setCredential(
  key: string,
  value: string,
  updatedById: number | null,
): Promise<void> {
  const def = findCredentialDef(key);
  if (!def) throw new Error(`Unknown credential key: ${key}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Credential value must not be empty");

  const ciphertext = encrypt(trimmed);
  await db.insert(integrationCredentialsTable).values({
    key,
    valueEncrypted: ciphertext,
    updatedById,
  }).onConflictDoUpdate({
    target: integrationCredentialsTable.key,
    set: { valueEncrypted: ciphertext, updatedById, updatedAt: new Date() },
  });
  dbConfigured.add(key);
  hydrateRevision++; // invalidate any in-flight hydrate
}

export async function deleteCredential(key: string): Promise<void> {
  await db.delete(integrationCredentialsTable)
    .where(eq(integrationCredentialsTable.key, key));
  dbConfigured.delete(key);
  hydrateRevision++; // invalidate any in-flight hydrate
}

// Status reporting (never returns plaintext) ---------------------------------

export interface CredentialStatusRow {
  key: string;
  group: IntegrationGroupKey;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  configured: boolean;
  /** Where the configured value is coming from. */
  source: "db" | "env" | "none";
  updatedAt: string | null;
}

export interface IntegrationGroupStatus {
  key: IntegrationGroupKey;
  label: string;
  description: string;
  docsUrl: string;
  icon: string;
  color: string;
  /** True only when every `required` credential in the group is configured. */
  fullyConfigured: boolean;
  credentials: CredentialStatusRow[];
}

export async function listIntegrationStatus(): Promise<IntegrationGroupStatus[]> {
  const rows = await db.select({
    key: integrationCredentialsTable.key,
    updatedAt: integrationCredentialsTable.updatedAt,
  }).from(integrationCredentialsTable);
  const dbMap = new Map(rows.map((r) => [r.key, r.updatedAt]));

  return INTEGRATION_GROUPS.map((group) => {
    const credentials: CredentialStatusRow[] = INTEGRATION_CREDENTIALS
      .filter((c) => c.group === group.key)
      .map((c) => {
        const dbUpdated = dbMap.get(c.key);
        const envHit = !!(c.envFallback && process.env[c.envFallback]);
        const source: CredentialStatusRow["source"] = dbUpdated ? "db" : envHit ? "env" : "none";
        return {
          key: c.key,
          group: c.group,
          label: c.label,
          description: c.description,
          required: c.required,
          secret: c.secret,
          configured: source !== "none",
          source,
          updatedAt: dbUpdated ? dbUpdated.toISOString() : null,
        };
      });
    const fullyConfigured = credentials
      .filter((c) => c.required)
      .every((c) => c.configured);
    return { ...group, credentials, fullyConfigured };
  });
}
