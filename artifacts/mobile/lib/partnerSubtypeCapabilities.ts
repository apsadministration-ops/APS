import { Feather } from "@expo/vector-icons";
import type { PartnerOrganizationSubtype } from "@workspace/api-client-react";
import {
  PARTNER_SUBTYPE_CAPABILITY_CONFIGS,
  partnerSubtypeCapabilityCore,
  partnerSubtypeHasVehicleOperationsCore,
  type PartnerSubtypeCapabilityConfig,
  type PartnerVehicleField,
  type PartnerVehicleFilter,
} from "./partnerSubtypeCapabilitiesCore";

export type { PartnerVehicleField, PartnerVehicleFilter };

export type PartnerSubtypeCapability = PartnerSubtypeCapabilityConfig & {
  icon: keyof typeof Feather.glyphMap;
};

/**
 * This is the UI capability map for the canonical organization subtypes.
 * It intentionally describes UI boundaries only. It does not infer a
 * subtype from a physical location and it does not grant API permissions.
 */
const PARTNER_SUBTYPE_ICONS: Record<
  PartnerOrganizationSubtype,
  keyof typeof Feather.glyphMap
> = {
  shop: "tool",
  dealership: "award",
  fleet: "truck",
  commercial_business: "briefcase",
};

export const PARTNER_SUBTYPE_CAPABILITIES = Object.fromEntries(
  (Object.keys(PARTNER_SUBTYPE_CAPABILITY_CONFIGS) as PartnerOrganizationSubtype[]).map((subtype) => [
    subtype,
    {
      ...PARTNER_SUBTYPE_CAPABILITY_CONFIGS[subtype],
      icon: PARTNER_SUBTYPE_ICONS[subtype],
    },
  ]),
) as Record<PartnerOrganizationSubtype, PartnerSubtypeCapability>;

export function partnerSubtypeCapability(
  subtype: PartnerOrganizationSubtype | string | null | undefined,
): PartnerSubtypeCapability | null {
  const config = partnerSubtypeCapabilityCore(subtype);
  if (!config) return null;
  return PARTNER_SUBTYPE_CAPABILITIES[config.subtype];
}

export function partnerSubtypeHasVehicleOperations(
  subtype: PartnerOrganizationSubtype | string | null | undefined,
) {
  return partnerSubtypeHasVehicleOperationsCore(subtype);
}