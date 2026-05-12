/**
 * Side effects that run when a job becomes ACCEPTED (after customer
 * approval lands or the 60s sweeper fires). Currently:
 *
 *   - ensureProfileForJob: idempotent NHTSA VIN decode + upsert into
 *     `mechanic_vehicle_profiles`. If the profile is fresh (decoded
 *     within the last 30 days) we skip the network call. This is the
 *     foundation for the parts matching engine — every accepted job
 *     ends up with a fully-enriched vehicle profile available to the
 *     mechanic the moment they open Source Parts.
 *
 * Best-effort: every failure is swallowed so we never block a job
 * acceptance on an upstream NHTSA outage.
 */

import { eq } from "drizzle-orm";
import { db, jobsTable, mechanicVehicleProfilesTable } from "@workspace/db";
import { decodeVin, upsertProfileFromDecode } from "./vinDecodeService";

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export async function ensureProfileForJob(jobId: number): Promise<void> {
  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job || !job.vin) return;

    const [profile] = await db.select().from(mechanicVehicleProfilesTable)
      .where(eq(mechanicVehicleProfilesTable.vehicleId, job.vehicleId));

    // Already enriched recently? Skip the upstream call.
    if (profile?.decodedAt && profile.modelYear && profile.make && profile.model) {
      const age = Date.now() - profile.decodedAt.getTime();
      if (age < STALE_AFTER_MS) return;
    }

    const decoded = await decodeVin(job.vin);
    await upsertProfileFromDecode(job.vehicleId, job.vin, job.mechanicId, decoded);
  } catch {
    // best-effort
  }
}
