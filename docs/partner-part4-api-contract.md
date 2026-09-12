# Partner vehicle operations API contract (Part 4)

Part 4 adds operational records for the existing canonical vehicle registry.
It does not add an organization/profile table, an event stream, ownership
history entries, jobs, requests, contracts, integrations, or new permissions.
The existing `partner_organizations` row remains the single organization
identity/contact/profile and its `subtype` remains the discriminator:

```ts
type PartnerOrganizationSubtype =
  | "shop"
  | "dealership"
  | "fleet"
  | "commercial_business";
```

Vehicle operations are currently available only to organizations whose subtype
is `dealership` or `fleet`. `shop` and `commercial_business` organizations
receive HTTP 403 from every vehicle-operation endpoint. Access is limited to
the authenticated account's existing active `shop_owner` role. Admins do not
receive a new bypass permission.

## Resource

`partner_vehicle_operations` has one row per canonical vehicle globally. A row
links an existing canonical `vehicles` row, one existing `shops` row as its
physical location, and one existing `partner_organizations` row. The location
must already be explicitly linked to the organization, owned by the same
account, and active at write time. A location's existing physical
classification (`shops.partnerKind`) is never inferred from or rewritten by
the organization's subtype; an organization may have multiple linked
locations with any existing classification.

Responses are flat so the canonical vehicle and operational fields are
available without a second request:

```ts
type PartnerVehicleOperation = {
  id: number;
  organizationId: number;
  vehicleId: number;
  linkedShopId: number;

  // Canonical vehicle fields
  vin: string;
  plateNumber: string | null;
  make: string;
  model: string;
  year: number;
  trim: string | null;
  color: string | null;
  mileage: number;
  insuranceCarrier: string | null;
  insurancePolicyNumber: string | null;
  ownerShopId: number | null;

  // Dealership fields. They are null on fleet operations.
  stockNumber: string | null;
  inventoryStatus: "in_stock" | "preparing" | "ready" | "sold" | null;
  serviceNeeded: boolean | null;
  serviceNotes: string | null;

  // Fleet fields. They are null on dealership operations.
  unitNumber: string | null;
  groupName: string | null;
  operatingStatus: "active" | "maintenance" | "out_of_service" | "retired" | null;
  odometer: number | null;
  usageHours: number | null;
  maintenanceDueDate: string | null; // YYYY-MM-DD
  maintenanceDueMileage: number | null;
  downtimeSince: string | null; // ISO date-time
  notes: string | null;

  createdAt: string; // ISO date-time
  updatedAt: string; // ISO date-time
};
```

The nullable fields belonging to the other subtype are always `null` in
responses. They are not accepted on a request for the wrong subtype.

## Endpoints

All endpoints are under `/api`, require a bearer token, and require an active
`shop_owner` account. All path and ID fields are positive safe integers.
Organization access is owner-scoped; another owner's organization is returned
as not found rather than disclosed.

### `GET /partner-organizations/{organizationId}/vehicle-operations`

Lists all operations belonging to the owner's organization. This includes
operations whose organization is inactive; inactivity blocks writes, not an
owner's read of their own data.

### `POST /partner-organizations/{organizationId}/vehicle-operations`

Creates a **new canonical vehicle and operation atomically**. The request is
flat:

```json
{
  "linkedShopId": 123,
  "vin": "1HGCM82633A004352",
  "plateNumber": "APS-001",
  "make": "Honda",
  "model": "Accord",
  "year": 2023,
  "trim": "Sport",
  "color": "Blue",
  "mileage": 1200,
  "insuranceCarrier": "Example Mutual",
  "insurancePolicyNumber": "POL-123",
  "stockNumber": "D-1001",
  "inventoryStatus": "in_stock",
  "serviceNeeded": false,
  "serviceNotes": null
}
```

The canonical VIN is normalized to uppercase and globally unique. If any
canonical vehicle already has that VIN, this endpoint returns HTTP 409 and
does not modify the existing vehicle. This endpoint never writes
`ownership_history`; a new registry vehicle has no customer ownership row.
Use the explicit link endpoint for a safe legacy import.

For a `dealership` organization, `stockNumber`, `inventoryStatus`, and
`serviceNeeded` are required; `serviceNotes` is optional. Fleet-only fields
are rejected. For a `fleet` organization, `unitNumber`, `groupName`, and
`operatingStatus` are required; the remaining fleet fields are optional.
Dealership-only fields are rejected. Unknown fields are rejected, never
silently dropped.

### `POST /partner-organizations/{organizationId}/vehicle-operations/link`

Links an existing canonical vehicle to a new operation atomically:

```json
{
  "vehicleId": 456,
  "linkedShopId": 123,
  "stockNumber": "D-1001",
  "inventoryStatus": "preparing",
  "serviceNeeded": true,
  "serviceNotes": "Install dealer accessories"
}
```

This is the only vehicle-operation path that can reuse an existing VIN. The
server accepts the link only when all of the following legacy-import proof is
true:

1. `vehicleId` exists and its `ownerShopId` is exactly `linkedShopId`;
2. `linkedShopId` is an active location owned by the authenticated owner and
   linked to this same organization;
3. the canonical vehicle has no active `ownership_history` row for a
   different user. An active row is permitted only when every active row is
   for the authenticated organization owner (the legacy `POST /vehicles`
   endpoint can create that same-user row); and
4. the canonical vehicle has no existing partner operation (and therefore is
   not linked to another organization).

An ordinary customer vehicle with `ownerShopId: null` fails this proof even
when the authenticated organization owner is also listed in its ownership
history. Any active foreign-owner row also fails. The link path never changes
the canonical vehicle or ownership history and never writes a new ownership
row. Any failed proof returns HTTP 409.

Legacy VIN claims and ownership transfers serialize on the canonical vehicle
row and a normalized-VIN advisory lock. The legacy `POST /vehicles` path
rechecks the partner registry after taking that lock, so a concurrent import
wins. The legacy ownership-transfer endpoint rejects any vehicle already
registered by a partner with HTTP 409; it does not end or append ownership
history for that vehicle.

### `GET /partner-organizations/{organizationId}/vehicle-operations/{operationId}`

Returns one owner-scoped operation. The operation must belong to the path
organization.

### `PATCH /partner-organizations/{organizationId}/vehicle-operations/{operationId}`

Updates one or more operational fields. The body must contain at least one
field and uses the same subtype-specific strict field rules as create/link.
`linkedShopId` may be changed to another active location already linked to the
same organization and owned by the same account. Canonical
`vehicles.ownerShopId` is synchronized only when it still equals the
operation's previous location; otherwise the legacy value is preserved and
the operation's linked location is authoritative. No ownership-history row is
written.

Canonical VIN and vehicle identity fields are immutable through this API.
Unknown or irrelevant fields, organization/vehicle reassignment, and inactive
destinations are rejected.

## Compatibility and safety

- Database constraints make `(organizationId, linkedShopId)` resolve to a
  location in that organization and keep the existing organization/location
  owner consistency foreign key in force.
- A unique constraint on `vehicleId` prevents cross-organization rebinding.
- Canonical VIN uniqueness is global, with the server also normalizing and
  locking by VIN to close case and race gaps.
- Legacy `POST /vehicles` behavior for ordinary customer vehicles is
  unchanged. Its existing-VIN ownership-claim branch rejects only a vehicle
  already registered by this partner registry, because those vehicles
  intentionally have no ownership-history row.
- Operational fields never enter `formatVehicle`, ownership history, work
  logs, mechanic responses, jobs, or customer responses.
- Existing data is not backfilled or automatically linked. The additive
  migration is reviewed and applied separately.