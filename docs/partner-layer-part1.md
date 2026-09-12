# Commercial Partner expansion — Part 1

## Existing architecture

- Account roles are `customer`, `mechanic`, `admin`, and `shop_owner`. Partner
  registration, session identity, authorization, and generated API contracts
  already use `shop_owner`.
- Partners enter `/(shop-owner)` through the shared role destination mapping.
  Existing navigation includes Locations, Vehicles, Post Job, Invoices,
  Bookings, and Profile.
- `shops` represents owner-linked locations with existing `partnerKind` values:
  `independent_shop`, `dealership`, `fleet`, and `gsa`. This is location-level
  classification, not a new organization/membership model.
- `bays` and `bayBookings` link locations, jobs, and mechanics. Ghost Garage
  rental and booking workflows are existing functionality to preserve.
- Existing shop, bay, booking, and partner-job APIs enforce roles and ownership.
  Partner job posting already has subtype restrictions; this part does not
  change those restrictions or claim to complete dealership/fleet functionality.
- Database schema lives under `lib/db/src/schema`; API routes and authorization
  under `artifacts/api-server/src`; source/generated contracts under the API
  spec, API Zod, and API client packages. No contracts are changed here.

## Naming and compatibility strategy

The user-facing name is **Dealer / Fleet / Shop**. It is still the Partners
Layer internally, covering shops, Ghost Garages, dealerships, fleets, and
commercial businesses. Shared display copy now supplies the partner signup
option, dashboard heading, and profile badge.

Keep `shop_owner`, `/(shop-owner)`, existing endpoint paths, IDs, ownership,
permissions, and generated role enums unchanged. Do not alias new account
roles or require existing users to register again. Do not rename Ghost Garage
workflow terminology.

Part 2 should extend this shared commercial system additively rather than
create disconnected Dealer, Fleet, and Shop systems. Organization structure,
memberships, subtype semantics, verification, and onboarding are deliberately
deferred. Do not interpret `gsa` as generic Commercial Business or automatically
reclassify Ghost Garage users; those mappings are not established by Part 1.

## Files changed

- `artifacts/mobile/lib/partnerIdentity.ts` — shared display identity.
- `artifacts/mobile/app/(auth)/register.tsx` — partner option label and
  partner-only explanatory text; no fields or submission logic changed.
- `artifacts/mobile/app/(shop-owner)/index.tsx` — partner identity copy only.
- `artifacts/mobile/app/(shop-owner)/profile.tsx` — partner badge only.
- `artifacts/mobile/scripts/partner-foundation.test.mjs` — identity and
  legacy routing checks.
- `docs/partner-layer-part1.md` — foundation and compatibility boundaries.

## Database, routes, and protected scope

No database changes, migrations, data writes, endpoint changes, route changes,
role changes, or generated contract changes. Existing accounts, locations,
bays, bookings, and Ghost Garage behavior remain unchanged.

No Customer or Mechanic layer files or workflows changed. The sole shared
signup edit is partner display copy; customer/mechanic options, validation,
address handling, and registration payload behavior are unchanged.

No contracts, bulk requests, dispatch, acceptance, completion, earnings, or
new dealership/fleet features were implemented.

## Verification

PASS: focused partner identity/legacy routing checks, existing mobile helper
regressions, mobile TypeScript check, and whitespace/diff validation. Metro
restarted and served the registration preview successfully. At 402px width,
the new partner label fits the existing selector without changing the Customer
or Mechanic options. Existing Expo patch-version and browser deprecation
warnings remain; no dependency changes were made.

No accounts were created or modified, and no database writes were needed for
this display-only update. Full role/booking E2E tests were not rerun in Part 1.

Run the focused checks with:

```sh
node --experimental-strip-types artifacts/mobile/scripts/partner-foundation.test.mjs
pnpm --filter @workspace/mobile run test:phase2
pnpm --filter @workspace/mobile run typecheck
```

Part 1 stops here. Parts 2–6 require separate implementation passes.