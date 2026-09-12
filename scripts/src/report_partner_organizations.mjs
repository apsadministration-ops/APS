/**
 * Read-only preflight report for the Part 2 additive migration. It does not
 * write schema or data, and is safe to run before the migration is applied.
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const existing = await client.query(`
    SELECT
      to_regclass('public.partner_organizations') AS partner_organizations,
      to_regclass('public.shops') AS shops
  `);
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'partner_organizations')
        OR (table_name = 'shops' AND column_name = 'organization_id')
      )
    ORDER BY table_name, ordinal_position
  `);
  const hasOrganizationColumn = columns.rows.some(
    (row) => row.table_name === "shops" && row.column_name === "organization_id",
  );
  const linked = await client.query(hasOrganizationColumn ? `
    SELECT
      COUNT(*)::integer AS shop_count,
      COUNT(organization_id)::integer AS linked_shop_count
    FROM shops
  ` : `SELECT COUNT(*)::integer AS shop_count, 0::integer AS linked_shop_count FROM shops`);
  process.stdout.write(
    JSON.stringify(
      {
        relations: existing.rows[0],
        columns: columns.rows,
        shopCounts: linked.rows[0],
        organizationColumnPresent: hasOrganizationColumn,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client.end();
}