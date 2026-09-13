/**
 * Additive, development-only Part 6 migration.
 *
 * Review the target database before running. This script deliberately does
 * not backfill bookings, change booking statuses, or apply itself as part of
 * the API startup. Existing rows retain their legacy behavior:
 * empty availability_config means available at any time.
 *
 *   node scripts/src/migrate_partner_part6_bays.mjs
 */
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Partner Part 6 bay migration is development-only and cannot run in production.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    ALTER TABLE bays
      ADD COLUMN IF NOT EXISTS availability_config jsonb NOT NULL DEFAULT '{}'::jsonb;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bay_bookings_part6_status_check'
          AND conrelid = 'bay_bookings'::regclass
      ) THEN
        ALTER TABLE bay_bookings
          ADD CONSTRAINT bay_bookings_part6_status_check
          CHECK (status IN ('pending', 'rejected', 'reserved', 'active', 'completed', 'cancelled'));
      END IF;
    END $$;

    DO $$
    DECLARE
      old_constraint text;
      old_index text;
    BEGIN
      -- Earlier development schema revisions used a full UNIQUE(job_id)
      -- constraint or index. Inspect both catalogs so this remains safe after
      -- either form has already been applied; never delete any booking row.
      FOR old_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'bay_bookings'::regclass
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) ILIKE 'UNIQUE (job_id)%'
          AND c.conname <> 'bay_bookings_job_id_live_unique'
      LOOP
        EXECUTE format('ALTER TABLE bay_bookings DROP CONSTRAINT IF EXISTS %I', old_constraint);
      END LOOP;

      FOR old_index IN
        SELECT i.indexname
        FROM pg_indexes i
        WHERE i.schemaname = current_schema()
          AND i.tablename = 'bay_bookings'
          AND i.indexname <> 'bay_bookings_job_id_live_unique'
          AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%'
          AND i.indexdef ILIKE '%(job_id)%'
          AND i.indexdef NOT ILIKE '% WHERE %'
      LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), old_index);
      END LOOP;
    END $$;

    CREATE INDEX IF NOT EXISTS bay_bookings_approved_interval_idx
      ON bay_bookings (bay_id, start_time, estimated_end_time)
      WHERE status IN ('reserved', 'active');

    CREATE UNIQUE INDEX IF NOT EXISTS bay_bookings_job_id_live_unique
      ON bay_bookings (job_id)
      WHERE status IN ('pending', 'reserved', 'active');
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
  "Partner Part 6 Ghost Garage bay migration ready/applied (additive; no backfill).\n",
);