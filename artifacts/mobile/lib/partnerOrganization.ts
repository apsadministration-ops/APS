import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PartnerOrganizationSubtype } from "@workspace/api-client-react";

export const PARTNER_ORGANIZATION_SUBTYPE_OPTIONS: ReadonlyArray<{
  value: PartnerOrganizationSubtype;
  label: string;
  description: string;
}> = [
  {
    value: "shop",
    label: "Shop",
    description: "A traditional service shop or garage.",
  },
  {
    value: "dealership",
    label: "Dealership",
    description: "A dealership or service department.",
  },
  {
    value: "fleet",
    label: "Fleet",
    description: "A private, rental, or commercial fleet.",
  },
  {
    value: "commercial_business",
    label: "Commercial business",
    description: "A business coordinating service operations.",
  },
];

export function partnerOrganizationSubtypeLabel(
  subtype: PartnerOrganizationSubtype | string | null | undefined,
) {
  return (
    PARTNER_ORGANIZATION_SUBTYPE_OPTIONS.find((option) => option.value === subtype)?.label ??
    "Organization"
  );
}

export function partnerOrganizationSelectionStorageKey(userId: number | string) {
  return `partner-organization-selection:${String(userId)}`;
}

export async function readSelectedPartnerOrganizationId(
  userId: number | string,
): Promise<number | null> {
  const value = await AsyncStorage.getItem(partnerOrganizationSelectionStorageKey(userId));
  if (!value) return null;

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function writeSelectedPartnerOrganizationId(
  userId: number | string,
  organizationId: number,
) {
  await AsyncStorage.setItem(
    partnerOrganizationSelectionStorageKey(userId),
    String(organizationId),
  );
}

export async function clearSelectedPartnerOrganizationId(userId: number | string) {
  await AsyncStorage.removeItem(partnerOrganizationSelectionStorageKey(userId));
}