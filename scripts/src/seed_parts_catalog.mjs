/**
 * Seed ~30 catalog entries + fitments + aps-curated offers across
 * Ford / Toyota / Honda / Chevy / Subaru.
 *
 * Idempotent: keys on (brand, oem_part_number).
 *
 * Run: node scripts/src/seed_parts_catalog.mjs
 */
import pg from "pg";

const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

/**
 * Each entry is one catalog row + N fitment rows + 1 aps-curated offer.
 * Keep prices realistic — these surface to mechanics during ordering.
 */
const SEED = [
  // ---------- OIL FILTERS ----------
  { cat: "oil_filter", brand: "Motorcraft", pn: "FL-820S", name: 'Oil Filter (3.5L EcoBoost / 5.0L Coyote)', tier: "oem", warranty: 12, msrp: 1099, fits: [{ make: "Ford", model: "F-150", yMin: 2011, yMax: 2024 }] },
  { cat: "oil_filter", brand: "Toyota OEM", pn: "04152-YZZA1", name: "Oil Filter Cartridge", tier: "oem", warranty: 12, msrp: 899, fits: [{ make: "Toyota", model: "Camry", yMin: 2007, yMax: 2024 }, { make: "Toyota", model: "RAV4", yMin: 2008, yMax: 2024 }] },
  { cat: "oil_filter", brand: "Honda OEM", pn: "15400-PLM-A02", name: "Oil Filter (1.5L/2.0L i-VTEC)", tier: "oem", warranty: 12, msrp: 799, fits: [{ make: "Honda", model: "Civic", yMin: 2006, yMax: 2024 }, { make: "Honda", model: "Accord", yMin: 2008, yMax: 2024 }] },
  { cat: "oil_filter", brand: "ACDelco", pn: "PF63", name: "Professional Oil Filter (Dexos)", tier: "oem", warranty: 12, msrp: 999, fits: [{ make: "Chevrolet", model: "Silverado", yMin: 2014, yMax: 2024 }, { make: "Chevrolet", model: "Equinox", yMin: 2010, yMax: 2024 }] },
  { cat: "oil_filter", brand: "Subaru OEM", pn: "15208AA15A", name: "Oil Filter Cartridge (FB/FA)", tier: "oem", warranty: 12, msrp: 999, fits: [{ make: "Subaru", model: "Outback", yMin: 2013, yMax: 2024 }, { make: "Subaru", model: "Forester", yMin: 2011, yMax: 2024 }] },

  // ---------- AIR FILTERS ----------
  { cat: "air_filter", brand: "Motorcraft", pn: "FA-1883", name: "Engine Air Filter", tier: "oem", warranty: 12, msrp: 2499, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }] },
  { cat: "air_filter", brand: "Toyota OEM", pn: "17801-31170", name: "Engine Air Filter", tier: "oem", warranty: 12, msrp: 2299, fits: [{ make: "Toyota", model: "Camry", yMin: 2018, yMax: 2024 }, { make: "Toyota", model: "RAV4", yMin: 2019, yMax: 2024 }] },
  { cat: "air_filter", brand: "Fram", pn: "CA10755", name: "Extra Guard Engine Air Filter", tier: "standard", warranty: 6, msrp: 1599, fits: [{ make: "Honda", model: "Civic", yMin: 2012, yMax: 2024 }] },

  // ---------- CABIN FILTERS ----------
  { cat: "cabin_filter", brand: "Toyota OEM", pn: "87139-YZZ20", name: "Cabin Air Filter (Carbon)", tier: "oem", warranty: 12, msrp: 2999, fits: [{ make: "Toyota", model: "Camry", yMin: 2007, yMax: 2024 }, { make: "Toyota", model: "RAV4", yMin: 2013, yMax: 2024 }] },
  { cat: "cabin_filter", brand: "Honda OEM", pn: "80292-T0G-A01", name: "Cabin Air Filter", tier: "oem", warranty: 12, msrp: 2499, fits: [{ make: "Honda", model: "Civic", yMin: 2012, yMax: 2024 }, { make: "Honda", model: "Accord", yMin: 2013, yMax: 2024 }] },

  // ---------- BRAKE PADS FRONT ----------
  { cat: "brake_pads_front", brand: "Motorcraft", pn: "BR-1414", name: "Front Brake Pads (F-150)", tier: "oem", warranty: 24, msrp: 8999, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }] },
  { cat: "brake_pads_front", brand: "Akebono", pn: "ACT787", name: "ProACT Ultra-Premium Ceramic Front Pads", tier: "premium", warranty: 36, msrp: 7499, fits: [{ make: "Toyota", model: "Camry", yMin: 2012, yMax: 2024 }, { make: "Honda", model: "Accord", yMin: 2013, yMax: 2024 }] },
  { cat: "brake_pads_front", brand: "ACDelco", pn: "17D1423CHF1", name: "Professional Ceramic Front Pads", tier: "oem", warranty: 24, msrp: 6999, fits: [{ make: "Chevrolet", model: "Silverado", yMin: 2014, yMax: 2024 }] },
  { cat: "brake_pads_front", brand: "Subaru OEM", pn: "26296FL000", name: "Front Brake Pad Set", tier: "oem", warranty: 24, msrp: 8499, fits: [{ make: "Subaru", model: "Outback", yMin: 2015, yMax: 2024 }, { make: "Subaru", model: "Forester", yMin: 2014, yMax: 2024 }] },

  // ---------- BRAKE PADS REAR ----------
  { cat: "brake_pads_rear", brand: "Akebono", pn: "ACT905", name: "ProACT Ceramic Rear Pads", tier: "premium", warranty: 36, msrp: 5999, fits: [{ make: "Honda", model: "Civic", yMin: 2016, yMax: 2024 }] },
  { cat: "brake_pads_rear", brand: "Motorcraft", pn: "BR-1602", name: "Rear Brake Pads (F-150)", tier: "oem", warranty: 24, msrp: 7499, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }] },

  // ---------- BRAKE ROTORS FRONT ----------
  { cat: "brake_rotors_front", brand: "Centric", pn: "120.65085", name: "Premium Front Rotor (F-150)", tier: "premium", warranty: 24, msrp: 8999, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }] },
  { cat: "brake_rotors_front", brand: "Bosch QuietCast", pn: "26010745", name: "Front Disc Rotor", tier: "premium", warranty: 24, msrp: 6999, fits: [{ make: "Toyota", model: "Camry", yMin: 2012, yMax: 2024 }] },

  // ---------- BRAKE ROTORS REAR ----------
  { cat: "brake_rotors_rear", brand: "Centric", pn: "120.66067", name: "Premium Rear Rotor (Silverado)", tier: "premium", warranty: 24, msrp: 7999, fits: [{ make: "Chevrolet", model: "Silverado", yMin: 2014, yMax: 2024 }] },

  // ---------- BATTERIES ----------
  { cat: "battery", brand: "Motorcraft", pn: "BXT-65-650", name: "Group 65 Premium Battery (650 CCA)", tier: "oem", warranty: 36, msrp: 18999, fits: [{ make: "Ford", model: "F-150", yMin: 2010, yMax: 2024 }] },
  { cat: "battery", brand: "Interstate", pn: "MTP-24F", name: "Mega-Tron Plus 24F (725 CCA)", tier: "premium", warranty: 36, msrp: 17999, fits: [{ make: "Toyota", model: "Camry", yMin: 2007, yMax: 2024 }, { make: "Toyota", model: "RAV4", yMin: 2008, yMax: 2024 }] },
  { cat: "battery", brand: "ACDelco", pn: "94RAGM", name: "AGM Group 94R (800 CCA)", tier: "oem", warranty: 36, msrp: 22999, fits: [{ make: "Chevrolet", model: "Silverado", yMin: 2014, yMax: 2024 }] },

  // ---------- ALTERNATORS ----------
  { cat: "alternator", brand: "Denso", pn: "210-1180", name: "Remanufactured Alternator (130A)", tier: "premium", warranty: 24, msrp: 28999, fits: [{ make: "Honda", model: "Accord", yMin: 2013, yMax: 2017 }] },
  { cat: "alternator", brand: "Motorcraft", pn: "GL-8757", name: "Alternator (200A)", tier: "oem", warranty: 24, msrp: 38999, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2020 }] },

  // ---------- SPARK PLUGS ----------
  { cat: "spark_plugs", brand: "NGK", pn: "ILZKAR7B11", name: "Laser Iridium Spark Plug", tier: "oem", warranty: 24, msrp: 1499, fits: [{ make: "Honda", model: "Civic", yMin: 2016, yMax: 2024 }, { make: "Honda", model: "Accord", yMin: 2018, yMax: 2024 }] },
  { cat: "spark_plugs", brand: "Denso", pn: "FXE20HR11", name: "Iridium Long-Life Plug", tier: "oem", warranty: 24, msrp: 1799, fits: [{ make: "Toyota", model: "Camry", yMin: 2012, yMax: 2024 }, { make: "Toyota", model: "RAV4", yMin: 2013, yMax: 2024 }] },
  { cat: "spark_plugs", brand: "Motorcraft", pn: "SP-534", name: "Iridium Spark Plug (EcoBoost)", tier: "oem", warranty: 24, msrp: 1299, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }] },
  { cat: "spark_plugs", brand: "ACDelco", pn: "41-103", name: "Iridium Plug (LS/Vortec)", tier: "oem", warranty: 24, msrp: 999, fits: [{ make: "Chevrolet", model: "Silverado", yMin: 2014, yMax: 2024 }] },

  // ---------- WIPER BLADES ----------
  { cat: "wiper_blades", brand: "Bosch ICON", pn: "26A", name: 'Beam Wiper Blade 26"', tier: "premium", warranty: 12, msrp: 2799, fits: [{ make: "Ford", model: "F-150", yMin: 2015, yMax: 2024 }, { make: "Toyota", model: "Camry", yMin: 2018, yMax: 2024 }] },
  { cat: "wiper_blades", brand: "Rain-X Latitude", pn: "5079275-2", name: 'Beam Blade 22"', tier: "standard", warranty: 12, msrp: 1899, fits: [{ make: "Honda", model: "Civic", yMin: 2016, yMax: 2024 }, { make: "Subaru", model: "Forester", yMin: 2014, yMax: 2024 }] },

  // ---------- SERPENTINE BELT ----------
  { cat: "serpentine_belt", brand: "Gates", pn: "K060841", name: "Micro-V Serpentine Belt", tier: "premium", warranty: 24, msrp: 3499, fits: [{ make: "Ford", model: "F-150", yMin: 2011, yMax: 2024 }] },
  { cat: "serpentine_belt", brand: "Dayco", pn: "5060882", name: "Poly-Rib Serpentine Belt", tier: "standard", warranty: 24, msrp: 2999, fits: [{ make: "Toyota", model: "Camry", yMin: 2012, yMax: 2024 }] },
];

let inserted = 0;
let updated = 0;
let offers = 0;
let fitments = 0;

await c.query("BEGIN");
try {
  for (const e of SEED) {
    // Idempotent upsert keyed on (brand, oem_part_number).
    const r = await c.query(
      `INSERT INTO parts_catalog (category, brand, oem_part_number, cross_refs, name, quality_tier, warranty_months, msrp_cents, notes, active)
       VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,$6,$7,NULL,true)
       ON CONFLICT (brand, oem_part_number) DO UPDATE SET
         category = EXCLUDED.category,
         name = EXCLUDED.name,
         quality_tier = EXCLUDED.quality_tier,
         warranty_months = EXCLUDED.warranty_months,
         msrp_cents = EXCLUDED.msrp_cents,
         active = true
       RETURNING id, (xmax = 0) as inserted`,
      [e.cat, e.brand, e.pn, e.name, e.tier, e.warranty, e.msrp],
    );
    const catalogId = r.rows[0].id;
    if (r.rows[0].inserted) inserted++; else updated++;

    // Replace fitments for this catalog id (simpler than diffing).
    await c.query(`DELETE FROM parts_catalog_fitment WHERE catalog_id = $1`, [catalogId]);
    for (const f of e.fits) {
      await c.query(
        `INSERT INTO parts_catalog_fitment (catalog_id, year_min, year_max, make, model)
         VALUES ($1,$2,$3,$4,$5)`,
        [catalogId, f.yMin ?? null, f.yMax ?? null, f.make, f.model],
      );
      fitments++;
    }

    // aps-curated offer — single SKU per catalog row priced 5% under MSRP
    // so the picker has live data the moment a mechanic opens Source Parts.
    const offerSku = `APS-${catalogId}`;
    const priceCents = Math.round(e.msrp * 0.95);
    await c.query(
      `INSERT INTO parts_offers (catalog_id, supplier_key, sku, price_cents, currency, in_stock, eta_days, last_seen_at, payload)
       VALUES ($1,'aps-curated',$2,$3,'USD',true,1,now(),'{}'::jsonb)
       ON CONFLICT (supplier_key, sku) DO UPDATE SET
         price_cents = EXCLUDED.price_cents,
         in_stock = true,
         last_seen_at = now()`,
      [catalogId, offerSku, priceCents],
    );
    offers++;
  }
  await c.query("COMMIT");
} catch (err) {
  await c.query("ROLLBACK");
  throw err;
}

console.log(`Seeded parts catalog: ${inserted} inserted, ${updated} updated, ${fitments} fitments, ${offers} offers.`);
await c.end();
