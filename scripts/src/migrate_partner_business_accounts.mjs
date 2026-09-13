/**
 * Development-only additive correction for business-first organization
 * accounts. Apply only to the development database after reviewing the
 * existing partner organization schema. This script deliberately does not
 * backfill legacy Stripe IDs, rewrite rows, create locations, or target
 * production.
 *
 *   node scripts/src/migrate_partner_business_accounts.mjs
 */
import pg from "pg";

if (process.env.NODE_ENV !== "development") {
  throw new Error(
    "Business-account schema correction requires NODE_ENV=development",
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    ALTER TABLE partner_organizations
      ADD COLUMN IF NOT EXISTS legal_name text,
      ADD COLUMN IF NOT EXISTS stripe_account_id text,
      ADD COLUMN IF NOT EXISTS stripe_account_ready integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS stripe_account_type text;

    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS payout_organization_id integer,
      ADD COLUMN IF NOT EXISTS payout_account_id text;

    ALTER TABLE payout_events
      ADD COLUMN IF NOT EXISTS organization_id integer;

    CREATE UNIQUE INDEX IF NOT EXISTS partner_organizations_stripe_account_id_unique
      ON partner_organizations (stripe_account_id)
      WHERE stripe_account_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS payments_payout_organization_idx
      ON payments (payout_organization_id);
    CREATE INDEX IF NOT EXISTS payments_payout_account_idx
      ON payments (payout_account_id);
    CREATE INDEX IF NOT EXISTS payout_events_organization_idx
      ON payout_events (organization_id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'partner_organizations_stripe_account_type_check'
          AND conrelid = 'partner_organizations'::regclass
      ) THEN
        ALTER TABLE partner_organizations
          ADD CONSTRAINT partner_organizations_stripe_account_type_check
          CHECK (
            stripe_account_type IS NULL
            OR stripe_account_type IN ('individual', 'company')
          );
      END IF;
    END $$;
  `);
  await client.query("COMMIT");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original migration error.
  }
  throw error;
} finally {
  await client.end();
}

process.stdout.write(
  "Business-account schema correction applied (additive; no backfill or location creation).\n",
);