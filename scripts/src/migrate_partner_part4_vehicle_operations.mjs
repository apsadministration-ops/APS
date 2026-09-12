/**
 * Additive, idempotent Part 4 migration. Review the read-only preflight first:
 *
 *   node scripts/src/report_partner_part4_vehicle_operations.mjs
 *   node scripts/src/migrate_partner_part4_vehicle_operations.mjs
 *
 * No existing organizations, locations, vehicles, ownership rows, or
 * classifications are backfilled or reassigned by this migration.
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    -- Required as the target of the operation table's composite FK.
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shops_organization_id_id_unique'
          AND conrelid = 'shops'::regclass
      ) THEN
        ALTER TABLE shops
          ADD CONSTRAINT shops_organization_id_id_unique
          UNIQUE (organization_id, id);
      END IF;
    END $$;

    -- Canonical VINs are unique globally, including case variants.
    CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin_lower_unique
      ON vehicles (lower(vin));

    CREATE TABLE IF NOT EXISTS partner_vehicle_operations (
      id                     serial PRIMARY KEY,
      organization_id       integer NOT NULL
        REFERENCES partner_organizations(id),
      vehicle_id             integer NOT NULL
        REFERENCES vehicles(id),
      linked_shop_id         integer NOT NULL,
      stock_number           text,
      inventory_status       text,
      service_needed         boolean,
      service_notes          text,
      unit_number            text,
      group_name             text,
      operating_status       text,
      odometer               integer,
      usage_hours            double precision,
      maintenance_due_date   date,
      maintenance_due_mileage integer,
      downtime_since        timestamptz,
      notes                  text,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT partner_vehicle_operations_inventory_status_check
        CHECK (
          inventory_status IS NULL OR
          inventory_status IN ('in_stock', 'preparing', 'ready', 'sold')
        ),
      CONSTRAINT partner_vehicle_operations_operating_status_check
        CHECK (
          operating_status IS NULL OR
          operating_status IN ('active', 'maintenance', 'out_of_service', 'retired')
        ),
      CONSTRAINT partner_vehicle_operations_nonnegative_check
        CHECK (
          (odometer IS NULL OR odometer >= 0) AND
          (usage_hours IS NULL OR usage_hours >= 0) AND
          (maintenance_due_mileage IS NULL OR maintenance_due_mileage >= 0)
        ),
      CONSTRAINT partner_vehicle_operations_vehicle_unique
        UNIQUE (vehicle_id)
    );

    CREATE INDEX IF NOT EXISTS partner_vehicle_operations_org_idx
      ON partner_vehicle_operations (organization_id);
    CREATE INDEX IF NOT EXISTS partner_vehicle_operations_shop_idx
      ON partner_vehicle_operations (linked_shop_id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'partner_vehicle_operations_org_shop_fk'
          AND conrelid = 'partner_vehicle_operations'::regclass
      ) THEN
        ALTER TABLE partner_vehicle_operations
          ADD CONSTRAINT partner_vehicle_operations_org_shop_fk
          FOREIGN KEY (organization_id, linked_shop_id)
          REFERENCES shops (organization_id, id);
      END IF;
    END $$;
  `);
  await client.query("COMMIT");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original migration error if PostgreSQL cannot roll back.
  }
  throw error;
} finally {
  await client.end();
}

process.stdout.write(
  "Partner Part 4 vehicle-operation migration ready/applied (additive; no backfill).\n",
);