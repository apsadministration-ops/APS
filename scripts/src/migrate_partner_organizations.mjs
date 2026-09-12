/**
 * Additive, idempotent migration for the Part 2 partner organization
 * foundation. This script intentionally does not backfill or reclassify
 * existing shops. Run only after reviewing the companion report:
 *
 *   node scripts/src/report_partner_organizations.mjs
 *   node scripts/src/migrate_partner_organizations.mjs
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS partner_organizations (
      id               serial PRIMARY KEY,
      primary_owner_id integer NOT NULL REFERENCES users(id),
      name             text NOT NULL,
      subtype          text NOT NULL,
      contact_name     text,
      phone            text NOT NULL,
      email            text NOT NULL,
      address          text NOT NULL,
      city             text NOT NULL,
      region           text NOT NULL,
      zip_code         text,
      status           text NOT NULL DEFAULT 'active',
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT partner_organizations_subtype_check
        CHECK (subtype IN ('shop', 'dealership', 'fleet', 'commercial_business')),
      CONSTRAINT partner_organizations_status_check
        CHECK (status IN ('active', 'inactive')),
      CONSTRAINT partner_organizations_id_owner_unique
        UNIQUE (id, primary_owner_id)
    );

    ALTER TABLE shops
      ADD COLUMN IF NOT EXISTS organization_id integer;

    CREATE INDEX IF NOT EXISTS partner_organizations_owner_id_idx
      ON partner_organizations (primary_owner_id);
    CREATE INDEX IF NOT EXISTS partner_organizations_status_idx
      ON partner_organizations (status);
    CREATE INDEX IF NOT EXISTS shops_organization_id_idx
      ON shops (organization_id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shops_organization_owner_fk'
          AND conrelid = 'shops'::regclass
      ) THEN
        ALTER TABLE shops
          ADD CONSTRAINT shops_organization_owner_fk
          FOREIGN KEY (organization_id, owner_id)
          REFERENCES partner_organizations (id, primary_owner_id);
      END IF;
    END $$;
  `);
  await client.query("COMMIT");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original migration error if the connection is already
    // unusable and PostgreSQL cannot accept the rollback.
  }
  throw error;
} finally {
  await client.end();
}

process.stdout.write(
  "Partner organization migration applied (additive; existing shops remain unlinked).\n",
);