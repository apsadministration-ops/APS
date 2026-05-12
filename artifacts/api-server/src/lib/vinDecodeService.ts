/**
 * Centralised NHTSA vPIC decode + enriched-profile populate.
 *
 * Extracted out of the mechanic-workspace route so the job-accept hook
 * (and any future surface) can share the exact same decode + persist
 * logic. Idempotent: running it twice on the same VIN is a no-op aside
 * from refreshing `lastOpenedAt`.
 *
 * The enriched fields (`make/model/modelYear/trim/series/manufacturer/
 * plantCountry`) are denormalized out of the NHTSA blob so the parts-
 * catalog fitment engine can score recommendations with simple SQL —
 * no jsonb digging on every parts query.
 */

import { eq } from "drizzle-orm";
import { db, mechanicVehicleProfilesTable } from "@workspace/db";

export interface DecodedVin {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  manufacturer: string | null;
  plantCountry: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuelType: string | null;
  bodyClass: string | null;
}

export interface DecodeResult {
  raw: Record<string, string | null>;
  pretty: DecodedVin;
}

export function normalizeVin(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (v.length !== 17) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return null;
  return v;
}

function flatten(row: Record<string, string | null>): DecodedVin {
  const yearStr = row["ModelYear"] ?? "";
  const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
  const cyl = row["EngineCylinders"];
  const disp = row["DisplacementL"];
  const engine = [disp ? `${disp}L` : null, cyl ? `${cyl}cyl` : null, row["FuelTypePrimary"]]
    .filter(Boolean).join(" ") || null;
  return {
    year,
    make: row["Make"] || null,
    model: row["Model"] || null,
    trim: row["Trim"] || null,
    series: row["Series"] || null,
    manufacturer: row["Manufacturer"] || null,
    plantCountry: row["PlantCountry"] || null,
    engine,
    transmission: row["TransmissionStyle"] || null,
    drivetrain: row["DriveType"] || null,
    fuelType: row["FuelTypePrimary"] || null,
    bodyClass: row["BodyClass"] || null,
  };
}

export async function decodeVin(vin: string): Promise<DecodeResult> {
  const normalized = normalizeVin(vin);
  if (!normalized) throw new Error("INVALID_VIN");
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${normalized}?format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHTSA ${res.status}`);
  const json = (await res.json()) as { Results?: Array<Record<string, string | null>> };
  const row = json.Results?.[0] ?? {};
  return { raw: row, pretty: flatten(row) };
}

/**
 * Upsert the mechanic_vehicle_profiles row for a vehicle. Best-effort —
 * never throws to the caller; failures are logged and ignored so the
 * caller's main flow (e.g. job acceptance) keeps moving.
 */
export async function upsertProfileFromDecode(
  vehicleId: number,
  vin: string,
  mechanicId: number | null,
  decode: DecodeResult,
): Promise<void> {
  const enriched = {
    decodedVin: decode.raw,
    decodedAt: new Date(),
    engine: decode.pretty.engine,
    transmission: decode.pretty.transmission,
    drivetrain: decode.pretty.drivetrain,
    fuelType: decode.pretty.fuelType,
    bodyClass: decode.pretty.bodyClass,
    make: decode.pretty.make,
    model: decode.pretty.model,
    modelYear: decode.pretty.year,
    trim: decode.pretty.trim,
    series: decode.pretty.series,
    manufacturer: decode.pretty.manufacturer,
    plantCountry: decode.pretty.plantCountry,
    ...(mechanicId ? { lastMechanicId: mechanicId, lastOpenedAt: new Date() } : {}),
  };

  const [existing] = await db.select({ id: mechanicVehicleProfilesTable.id })
    .from(mechanicVehicleProfilesTable)
    .where(eq(mechanicVehicleProfilesTable.vehicleId, vehicleId));
  if (existing) {
    await db.update(mechanicVehicleProfilesTable).set(enriched)
      .where(eq(mechanicVehicleProfilesTable.id, existing.id));
  } else {
    await db.insert(mechanicVehicleProfilesTable).values({
      vehicleId, vin, ...enriched,
    });
  }
}
