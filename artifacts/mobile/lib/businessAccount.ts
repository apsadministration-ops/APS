import type { PartnerOrganizationSubtype } from "@workspace/api-client-react";

export type BusinessRegistrationSubtype = Extract<
  PartnerOrganizationSubtype,
  "shop" | "dealership" | "fleet"
>;

export type BusinessRegistrationPayload = {
  business: {
    legalName: string;
    name?: string;
    subtype: BusinessRegistrationSubtype;
    email: string;
    phone: string;
    address: string;
    city: string;
    region: string;
    zipCode?: string;
    contactName?: string;
  };
  administrator: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  };
};

export const BUSINESS_REGISTRATION_OPTIONS: ReadonlyArray<{
  value: BusinessRegistrationSubtype;
  label: string;
  description: string;
}> = [
  {
    value: "shop",
    label: "Shop / Repair Facility",
    description: "Run a repair shop, garage, or service center.",
  },
  {
    value: "dealership",
    label: "Dealership",
    description: "Manage a dealership or service department.",
  },
  {
    value: "fleet",
    label: "Fleet / Commercial Fleet",
    description: "Coordinate maintenance for company or commercial vehicles.",
  },
];

export function businessRegistrationSubtypeLabel(
  subtype: BusinessRegistrationSubtype | string | null | undefined,
) {
  return BUSINESS_REGISTRATION_OPTIONS.find((option) => option.value === subtype)?.label ?? "Business";
}

/**
 * Keep the business account contract explicit at the mobile boundary. In
 * particular, administrator credentials are never mixed into the business
 * profile and a business account never asks for a personal home address.
 */
export function buildBusinessRegistrationPayload(input: {
  legalName: string;
  displayName?: string;
  subtype: BusinessRegistrationSubtype;
  businessEmail: string;
  businessPhone: string;
  address: string;
  city: string;
  region: string;
  zipCode?: string;
  administratorName: string;
  administratorEmail: string;
  administratorPhone?: string;
  administratorPassword: string;
}): BusinessRegistrationPayload {
  const displayName = input.displayName?.trim() || input.legalName.trim();
  const payload: BusinessRegistrationPayload = {
    business: {
      legalName: input.legalName.trim(),
      name: displayName,
      subtype: input.subtype,
      email: input.businessEmail.trim(),
      phone: input.businessPhone.trim(),
      address: input.address.trim(),
      city: input.city.trim(),
      region: input.region.trim(),
      ...(input.zipCode?.trim() ? { zipCode: input.zipCode.trim() } : {}),
    },
    administrator: {
      name: input.administratorName.trim(),
      email: input.administratorEmail.trim(),
      ...(input.administratorPhone?.trim()
        ? { phone: input.administratorPhone.trim() }
        : {}),
      password: input.administratorPassword,
    },
  };
  return payload;
}

/**
 * A display name is an organization identity, not the administrator's
 * personal account name. Older organizations only have `name`, while newer
 * business responses may expose `legalName` separately.
 */
export function businessDisplayName(input: {
  name?: string | null;
  legalName?: string | null;
}) {
  return input.name?.trim() || input.legalName?.trim() || "Your business";
}