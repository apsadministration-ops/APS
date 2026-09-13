/**
 * Additive, DEV-only Part 6 migration.
 *
 * Review the existing Part 1–5 baselines before applying this script. It adds
 * only the bidirectional APS source link needed by the explicit Send to APS
 * bridge; it does not backfill service requests/jobs or change ownership,
 * fees, bays, bookings, worklogs, or customer data.
 *
 * Do not run automatically. Main-agent coordination is required before this
 * migration is applied to a development database.
 */
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Partner Part 6 commercial migration is development-only and cannot run in production.");
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
    ALTER TABLE jobs
      ADD COLUMN IF NOT EXISTS source_organization_id integer,
      ADD COLUMN IF NOT EXISTS source_service_request_id integer;

    ALTER TABLE partner_service_requests
      ADD COLUMN IF NOT EXISTS linked_aps_job_id integer,
      ADD COLUMN IF NOT EXISTS linked_at timestamptz,
      ADD COLUMN IF NOT EXISTS send_to_aps_fingerprint text;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'jobs_source_organization_fk'
          AND conrelid = 'jobs'::regclass
      ) THEN
        ALTER TABLE jobs
          ADD CONSTRAINT jobs_source_organization_fk
          FOREIGN KEY (source_organization_id)
          REFERENCES partner_organizations(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'jobs_source_service_request_fk'
          AND conrelid = 'jobs'::regclass
      ) THEN
        ALTER TABLE jobs
          ADD CONSTRAINT jobs_source_service_request_fk
          FOREIGN KEY (source_service_request_id)
          REFERENCES partner_service_requests(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'partner_service_requests_linked_aps_job_fk'
          AND conrelid = 'partner_service_requests'::regclass
      ) THEN
        ALTER TABLE partner_service_requests
          ADD CONSTRAINT partner_service_requests_linked_aps_job_fk
          FOREIGN KEY (linked_aps_job_id)
          REFERENCES jobs(id);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS jobs_source_organization_id_idx
      ON jobs (source_organization_id);

    CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_org_request_unique
      ON jobs (source_organization_id, source_service_request_id);

    CREATE UNIQUE INDEX IF NOT EXISTS partner_service_requests_linked_aps_job_unique
      ON partner_service_requests (linked_aps_job_id)
      WHERE linked_aps_job_id IS NOT NULL;
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
  "Partner Part 6 commercial bridge migration ready/applied (additive; no backfill).\n",
);