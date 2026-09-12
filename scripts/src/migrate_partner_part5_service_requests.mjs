/**
 * Additive, idempotent Part 5 migration. Review the read-only preflight first:
 *
 *   node scripts/src/report_partner_part5_service_requests.mjs
 *   node scripts/src/migrate_partner_part5_service_requests.mjs
 *
 * No request rows are backfilled and no existing ownership, operation,
 * vehicle, location, or organization rows are modified.
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'partner_vehicle_operations_org_id_vehicle_unique'
          AND conrelid = 'partner_vehicle_operations'::regclass
      ) THEN
        ALTER TABLE partner_vehicle_operations
          ADD CONSTRAINT partner_vehicle_operations_org_id_vehicle_unique
          UNIQUE (organization_id, id, vehicle_id);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS partner_service_requests (
      id                  serial PRIMARY KEY,
      organization_id     integer NOT NULL REFERENCES partner_organizations(id),
      operation_id        integer NOT NULL,
      vehicle_id          integer NOT NULL,
      source_subtype      text NOT NULL,
      location_id         integer NOT NULL,
      status              text NOT NULL DEFAULT 'draft',
      category            text NOT NULL,
      urgency             text NOT NULL DEFAULT 'normal',
      requested_work      text NOT NULL,
      service_notes       text,
      creation_context    jsonb NOT NULL,
      client_request_id   text NOT NULL,
      creation_fingerprint text NOT NULL,
      version             integer NOT NULL DEFAULT 0,
      created_at          timestamptz NOT NULL DEFAULT now(),
      submitted_at       timestamptz,
      started_at         timestamptz,
      completed_at       timestamptz,
      cancelled_at       timestamptz,
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT partner_service_requests_org_operation_vehicle_fk
        FOREIGN KEY (organization_id, operation_id, vehicle_id)
        REFERENCES partner_vehicle_operations (organization_id, id, vehicle_id),
      CONSTRAINT partner_service_requests_org_location_fk
        FOREIGN KEY (organization_id, location_id)
        REFERENCES shops (organization_id, id),
      CONSTRAINT partner_service_requests_org_client_request_id_unique
        UNIQUE (organization_id, client_request_id),
      CONSTRAINT partner_service_requests_status_check
        CHECK (status IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled')),
      CONSTRAINT partner_service_requests_category_check
        CHECK (category IN ('inspection', 'diagnostics', 'maintenance', 'repair', 'recall', 'other')),
      CONSTRAINT partner_service_requests_urgency_check
        CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
      CONSTRAINT partner_service_requests_subtype_check
        CHECK (source_subtype IN ('dealership', 'fleet')),
      CONSTRAINT partner_service_requests_version_check
        CHECK (version >= 0)
    );

    CREATE TABLE IF NOT EXISTS partner_service_request_status_history (
      id            serial PRIMARY KEY,
      request_id    integer NOT NULL REFERENCES partner_service_requests(id),
      actor_user_id integer NOT NULL REFERENCES users(id),
      from_status   text,
      to_status     text NOT NULL,
      note          text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT partner_service_request_status_history_to_status_check
        CHECK (to_status IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled')),
      CONSTRAINT partner_service_request_status_history_from_status_check
        CHECK (from_status IS NULL OR from_status IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled'))
    );

    CREATE INDEX IF NOT EXISTS partner_service_requests_org_idx
      ON partner_service_requests (organization_id);
    CREATE INDEX IF NOT EXISTS partner_service_requests_operation_idx
      ON partner_service_requests (operation_id);
    CREATE INDEX IF NOT EXISTS partner_service_requests_vehicle_idx
      ON partner_service_requests (vehicle_id);
    CREATE INDEX IF NOT EXISTS partner_service_requests_location_idx
      ON partner_service_requests (location_id);
    CREATE INDEX IF NOT EXISTS partner_service_requests_status_idx
      ON partner_service_requests (status);
    CREATE INDEX IF NOT EXISTS partner_service_request_status_history_request_idx
      ON partner_service_request_status_history (request_id, created_at);
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
  "Partner Part 5 service-request migration ready/applied (additive; no backfill).\n",
);