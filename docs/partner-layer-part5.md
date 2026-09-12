# Commercial Partner expansion — Part 5

## Scope and prerequisite

Part 4 was audited and its ownership-removal, date/numeric validation, and
inactive-write UI gaps were fixed and verified first. See
`docs/partner-layer-part4.md`.

Part 5 adds organization-scoped service requests for dealership and fleet
vehicles already registered in the Partner layer. Shop/Ghost Garage remains
the existing facility/bay/reservation workflow. Organization subtype remains
separate from physical location classification.

## Operational boundary

Requests track work internally for the organization owner. They do not create
APS jobs, dispatch or assign mechanics, change customer ownership, alter APS
job completion, or calculate payments, earnings, or fees.

Lifecycle: draft → submitted → in progress → completed. Draft, submitted,
and in-progress requests can be cancelled. Completed and cancelled requests
are terminal. No provider-review, acceptance, scheduling, or rejection
workflow is implied when no such actor is integrated.

Vehicle identity and subtype-specific context come from existing vehicle
operations, not manual entry. The request preserves an immutable association
and creation-time context. Dealership inventory fields and fleet operational
fields remain distinct.

## Data baseline

Before Part 5: 52 users, 4 shops, 4 bays, 2 bay bookings, 13 vehicles,
12 ownership-history rows, 8 jobs, 0 organizations, and 0 vehicle operations.
Verification uses synthetic fixtures only, with cleanup checked against these
counts.

After all integration and UI fixtures were removed, the final global counts
matched exactly: 52 users, 4 shops, 4 bays, 2 bay bookings, 13 vehicles,
12 ownership-history rows, 8 jobs, and zero organizations, vehicle operations,
service requests, or request-history rows.

## Intentionally deferred

Part 6 is not started. Contracts, recurring maintenance execution, staff
permissions, provider work assignment, automated job conversion, and billing
integration are not part of this implementation. This list describes deferred
capabilities, not a promise of the eventual Part 6 scope.

## Implementation and verification

### Database migration

Applied `scripts/src/migrate_partner_part5_service_requests.mjs` to development
after the read-only report confirmed the baseline and no duplicate retry keys.
The transactional, additive migration creates `partner_service_requests` and
`partner_service_request_status_history`, indexes and checks, a scoped retry-key
unique constraint, and composite foreign keys tying requests to their
organization's operation/vehicle and location. No existing records were
backfilled or reassigned. No production migration was performed.

### API

Under `/api/partner-organizations/:organizationId/service-requests`:

- GET list with search, status, urgency, vehicle, and location filters.
- POST create a draft with server-derived vehicle/context association.
- GET `/:requestId` returns the request and ordered status history together.
- PATCH `/:requestId` edits draft/submitted content with `expectedVersion`.
- POST `/:requestId/transition` validates lifecycle and appends status history.

`docs/partner-part5-api-contract.md` defines the exact fields. Creation uses a
stable organization-scoped retry key and normalized fingerprint: matching
retries return the existing request; conflicting reuse is rejected.

### Security and integrity

Only the active existing `shop_owner` account that owns the organization can
access requests. Shop and Commercial Business subtypes are rejected. Customer,
mechanic, and unrelated owner access is denied. Inactive organizations remain
readable but cannot be changed.

Vehicle identity, organization, subtype, creation context, timestamps, and
request status cannot be injected through ordinary content updates. Location
destinations must be active and explicitly linked to the same organization.
The vehicle association is immutable after creation.

Mutations use transactions, relationship locks, and optimistic versions.
Stale edits/transitions fail rather than overwriting another change. Detail
reads use a read-only repeatable-read transaction so the request and its
history represent the same database snapshot. History ties are ordered by ID.

### UI

The selected dealership/fleet dashboard and registered vehicle cards provide
service-request entry points. The request form selects an existing operation
and automatically displays vehicle context; users do not retype VIN, stock,
unit, group, usage, or maintenance fields.

The list supports all documented filters. Details show immutable creation
context, editable request content, status actions, timestamps, and history.
Owner/organization-scoped query keys, form resets, stale-response guards, and
active-write gates protect switching between organizations.

### Passed automated checks

- Full workspace typecheck.
- Service-request, vehicle-operation, Partner foundation, and existing mobile
  helper checks.
- One comprehensive Part 5 real-database scenario covering both subtypes,
  all list filters, association/authorization rejection, strict fields,
  idempotent retries, stale versions, lifecycle/history, concurrent mutations,
  coherent detail reads, inactive organizations, and unchanged ownership.
- Three expanded Part 4 database scenarios passed before Part 5 began.
- Five organization integration tests and the Shop/Ghost Garage integration
  scenario passed, including legacy availability/reservation behavior.
- All 25 existing backend/AI/reset regression tests passed.
- API build/start and health passed.
- iOS/Android JavaScript bundles and manifests built with 49 assets.

### Real UI verification

Both dealership and fleet flows passed real UI creation, editing, list
filters (status, urgency, vehicle, location, search), and reload persistence.
Vehicle context was automatic and subtype-specific. Dealership transitions
passed through completion with history and timestamps; the fleet cancellation
path passed with terminal controls unavailable.

The first pass found nested-navigation defects. These were fixed with a
request Stack, explicit list return routes, and origin-organization guards.
A targeted follow-up confirmed list/detail/back, new/cancel, no extra request
tabs, and organization switching without stale visible data or request 404s.
The final native JavaScript bundles and mobile helper/type checks passed
after those fixes. These browser checks used Expo web, not physical devices.

### Changed files

Part 5 backend/database:

- `artifacts/api-server/src/routes/partnerServiceRequests.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/tests/partner-service-requests.integration.test.ts`
- `artifacts/api-server/package.json`
- `lib/db/src/schema/partnerServiceRequests.ts`
- `lib/db/src/schema/partnerVehicleOperations.ts` — composite FK target
- `lib/db/src/schema/index.ts`
- `scripts/src/migrate_partner_part5_service_requests.mjs`
- `scripts/src/report_partner_part5_service_requests.mjs`
- `scripts/package.json`

Part 5 UI:

- `artifacts/mobile/app/(shop-owner)/service-requests/index.tsx`
- `artifacts/mobile/app/(shop-owner)/service-requests/_layout.tsx`
- `artifacts/mobile/app/(shop-owner)/service-requests/new.tsx`
- `artifacts/mobile/app/(shop-owner)/service-requests/[id].tsx`
- `artifacts/mobile/app/(shop-owner)/_layout.tsx`
- `artifacts/mobile/app/(shop-owner)/index.tsx`
- `artifacts/mobile/app/(shop-owner)/partner-vehicles.tsx`
- `artifacts/mobile/components/partner/PartnerVehicleCard.tsx`
- `artifacts/mobile/components/partner/PartnerServiceRequestForm.tsx`
- `artifacts/mobile/lib/partnerServiceRequest.ts`
- `artifacts/mobile/scripts/partner-service-requests.test.mjs`
- `artifacts/mobile/package.json`

Contracts/docs:

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts` and `api.schemas.ts`
- `lib/api-zod/src/generated/api.ts` and service-request generated types
- `docs/partner-layer-part5.md`
- `docs/partner-part5-api-contract.md`

Part 4 audit fixes additionally touched the vehicle/vehicle-operation routes,
their integration test, vehicle form/import controls and helper tests,
`artifacts/mobile/lib/partnerVehicleContext.ts`, Part 4 contract/generated
types, and both Part 4 documentation files. See its final-audit section.

### Limitations

Completion means the owner marked this internal request complete, not that an
APS mechanic completed a paid job. No provider notifications, scheduling,
dispatch, contracts, recurring execution, or staff authority is implied.
Creation context intentionally stays as recorded even if the vehicle's
operational metadata later changes. No physical-device or live-provider
certification was performed.

The navigation check observed a retained hidden back-link shell to a previous
request in the accessibility tree after switching organizations. It did not
show old request content, bypass authorization, or affect active navigation;
assistive-technology behavior for that retained shell was not independently
certified. Existing styling deprecation warnings and the runtime notice that
push notifications are unavailable remain.