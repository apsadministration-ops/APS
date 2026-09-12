/**
 * Read-only preflight for the additive Part 4 migration. Review this report
 * before applying migrate_partner_part4_vehicle_operations.mjs; this script
 * does not modify rows or create schema.
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const duplicateVins = await client.query(`
    SELECT lower(vin) AS normalized_vin, count(*)::integer AS count
    FROM vehicles
    GROUP BY lower(vin)
    HAVING count(*) > 1
    ORDER BY count DESC, normalized_vin
  `);
  const invalidOwnerShops = await client.query(`
    SELECT v.id, v.owner_shop_id
    FROM vehicles v
    LEFT JOIN shops s ON s.id = v.owner_shop_id
    WHERE v.owner_shop_id IS NOT NULL
      AND s.id IS NULL
    ORDER BY v.id
  `);

  process.stdout.write(
    JSON.stringify(
      {
        duplicateNormalizedVins: duplicateVins.rows,
        vehiclesWithMissingOwnerShop: invalidOwnerShops.rows,
        migrationSafe:
          duplicateVins.rows.length === 0 &&
          invalidOwnerShops.rows.length === 0,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client.end();
}