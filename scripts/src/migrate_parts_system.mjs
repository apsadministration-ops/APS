/**
 * Idempotent migration for the VIN-Integrated Parts Matching System.
 * Run with: node scripts/src/migrate_parts_system.mjs
 */
import pg from "pg";

const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const sql = `
-- 1. Extend mechanic_vehicle_profiles with enriched VIN-decode fields
ALTER TABLE mechanic_vehicle_profiles
  ADD COLUMN IF NOT EXISTS make            text,
  ADD COLUMN IF NOT EXISTS model           text,
  ADD COLUMN IF NOT EXISTS model_year      integer,
  ADD COLUMN IF NOT EXISTS trim            text,
  ADD COLUMN IF NOT EXISTS series          text,
  ADD COLUMN IF NOT EXISTS manufacturer    text,
  ADD COLUMN IF NOT EXISTS plant_country   text;

-- 2. parts_catalog
CREATE TABLE IF NOT EXISTS parts_catalog (
  id              serial PRIMARY KEY,
  category        text NOT NULL,
  brand           text NOT NULL,
  oem_part_number text NOT NULL,
  cross_refs      jsonb NOT NULL DEFAULT '[]'::jsonb,
  name            text NOT NULL,
  quality_tier    text NOT NULL DEFAULT 'standard',
  warranty_months integer NOT NULL DEFAULT 12,
  msrp_cents      integer NOT NULL DEFAULT 0,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX  IF NOT EXISTS parts_catalog_category_idx ON parts_catalog (category);
CREATE INDEX  IF NOT EXISTS parts_catalog_brand_idx    ON parts_catalog (brand);
CREATE UNIQUE INDEX IF NOT EXISTS parts_catalog_brand_oem_uq ON parts_catalog (brand, oem_part_number);

-- 3. parts_catalog_fitment
CREATE TABLE IF NOT EXISTS parts_catalog_fitment (
  id                    serial PRIMARY KEY,
  catalog_id            integer NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  year_min              integer,
  year_max              integer,
  make                  text,
  model                 text,
  engine_pattern        text,
  transmission_pattern  text,
  drivetrain_pattern    text,
  trim_pattern          text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_fitment_catalog_idx     ON parts_catalog_fitment (catalog_id);
CREATE INDEX IF NOT EXISTS parts_fitment_make_model_idx  ON parts_catalog_fitment (make, model);

-- 4. parts_offers
CREATE TABLE IF NOT EXISTS parts_offers (
  id            serial PRIMARY KEY,
  catalog_id    integer NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  supplier_key  text NOT NULL,
  sku           text NOT NULL,
  price_cents   integer NOT NULL,
  currency      text NOT NULL DEFAULT 'USD',
  in_stock      boolean NOT NULL DEFAULT true,
  eta_days      integer NOT NULL DEFAULT 2,
  payload       jsonb DEFAULT '{}'::jsonb,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX  IF NOT EXISTS parts_offers_catalog_idx  ON parts_offers (catalog_id);
CREATE INDEX  IF NOT EXISTS parts_offers_supplier_idx ON parts_offers (supplier_key);
CREATE UNIQUE INDEX IF NOT EXISTS parts_offers_supplier_sku_uq ON parts_offers (supplier_key, sku);

-- 5. parts_orders
CREATE TABLE IF NOT EXISTS parts_orders (
  id                  serial PRIMARY KEY,
  job_id              integer NOT NULL REFERENCES jobs(id)        ON DELETE CASCADE,
  vehicle_id          integer NOT NULL REFERENCES vehicles(id),
  vin                 text    NOT NULL,
  mechanic_id         integer NOT NULL REFERENCES users(id),
  catalog_id          integer NOT NULL REFERENCES parts_catalog(id),
  supplier_key        text    NOT NULL,
  sku                 text    NOT NULL,
  qty                 integer NOT NULL DEFAULT 1,
  unit_price_cents    integer NOT NULL,
  total_price_cents   integer NOT NULL,
  status              text    NOT NULL DEFAULT 'candidate',
  confidence          text    NOT NULL,
  validation_state    text    NOT NULL,
  validation_reasons  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  supplier_invoice_url text,
  supplier_order_ref   text,
  ordered_at           timestamptz,
  received_at          timestamptz,
  installed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_orders_job_idx      ON parts_orders (job_id);
CREATE INDEX IF NOT EXISTS parts_orders_vehicle_idx  ON parts_orders (vehicle_id);
CREATE INDEX IF NOT EXISTS parts_orders_vin_idx      ON parts_orders (vin);
CREATE INDEX IF NOT EXISTS parts_orders_mechanic_idx ON parts_orders (mechanic_id);
CREATE INDEX IF NOT EXISTS parts_orders_status_idx   ON parts_orders (status);
`;
await c.query(sql);
console.log("Parts system migration applied OK.");
await c.end();
