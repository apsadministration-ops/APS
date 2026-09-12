# Partner organization API contract (Part 2)

This contract is the additive owner-only organization foundation. It does not
change customer or mechanic registration, identity, or workflows. The existing
`shop_owner` account role is used; an owner may explicitly create any number of
organizations and link existing owned shop locations to them.

## Organization shape

Responses use these camelCase fields:

```ts
type PartnerOrganizationSubtype =
  | "shop"
  | "dealership"
  | "fleet"
  | "commercial_business";

type PartnerOrganizationStatus = "active" | "inactive";

type PartnerOrganization = {
  id: number;
  primaryOwnerId: number; // always derived from the authenticated account
  name: string;
  subtype: PartnerOrganizationSubtype;
  contactName: string | null;
  phone: string;
  email: string;
  address: string;
  city: string;
  region: string;
  zipCode: string | null;
  status: PartnerOrganizationStatus;
  createdAt: string; // ISO date-time
  updatedAt: string; // ISO date-time
};
```

`primaryOwnerId`, `id`, timestamps, and status are server/database fields. They
must not be supplied by clients on create. `primaryOwnerId` is never accepted
on update. Unknown fields (including `ownerId`, `role`, and
`primaryOwnerId`) are rejected with HTTP 400 rather than ignored.

## Endpoints

All endpoints are under `/api`, require a bearer token, and require an
authenticated **active** `shop_owner` account. IDs are numeric.

### `GET /partner-organizations`

Returns an array of all organizations owned by the current account, including
inactive organizations. The response is always an array (empty when none
exist).

### `POST /partner-organizations`

Creates one organization. Multiple organizations are allowed; there is no
implicit migration, default organization, or subtype inference.

```json
{
  "name": "Northstar Service Group",
  "subtype": "commercial_business",
  "contactName": "Avery Smith",
  "phone": "+1-555-0100",
  "email": "ops@example.test",
  "address": "100 Main Street",
  "city": "Brooklyn",
  "region": "NY",
  "zipCode": "11201"
}
```

`contactName` and `zipCode` are optional; the other business/contact fields
above are required. `subtype` must be exactly one of the four canonical values.
The response is HTTP 201 with a `PartnerOrganization`.

### `GET /partner-organizations/:organizationId`

Returns one organization only when it belongs to the authenticated owner.
Cross-owner access is denied.

### `PATCH /partner-organizations/:organizationId`

Updates any supplied mutable organization field:
`name`, `subtype`, `contactName`, `phone`, `email`, `address`, `city`,
`region`, `zipCode`, and `status`. The body must contain at least one field.
`primaryOwnerId`, `ownerId`, and `role` are not accepted. The response is the
updated `PartnerOrganization`.

### `GET /partner-organizations/:organizationId/locations`

Returns an array of the current owner's `Shop` records whose nullable
`organizationId` equals this organization. Existing shop fields remain
available; `organizationId` is an additive nullable response field.

### `POST /partner-organizations/:organizationId/locations`

Links exactly one existing owned shop location. The body is:

```json
{ "shopId": 123 }
```

The organization must be active, and the shop must already be owned by the
authenticated owner. A location already linked to any organization is rejected
with HTTP 409; it is never silently reassigned. Cross-owner and cross-org
attempts are denied. Linking does not change the shop's existing `ownerId` or
`partnerKind` classification.

## Compatibility and security notes

- Existing `/shops`, `/shops/mine`, bay, booking, vehicle, and partner-job
  ownership checks continue to derive access from `shops.ownerId`.
- The database uses a composite owner-consistency foreign key for
  `(shops.organization_id, shops.owner_id)` to
  `(partner_organizations.id, partner_organizations.primary_owner_id)`.
  Legacy shops remain unlinked (`organizationId: null`) and unchanged.
- Organization creation is explicit only. The migration is additive and does
  not backfill or wipe existing rows.
- This part intentionally has no memberships, staff access, invitations,
  customer/mechanic changes, or subtype-specific later features.