# Current-user account architecture correction

> This is a focused business-account correction report, not a Part 7 audit.

## Before

- `/auth/register` was person-only. A person could register as `shop_owner`;
  creating a `partner_organizations` row was a separate optional owner flow.
  That permitted an orphan person-owner and did not make user/org creation one
  identity operation.
- Business identity was not canonical for Connect. Provider state could be
  associated with a user or a shop, while an organization/location relationship
  was optional. Generic owner/shop resolution therefore allowed user/shop
  mismatches and ambiguous legacy account mappings.
- The dashboard/session boundary was human-owner oriented rather than
  explicitly selected-organization oriented. Business contact identity, human
  administrator identity, and payout destination were not consistently
  separated.

## After

- `POST /auth/register-business` accepts strict nested `business` and
  `administrator` objects. It atomically inserts exactly one human user and
  one organization, makes the user the active `shop_owner` and
  `primaryOwnerId`, and returns the normal auth response plus that organization.
- `partner_organizations` remains the only organization table and
  `primaryOwnerId` remains the only ownership relationship. There is no
  duplicated organization table, staff/member model, alternate ownership row,
  or implicit shop/location creation. Locations remain an explicit owner
  workflow.
- Legal identity is separate from display/DBA identity: `legalName` is
  retained independently and `name` is the canonical display value, defaulting
  to the legal name. Business email, phone, address, and optional business
  contact are separate from administrator name, login email, optional phone,
  and password. The administrator email is the human login principal.
- Customer and mechanic individual forms and `/auth/register` behavior remain
  unchanged. The chooser now has five choices: Customer, Mechanic,
  Shop / Repair Facility, Dealership, and Fleet / Commercial Fleet. The three
  business choices use the business-first form and do not ask for a personal
  home address.
- Login restores only a validated organization owned by that user. Selection
  is per-user, stale selections are cleared, and a sole organization is
  selected only when it is actually owned by the current user. The selected
  organization drives dashboard/profile identity, session context, jobs, and
  business payout activity; it is never guessed from an owner, location, or
  first matching row.
- Business jobs may display the linked organization's safe display label, but
  the human `customerId` remains the authorization, payment, review, audit,
  and ordinary-job principal. Mechanic output does not expose business Stripe
  IDs or private organization contacts.

## Schema and migration

- Organization additions are four identity/provider-state fields:
  nullable `legal_name`, `stripe_account_id`, and `stripe_account_type`
  (`individual` or `company`), plus `stripe_account_ready` (non-null default
  `0`). The non-null organization account ID is partially unique.
- Payments add two nullable immutable destination snapshots:
  `payout_organization_id` and `payout_account_id`. They are written before
  provider checkout and are reused for eligible retry; historical rows are
  not rewritten.
- Payout events add nullable `organization_id`, retaining nullability for
  mechanic, legacy, and historical events. Event/payment correlation requires
  an explicit provider identifier and matching immutable snapshot.
- `scripts/src/migrate_partner_business_accounts.mjs` is additive, idempotent,
  and development-only. It requires explicit `NODE_ENV=development`, never
  runs in production, never backfills legacy provider IDs, never reassigns
  historical destinations, and never creates implicit locations.

## API and Connect boundary

- Registration derives role, status, and ownership server-side; callers cannot
  submit role, status, owner, Stripe, or location fields. Duplicate
  administrator email, including a concurrent unique conflict, returns `409`
  with no orphan user or organization. A person-only legacy `shop_owner`
  registration is rejected with a redirect-to-business-signup error.
- The three organization-owned Connect routes are:
  `POST /partner-organizations/:organizationId/payouts/onboard`,
  `GET /partner-organizations/:organizationId/payouts/status`, and
  `GET /partner-organizations/:organizationId/payouts/login-link`.
  Each requires an authenticated active `shop_owner` who is that
  organization's `primaryOwnerId`, plus an active organization and explicit
  `organizationId`.
- The organization owns the company Connect account; the ID is stored only on
  that organization and metadata includes `organizationId`. Generic and old
  shop-owner payout aliases remain compatibility shims but require explicit
  `organizationId`; without it they return actionable `400` and do not read or
  create a user-owned account. Mechanic `/payments/connect/*` and
  `/payouts/connect/status` behavior is unchanged.
- Linked locations use only their exact ready organization's account. A valid
  unlinked legacy shop account is preserved. Cross-table collisions, linked
  shop/legacy mappings, duplicate organization IDs, and ambiguous legacy
  mappings fail closed; ambiguous legacy Connect cases require manual
  resolution.

## UI and changed files

### Runtime and tests

- API runtime:
  `artifacts/api-server/{package.json}`,
  `artifacts/api-server/src/lib/{businessConnect.ts,businessConnect.test.ts,notifications.ts,payoutEventEngine.ts,sharedRegistrationValidator.ts,sharedRegistrationValidator.test.ts,stripeClient.ts}`,
  `artifacts/api-server/src/routes/{auth.ts,dashboard.ts,jobs.ts,partnerOrganizations.ts,payments.ts,payouts.ts,stripeWebhook.ts}`.
- API tests:
  `artifacts/api-server/tests/{business-account-registration.integration.test.ts,business-connect.integration.test.ts,partner-organizations.integration.test.ts,partner-part6-bays.integration.test.ts,partner-service-requests.integration.test.ts,partner-vehicle-operations.integration.test.ts,shops-ghost-garage.integration.test.ts}`.
- Mobile auth/account:
  `artifacts/mobile/app/(auth)/register.tsx`,
  `artifacts/mobile/context/AuthContext.tsx`,
  `artifacts/mobile/hooks/useSelectedPartnerOrganization.ts`,
  `artifacts/mobile/lib/{businessAccount.ts,partnerOrganization.ts}`,
  `artifacts/mobile/package.json`.
- Mobile business screens:
  `artifacts/mobile/app/(shop-owner)/{_layout.tsx,index.tsx,organizations.tsx,payouts.tsx,partner-vehicles.tsx,profile.tsx}`,
  `artifacts/mobile/app/(shop-owner)/service-requests/{[id].tsx,index.tsx,new.tsx}`.
- Mobile regressions:
  `artifacts/mobile/scripts/{business-account-ui.test.mjs,partner-foundation.test.mjs}`.
- Development migration and package wiring:
  `scripts/src/migrate_partner_business_accounts.mjs`,
  `scripts/package.json`.

### Database and API contract/generated outputs

- Database schema:
  `lib/db/src/schema/{partnerOrganizations.ts,payments.ts,payoutEvents.ts}`.
- Source API contract:
  `lib/api-spec/openapi.yaml`.
- Generated React client:
  `lib/api-client-react/src/generated/{api.ts,api.schemas.ts}`.
- Generated Zod client/types:
  `lib/api-zod/src/generated/api.ts`,
  `lib/api-zod/src/generated/types/{businessAuthResponse.ts,businessConnectLoginLinkResponse.ts,businessConnectOnboardingBody.ts,businessConnectOnboardingResponse.ts,businessConnectStatusResponse.ts,partnerOrganization.ts,partnerOrganizationInput.ts,partnerOrganizationUpdate.ts,registerBusinessBody.ts,registerBusinessBodyAdministrator.ts,registerBusinessBodyBusiness.ts,registerBusinessBodyBusinessSubtype.ts}`.
- Shared Zod export/validator:
  `lib/api-zod/src/{index.ts,sharedRegistrationValidator.ts}`.

### Contract and evidence docs added with this work

- `docs/business-account-{contract.md,backend.md,mobile.md,browser.md}` and
  `docs/business-connect-contract.md`.

## Verification

- Business registration integration: **4/4**. Covers customer, mechanic, all
  three business subtypes, independent contacts, strict caller-field
  rejection, duplicate rollback, login/`/auth/me`, multiple organizations,
  explicit locations, and commercial identity sanitization.
- Existing partner regressions: **16/16** (**7** passed first; **9** passed
  after fixture adaptation and rerun).
- Connect unit: **10/10**. Connect development-DB integration: **1/1**, using
  a mocked provider and scoped development fixtures; it made no Stripe calls.
- API library/route unit regressions: **46/46**, including the 10 Connect
  cases above, registration validation, payment-state guards, and sanitization.
- Mobile business-account static regression: **PASS**. The source docs/script
  report pass but publish no numeric case total, so no mobile denominator is
  claimed here.
- Browser real-UI signup: **5/5** for Customer, Mechanic, Shop, Dealership,
  and Fleet, including separate administrator/business identity and
  organization selection context; no Stripe calls were made.
- Browser administrator login/reload: **PASS** for all three business types.
  Second-organization selection survived logout/login; cross-owner organization
  and location requests returned 404 without disclosing foreign context.
- Root `pnpm typecheck`: **PASS**. Independent targeted review: **PASS**; payment retry keeps
  one canonical row and its immutable snapshot, collisions fail closed, and
  payout events map only through verified account/payment identity.

## Cleanup and limitations

- Browser and integration fixtures were removed. Final development counts:
  53 users, 4 shops, 4 bays, 2 bookings, 13 vehicles, 12 ownership-history rows,
  8 jobs; zero organizations, vehicle operations, and service requests.
  The earlier snapshot listed 52 users. The additional unclassified account
  was preserved, not assumed to be disposable test data.

- A legacy provider-referenced payment without a new verified snapshot is
  explicitly blocked from retry until its mapping is verified; the system
  never guesses. Ambiguous legacy Connect mappings require operator
  resolution.
- No live Stripe onboarding, live payout/charge, or production migration was
  performed. Existing Part 7 webhook/provider/native blockers are not
  certified by this correction, and this is not a claim of complete Part 1–7
  coverage; the focused existing regressions listed above pass.
- No Parts Catalog, fee, dispatch, lifecycle, or commissions behavior changed.
- The mechanic browser dashboard still showed the existing three HTTP 403
  resource failures while signup/profile and expected `PENDING` status worked;
  that access state was observed and left untouched.