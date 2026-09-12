import type { PartnerVehicleOperationInput } from "@workspace/api-client-react";

type IdentityPayloadInput = Pick<
  PartnerVehicleOperationInput,
  "linkedShopId" | "vin" | "make" | "model" | "year" | "mileage"
> & {
  plate?: string;
};

/**
 * Builds only user-entered canonical identity fields for a new operation.
 * IDs owned by the server (vehicleId, organizationId, timestamps, ownership
 * rows) are intentionally not accepted by this helper.
 */
export function buildPartnerVehicleIdentityPayload({
  linkedShopId,
  vin,
  make,
  model,
  year,
  mileage,
  plate,
}: IdentityPayloadInput): PartnerVehicleOperationInput {
  return {
    linkedShopId,
    vin: vin.trim().toUpperCase(),
    make: make.trim(),
    model: model.trim(),
    year,
    mileage,
    ...(plate?.trim() ? { plateNumber: plate.trim().toUpperCase() } : {}),
  };
}