/**
 * Incremental Part 6 development migration for booking history.
 *
 * The base Part 6 bay migration may already have been applied. This migration
 * is intentionally independent and additive: it drops only the old
 * job_id-only uniqueness object after inspecting the live catalog, then adds
 * a partial unique index. No booking rows or IDs are rewritten.
 *
 *   node scripts/src/migrate_partner_part6_bay_booking_history.mjs
 */
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Part 6 booking-history migration is development-only and cannot run in production.");
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
    DO $$
    DECLARE
      old_constraint text;
      old_index text;
    BEGIN
      -- Drizzle development databases may have represented the old
      -- UNIQUE(job_id) as either a constraint or a unique index. Inspect
      -- pg_catalog rather than assuming one generated object name.
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
  "Part 6 booking-history migration ready/applied (terminal rows preserved; no backfill).\n",
);