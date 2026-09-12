# Commercial Partner expansion — Part 2

## Scope and compatibility decisions

The existing `shops` table is a physical-location structure, with linked bays,
bookings, vehicles, and partner jobs. There was no existing organization or
membership structure suitable for reuse.

Part 2 adds one unified Partner organization concept. Account role remains
`shop_owner`; route group remains `/(shop-owner)`. Organization subtypes are
`shop`, `dealership`, `fleet`, and `commercial_business`. Location
`partnerKind` remains a separate classification with its existing values.

An organization is explicitly created by its owner. Existing accounts and
locations are not automatically grouped, reclassified, or forced through setup.
An owner may create multiple organizations and explicitly associate multiple
existing owned locations with an organization. No new locations table is needed.

Ownership is the authorization model for this foundation. Staff membership,
invitations, delegated roles, legal verification, and final onboarding are not
implemented. New organization management never grants admin, dispatch,
mechanic-management, fee, or earnings permissions.

## Database safety

The applied development change is additive: a Partner organization table and an optional
organization reference on existing shops. Existing location owners, IDs,
classifications, bays, bookings, and jobs are retained. No automatic subtype
mapping is made, particularly for mixed-location owners or GSA locations.

Pre-change development counts: 52 users, 4 shops, 4 bays, 2 bay bookings.
Counts are safety evidence, not a substitute for relational and access tests.

## Boundaries

No Customer or Mechanic workflows, signup fields, customer vehicle ownership,
customer job creation, acceptance, completion, dispatch, or earnings changes
belong to this part. Subtype presentation is a shared foundation, not four
separate applications. Existing feature restrictions remain in place until
their respective later implementation parts.

Parts 3–6 are explicitly deferred.

## Verification

- Full workspace typecheck, focused Partner helper tests, existing mobile
  regressions, and all 25 existing backend/AI tests passed.
- Five real-DB Partner integration tests passed, including all four subtypes,
  invalid subtype and ID rejection, ownership/role field rejection,
  cross-owner access denial, inactive organization link rejection, concurrent
  linking, and direct composite-FK rejection. Synthetic users were cleaned up.
- API build/start passed. Final iOS/Android JavaScript bundles and manifests
  built with 49 assets. An initial download was interrupted while Metro was
  restarting; the retry succeeded. This is not a signed native/device test.
- Real browser/API journey passed: legacy Partner login and Locations without
  organization setup; Shop creation and status editing through the UI; the other
  three subtypes created through the API and selected in the UI; explicit
  location linking; selected Fleet subtype retained after logout/login.
- Cross-owner organization reads/link attempts returned 404; Customer and
  Mechanic organization management returned 403. Legacy location, bay-list,
  and booking-list reads succeeded. No full booking lifecycle or unchanged
  Customer/Mechanic end-to-end suite was rerun in this part.
- All browser fixtures were removed. Final development counts match baseline:
  52 users, 4 shops, 4 bays, 2 bay bookings. Existing organization rows remain
  zero because legacy accounts were not automatically enrolled.
- A browser-discovered missing query function warning in local selection-error
  state was fixed by making that cache-only query explicitly disabled with a
  defined query function. Existing push-unavailable and style deprecation
  notices remain outside this scope.

## API and permissions

Added list/create at `/api/partner-organizations`, get/update at
`/api/partner-organizations/:organizationId`, and list/link at
`/api/partner-organizations/:organizationId/locations`.

The authenticated active `shop_owner` is always the primary owner. Requests
cannot supply an owner, role, timestamp, or arbitrary extra fields. Organization
and location IDs are validated as positive safe integers. New organization
management requires organization ownership; linking additionally requires shop
ownership and an active organization. Already-linked locations cannot silently
move between organizations. A composite database foreign key keeps location and
organization owners consistent, including writes outside these endpoints.

Existing location-based management remains owner-scoped and unchanged. No new
staff permissions are introduced. Inactive organization status blocks new links,
not historical Ghost Garage operations or account login.

## Frontend and dependencies

The shared Organizations screen supports creation, editing, status, selection,
and explicit location linking. All subtypes use the same screen. Selection is
stored per owner and shared between Partner tabs; subtype is displayed on the
existing dashboard without enabling later-part features.

OpenAPI was regenerated for the new endpoints and nullable Shop organization ID.
The generator was pinned to the version matching existing checked-in output,
with explicit Zod 3 compatibility, to avoid unrelated contract rewrites.
The backend test runner gained `tsx`; no mobile framework upgrade was made.

Implementation lives in the new organization schema, route, generated
contracts, Partner screen/state helpers, integration test, and additive migration
and preflight scripts. Existing shop/bay response formatters expose the nullable
organization ID. See `docs/partner-org-api-contract.md` for exact fields and
request/response details.