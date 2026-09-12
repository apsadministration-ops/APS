import type { PartnerOrganizationSubtype } from "@workspace/api-client-react";

export type PartnerVehicleField =
  | "vin"
  | "make"
  | "model"
  | "year"
  | "plate"
  | "mileage"
  | "serviceNeeded"
  | "stockNumber"
  | "inventoryStatus"
  | "serviceNotes"
  | "group"
  | "unitNumber"
  | "operatingStatus"
  | "odometer"
  | "usageHours"
  | "maintenanceDueDate"
  | "maintenanceDueMileage"
  | "downtimeSince"
  | "notes"
  | "locations";

export type PartnerVehicleFilter = "serviceNeeded" | "inventoryStatus" | "group" | "operatingStatus";

export type PartnerSubtypeCapabilityConfig = {
  subtype: PartnerOrganizationSubtype;
  label: string;
  description: string;
  primaryArea: "locations" | "dealership-vehicles" | "fleet-vehicles";
  vehicleFields: readonly PartnerVehicleField[];
  filters: readonly PartnerVehicleFilter[];
};

/**
 * Pure organization capability data. Keep this module free of native/runtime
 * imports so capability separation can be tested without Expo.
 */
export const PARTNER_SUBTYPE_CAPABILITY_CONFIGS: Record<
  PartnerOrganizationSubtype,
  PartnerSubtypeCapabilityConfig
> = {
  shop: {
    subtype: "shop",
    label: "Shop / Ghost Garage",
    description: "Manage existing locations, bays, availability, and bookings.",
    primaryArea: "locations",
    vehicleFields: [],
    filters: [],
  },
  dealership: {
    subtype: "dealership",
    label: "Dealership",
    description: "Track dealership inventory identity and service readiness.",
    primaryArea: "dealership-vehicles",
    vehicleFields: [
      "vin",
      "make",
      "model",
      "year",
      "plate",
      "mileage",
      "serviceNeeded",
      "stockNumber",
      "inventoryStatus",
      "serviceNotes",
      "locations",
    ],
    filters: ["serviceNeeded", "inventoryStatus"],
  },
  fleet: {
    subtype: "fleet",
    label: "Fleet",
    description: "Group operating units and track usage, maintenance, and downtime.",
    primaryArea: "fleet-vehicles",
    vehicleFields: [
      "vin",
      "make",
      "model",
      "year",
      "plate",
      "mileage",
      "group",
      "unitNumber",
      "operatingStatus",
      "odometer",
      "usageHours",
      "maintenanceDueDate",
      "maintenanceDueMileage",
      "downtimeSince",
      "notes",
      "locations",
    ],
    filters: ["group", "operatingStatus"],
  },
  commercial_business: {
    subtype: "commercial_business",
    label: "Commercial business",
    description: "Use the shared organization and physical location foundation.",
    primaryArea: "locations",
    vehicleFields: [],
    filters: [],
  },
};

export function partnerSubtypeCapabilityCore(
  subtype: PartnerOrganizationSubtype | string | null | undefined,
) {
  if (!subtype || !(subtype in PARTNER_SUBTYPE_CAPABILITY_CONFIGS)) return null;
  return PARTNER_SUBTYPE_CAPABILITY_CONFIGS[subtype as PartnerOrganizationSubtype];
}

export function partnerSubtypeHasVehicleOperationsCore(
  subtype: PartnerOrganizationSubtype | string | null | undefined,
) {
  return partnerSubtypeCapabilityCore(subtype)?.primaryArea.endsWith("-vehicles") ?? false;
}