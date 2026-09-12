# Commercial Partner expansion — Part 4

## Final implementation audit before Part 5

The actual routes, schema, generated contracts, forms, and implementation
documentation were reviewed against the original Part 4 scope. Four genuine
gaps were fixed before Part 5 implementation began:

- Legacy vehicle removal now uses the same transactional VIN/vehicle locks
  as claim, import, and transfer, and cannot end ownership of a registered
  commercial vehicle.
- Maintenance due dates remain validated calendar-date strings (`YYYY-MM-DD`)
  through API responses and reloads, rather than becoming timestamps.
- Integer-valued fields reject fractions; dealership service-needed flags
  cannot be cleared to null.
- Inactive organizations are read-only, and forms offer only active linked
  locations as writable destinations.

The three expanded real-database integration scenarios passed, including
removal/import races, ordinary customer removal compatibility, date response
shape, invalid numbers, and required-field checks. Mobile capability/payload
and context-switch helper checks passed. No extra Part 4 features were added;
service requests remained deferred until this audit was finalized.

## Scope

Distinct Shop/Ghost Garage, Dealership, and Fleet operations within the shared
Partners Layer. Preserve the `shop_owner` role, `/(shop-owner)` route group,
unified organizations, and all four canonical organization subtypes.

## Architecture decisions

The canonical vehicle table and ownership history support existing customer
and mechanic workflows. Commercial operational metadata belongs in a separate
organization-scoped extension referencing those vehicles, not in customer
ownership history or the public/shared vehicle response.

Organization identity/contact information continues to use the existing
organization profile. A physical location keeps its own independent
classification. No subtype is inferred from a location classification.

- Shop/Ghost Garage: existing facility, bay, availability, reservation, and
  owner-management operations.
- Dealership: inventory identity/status and service readiness.
- Fleet: unit/group organization, operating status, usage, maintenance context,
  and downtime.
- Commercial Business: shared organization/location foundation only.

Staff membership, service requests, recurring-work execution, contracts, APS
job conversion, dispatch, assignment, earnings, and fee changes are excluded.

## Data safety baseline

Before changes, the development database contained 52 users, 4 shops, 4 bays,
2 bay bookings, 13 vehicles, 12 ownership-history rows, and 0 organizations.
Existing locations and vehicles must not be automatically linked or reassigned.

After UI tests and cleanup of proof-matched interrupted integration fixtures,
final counts were restored exactly: 52 users, 4 shops, 4 bays, 2 bookings,
13 vehicles, 12 ownership-history rows, 0 organizations, and 0 operational
records. Cleanup used fixture-only ownership/name/VIN evidence and a guarded
transaction; baseline business records were not changed.

## Results

### Additive migration

Applied `scripts/src/migrate_partner_part4_vehicle_operations.mjs` after its
read-only preflight found no duplicate normalized VINs or dangling legacy
location references. It adds `partner_vehicle_operations`, location/org
referential constraints, and case-insensitive canonical VIN uniqueness.
No existing vehicle, location, organization, or ownership record is backfilled.

### API surface

Under `/api/partner-organizations/:organizationId/vehicle-operations`:

- GET list and POST create a new canonical vehicle plus operational record.
- POST `/link` explicitly imports a qualifying existing partner vehicle.
- GET/PATCH `/:operationId` read/update organization-scoped operational data.

Exact fields and validation are documented in
`docs/partner-part4-api-contract.md`. Operational fields never enter existing
customer/mechanic vehicle response formatters.

### Subtype behavior

Dealerships manage stock numbers, inventory status, service-needed flags and
service notes. Fleets manage unit numbers, groups, operating status, odometer,
usage hours, maintenance due dates/mileage, and downtime context. Both select
from locations already explicitly linked to the same organization.

The shared UI capability map separates forms and controls without creating
separate accounts. Shop and Commercial Business organizations cannot access
these vehicle-operation endpoints. Existing Shop/Ghost Garage controls and
legacy navigation remain available.

### Limits

Vehicle identity is immutable through operational editing. Sold/retired are
operational statuses, not ownership transfer or disposal actions. Recurrence,
automatic maintenance scheduling, service requests, contracts, and APS job
conversion remain unimplemented in this part. No physical-device or live
provider verification is claimed.

### Security and shared compatibility

All new operational endpoints require the existing active `shop_owner`
account and exact organization ownership; no admin or staff bypass was added.
Cross-owner organizations are not disclosed. Cross-organization locations,
inactive write destinations, irrelevant subtype fields, and duplicate VINs
are rejected. Database constraints prevent cross-organization location links
and registering a canonical vehicle in more than one organization.

Safe legacy import requires the vehicle's existing location to match the
owned organization location and rejects any active ownership belonging to
another user. A same-account customer vehicle without a legacy partner
location cannot be imported. Import does not change ownership history.

The existing vehicle claim and transfer APIs serialize ownership changes
with commercial linking and reject registered commercial vehicles. Ordinary
customer vehicles retain their existing behavior. Organization subtype edits
are locked and cannot reinterpret existing vehicle operations.

### Verification

- Full workspace typecheck passed.
- Partner capability/payload, foundation identity/routing, and mobile helper
  regressions passed.
- Part 4 real-DB tests: 3 passed, including concurrent ownership/link and
  subtype/create conflicts, safe import, and customer-vehicle protection.
- Part 2 organization integration tests: 5 passed.
- Part 3 Shop/Ghost Garage integration scenario: passed, including legacy
  shops, availability, reservations, ownership, and booking lifecycle rules.
- Existing backend/AI/reset regression tests: 25 passed.
- iOS and Android JavaScript bundles/manifests built successfully with 49
  assets; these are not signed-native or physical-device tests.
- API build/start and health check passed.
- Real active-UI dealership create/edit, linked-location move, service-needed
  and ready filters, and reload persistence passed.
- Real active-UI fleet create/edit, unit/group and operating-status filters,
  maintenance/usage/downtime fields, reload persistence, and safe legacy
  import passed. Dealership and fleet forms showed distinct field sets.
- Final focused security review passed after the concurrency fixes.

The browser pass did not separately repeat Shop/Commercial Business
restriction screenshots, organization profile editing, or a mid-form
organization-switch scenario. Capability/helper tests and backend
authorization tests cover subtype restrictions; the form reset and stale
mutation guards were typechecked but not separately browser-exercised.

Cold Metro compilation initially delayed the browser check. A later test
attempt addressed an inactive mounted tab instead of the active operations
screen; neither required an application change. Verification resumed through
the visible dashboard entry point and the active route. Existing deprecation
warnings and the unsupported-runtime push notice remain.

### Changed files

Backend:

- `artifacts/api-server/src/routes/partnerVehicleOperations.ts`
- `artifacts/api-server/src/routes/partnerOrganizations.ts`
- `artifacts/api-server/src/routes/vehicles.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/tests/partner-vehicle-operations.integration.test.ts`
- `artifacts/api-server/package.json`

Database and migration:

- `lib/db/src/schema/partnerVehicleOperations.ts`
- `lib/db/src/schema/shops.ts`
- `lib/db/src/schema/vehicles.ts`
- `lib/db/src/schema/index.ts`
- `scripts/src/migrate_partner_part4_vehicle_operations.mjs`
- `scripts/src/report_partner_part4_vehicle_operations.mjs`
- `scripts/package.json`

Partner UI:

- `artifacts/mobile/app/(shop-owner)/partner-vehicles.tsx`
- `artifacts/mobile/app/(shop-owner)/index.tsx`
- `artifacts/mobile/app/(shop-owner)/_layout.tsx`
- `artifacts/mobile/components/partner/PartnerVehicleForm.tsx`
- `artifacts/mobile/components/partner/PartnerVehicleCard.tsx`
- `artifacts/mobile/components/partner/PartnerVehicleFilters.tsx`
- `artifacts/mobile/components/partner/PartnerLegacyVehiclePicker.tsx`
- `artifacts/mobile/lib/partnerSubtypeCapabilities.ts`
- `artifacts/mobile/lib/partnerSubtypeCapabilitiesCore.ts`
- `artifacts/mobile/lib/partnerVehicleOperationPayload.ts`
- `artifacts/mobile/scripts/partner-vehicle-operations.test.mjs`
- `artifacts/mobile/package.json`

Contract and generated files:

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- New `lib/api-zod/src/generated/types/partnerVehicleOperation*.ts` types.

Documentation:

- `docs/partner-layer-part4.md`
- `docs/partner-part4-api-contract.md`
- `.agents/memory/expo-web-font-gate.md` — distinguishing cold compilation
  from the previously documented font-gate failure.