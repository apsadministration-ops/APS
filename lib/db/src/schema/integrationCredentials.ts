/**
 * Integration Credentials store — encrypted-at-rest API keys / tokens for
 * external services (OpenAI BYO key, Facebook Pages, Instagram Graph,
 * TikTok, X). Admin enters values through the Growth → Integrations UI;
 * runtime code reads them via `credentialStore.getCredential(key)` which
 * AES-256-GCM-decrypts on read.
 *
 * Plaintext values NEVER leave the server. The list endpoint only returns
 * `{ key, configured, updatedAt, updatedById }` — never the secret value.
 */
import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const integrationCredentialsTable = pgTable("integration_credentials", {
  id: serial("id").primaryKey(),
  /** Canonical key from `integrationCatalog` (e.g. "facebook_page_token"). */
  key: text("key").notNull().unique(),
  /** AES-256-GCM ciphertext encoded as "iv:authTag:ciphertext" (all base64). */
  valueEncrypted: text("value_encrypted").notNull(),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  keyIdx: index("integration_credentials_key_idx").on(t.key),
}));

export type IntegrationCredential = typeof integrationCredentialsTable.$inferSelect;
