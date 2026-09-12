/**
 * Read-only Part 5 baseline/preflight report. This deliberately does not
 * create tables or change rows.
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM partner_organizations) AS organizations,
      (SELECT count(*)::integer FROM shops) AS locations,
      (SELECT count(*)::integer FROM vehicles) AS vehicles,
      (SELECT count(*)::integer FROM ownership_history) AS ownership_history,
      (SELECT count(*)::integer FROM partner_vehicle_operations) AS vehicle_operations
  `);
  const serviceTable = await client.query(
    "SELECT to_regclass('public.partner_service_requests') IS NOT NULL AS present",
  );
  const historyTable = await client.query(
    "SELECT to_regclass('public.partner_service_request_status_history') IS NOT NULL AS present",
  );
  let serviceRequests = 0;
  let statusHistory = 0;
  let duplicateClientRequestIds = { rows: [] };
  if (serviceTable.rows[0]?.present) {
    const serviceCount = await client.query(
      "SELECT count(*)::integer AS count FROM partner_service_requests",
    );
    serviceRequests = serviceCount.rows[0].count;
    duplicateClientRequestIds = await client.query(`
      SELECT organization_id, client_request_id, count(*)::integer AS count
      FROM partner_service_requests
      GROUP BY organization_id, client_request_id
      HAVING count(*) > 1
      ORDER BY organization_id, client_request_id
    `);
  }
  if (historyTable.rows[0]?.present) {
    const historyCount = await client.query(
      "SELECT count(*)::integer AS count FROM partner_service_request_status_history",
    );
    statusHistory = historyCount.rows[0].count;
  }

  process.stdout.write(JSON.stringify({
    baselineCounts: {
      ...counts.rows[0],
      service_requests: serviceRequests,
      status_history: statusHistory,
    },
    duplicateClientRequestIds: duplicateClientRequestIds.rows,
    migrationSafe: duplicateClientRequestIds.rows.length === 0,
  }, null, 2) + "\n");
} finally {
  await client.end();
}