# Commercial Partner expansion — Part 3

## Scope

Strengthen the existing Shop/Ghost Garage management experience within the
Partners Layer. Preserve the `shop_owner` role, `/(shop-owner)` routes, unified
Partner organizations, canonical organization subtypes, and existing location
classifications.

An organization is a business/entity. A location is a physical facility. A bay
is a rentable or usable workspace within that facility. Ghost Garage remains
meaningful facility/workflow terminology, not an inferred organization subtype.

## Compatibility boundaries

- No automatic organization linking, reassignment, or reclassification.
- Legacy unlinked locations remain manageable without organization setup.
- Organization/location owners must match; multiple locations and bays reuse
  existing relationships.
- No staff membership, invitations, delegated roles, or verification onboarding.
- Booking creation remains an authorized mechanic operation. Partner owners
  retain their existing management/cancellation permissions, not mechanic
  assignment, dispatch, completion, or earnings permissions.
- No new approval workflow, opening-hours calendar, blackout model, or pricing
  policy is introduced. Bay active/inactive state and existing reservations
  remain the availability foundation.
- Parts 4–6 are not part of this implementation.

## Implementation and verification

### Files changed

- `artifacts/api-server/src/routes/shops.ts`
- `artifacts/api-server/src/routes/bays.ts`
- `artifacts/api-server/src/routes/bookings.ts`
- `artifacts/api-server/tests/shops-ghost-garage.integration.test.ts`
- `artifacts/api-server/package.json` — focused test command
- `artifacts/mobile/app/(shop-owner)/index.tsx`
- `artifacts/mobile/app/(shop-owner)/organizations.tsx`
- `artifacts/mobile/app/(shop-owner)/bookings.tsx`
- `artifacts/mobile/app/shop/[id].tsx`
- `docs/partner-layer-part3.md`

### Database and API changes

No database schema changes, migrations, table replacements, backfills, or
record reassignments. Existing endpoints and generated contracts are retained.

Shop/bay/booking IDs are now rejected unless positive safe integers. Existing
shop/bay mutation authorization is preserved. Owner booking reads and
cancellations resolve ownership through the actual bay and its parent location,
not a potentially inconsistent denormalized booking location ID. Booking
responses use that actual location ID without rewriting stored records.

New reservations lock and check the actual bay and parent location; both must
be active. This closes the direct-request bypass of inactive locations already
excluded by availability search. Existing reservations remain readable and
retain their existing lifecycle and rate snapshots.

### Partner UI

Owner-only location edits and bay edits/status controls use existing PATCH
APIs. Non-owner readers do not get management controls. All locations remains
the default view; selecting an organization can optionally filter to its
explicitly linked facilities. Linked location cards open existing shop detail.

Booking views show location and bay context with a location filter, existing
reservation intervals, and existing owner cancellation controls. No Partner
booking-creation or mechanic-assignment capability is added.

### Passed checks

- Full workspace typecheck.
- Partner identity/helper tests and existing mobile helper regressions.
- Five Part 2 real-DB organization integration tests.
- All 25 existing backend/AI regression tests.
- Part 3 real-DB integration scenario: legacy login and unlinked locations;
  all existing location classifications; one and multiple organization-linked
  locations; multiple bays; owner and composite-FK mismatch denial;
  bay edit/status/search; mechanic-only booking creation; Ghost transport
  approval gate; overlap rejection; start/complete/cancel; inactive facility
  reservation denial; canonical booking ownership and location responses.
- API build/start and health.
- iOS/Android JavaScript bundles/manifests with 49 assets; not a signed-native
  or physical-device verification.
- Real UI journey: legacy unlinked location creation; all-locations versus
  selected-organization filtering; two explicitly linked locations; linked
  location navigation; location name/phone edit persisted after reload;
  two bays under one location; bay rate/equipment and inactive/active edits
  persisted; owner booking location/bay labels and filter; cancellation.
- Final fixture cleanup verified original counts: 52 users, 4 shops, 4 bays,
  2 bay bookings, and 0 organizations. No legacy records were auto-linked.

### Known limitations

Operating-hours/blackout scheduling is not modeled. Availability continues to
use active facility/bay status and existing reservation intervals.
The legacy auto-approval metadata does not introduce an approval workflow;
the UI no longer describes it as a working separate approval process.
No live provider, billing, push-delivery, or physical-device test is claimed.
The browser edit flow used a linked location; legacy location creation/listing
and unlinked behavior were exercised separately. Cross-owner restrictions were
tested through the focused backend suite rather than duplicated in the browser.
Existing development style warnings and the runtime push-unavailable notice
remain. No new application errors were observed in the browser journey.