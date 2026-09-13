# Business-first account UI (mobile)

## Scope

This change is limited to the Expo mobile app's auth, organization-selection
context, and partner account screens. Customer and mechanic registration keep
their existing fields, home-address verification, mechanic service-radius
branch, and `/auth/register` payload. Business registration is a separate path
that starts with the organization identity and only then collects the primary
owner/admin login.

The create-account chooser now exposes:

- Customer
- Mechanic
- Shop / Repair Facility
- Dealership
- Fleet / Commercial Fleet

The business path uses `POST /auth/register-business` and builds the documented
`business` + `administrator` payload. Business profile fields are legal name,
optional display name/DBA (defaulting to legal name), business email/phone, and
verified business address. Administrator fields are name, login email,
optional phone, and password. A personal home address is not requested or
sent by this path.

## Organization context

The existing `useSelectedPartnerOrganization` hook remains the single
selection mechanism. It validates persisted ids against the current user's
owned organizations, clears stale ids, defaults only when that user owns
exactly one organization, and persists the selected id under the existing
per-user key. Registration initializes that key when the business registration
response includes its organization id. Login continues to restore only a
validated owned organization; it never merges or guesses another account's
organization.

## Organization-scoped Connect and payouts

Business payout UI is included in this mobile scope; it is not an excluded
or deferred Connect integration. The selected organization is the only payout
context used by `artifacts/mobile/app/(shop-owner)/payouts.tsx`. The screen
uses the generated API client for the three organization routes:

- `POST /partner-organizations/:organizationId/payouts/onboard`
  (`beginBusinessOrganizationPayoutOnboarding`)
- `GET /partner-organizations/:organizationId/payouts/status`
  (`getBusinessOrganizationPayoutStatus`)
- `GET /partner-organizations/:organizationId/payouts/login-link`
  (`getBusinessOrganizationPayoutLoginLink`)

The generated client is configured by the mobile auth/base-URL setup. The
generic payout activity endpoints are not yet represented by generated
hooks, so the screen uses the existing configured `customFetch` API boundary
for:

- `/payouts/summary?window=month&organizationId=<selected id>`
- `/payouts/buckets?organizationId=<selected id>`
- `/payouts/jobs?organizationId=<selected id>&limit=20`
- `/payouts/events?organizationId=<selected id>&limit=20`

Every one of those financial calls carries the validated selected
`organizationId`. No generic shop-owner onboarding, status, tax-document, or
login route is used, and the UI never reads or falls back to a legacy
administrator/mechanic payout account. The screen states that legacy accounts
are not business destinations and requires a separate company account.

The dashboard entry is available from both the selected-business dashboard
and profile. It shows the selected business display/legal name, subtype,
business contact (when present), and administrator identity separately.
It handles loading, no organization, organization-list error, inactive/
blocked organization, legacy-account protection, onboarding-required,
connection-status error, financial-data error, dashboard-link error, and
ready states. Onboarding and dashboard links are opened only after the
selected organization has been validated and only while the organization is
active. Mechanic payout screens and their existing user-owned routes remain
unchanged.

## Changed files

- `artifacts/mobile/app/(auth)/register.tsx`
  - five-option chooser, separate business-first registration form, address
    verification, owner/admin credential separation.
- `artifacts/mobile/lib/businessAccount.ts`
  - business payload builder, chooser options, and display-name fallback.
- `artifacts/mobile/context/AuthContext.tsx`
  - optional organization-id initialization at authenticated login.
- `artifacts/mobile/lib/partnerOrganization.ts`
  - validated saved-selection resolver and user-scoped organization-list cache
    key so login transitions cannot reuse another account's organization cache.
- `artifacts/mobile/hooks/useSelectedPartnerOrganization.ts`
  - stale-selection clearing and safe sole-organization default.
- `artifacts/mobile/app/(shop-owner)/index.tsx`
  - selected business dashboard identity, legal name/contact context, and
    organization-scoped payout entry.
- `artifacts/mobile/app/(shop-owner)/profile.tsx`
  - separate administrator identity and selected business profile card.
- `artifacts/mobile/app/(shop-owner)/organizations.tsx`
  - optional legal-name organization editing and selected-business detail.
- `artifacts/mobile/app/(shop-owner)/payouts.tsx`
  - organization-owned Connect status, company onboarding, dashboard login
    link, and organization-scoped payout activity, with explicit blocked,
    legacy, no-context, loading, and error states.
- `artifacts/mobile/app/(shop-owner)/_layout.tsx` and
  `artifacts/mobile/app/(shop-owner)/profile.tsx`
  - hidden organization payout route and selected-business payout entry.
- `artifacts/mobile/scripts/business-account-ui.test.mjs`
  - static regression checks for legacy forms, payload separation, selection
    scoping, business display fallback, generated Connect routes,
    organization-scoped financial calls, and mechanic payout preservation.
- `artifacts/mobile/scripts/partner-foundation.test.mjs`
  - keeps foundation routing checks aligned with the five-option chooser and
    separate business registration branch.
- `artifacts/mobile/package.json`
  - `test:business-account-ui` script.

## Testing and limits

The static regression checks run without a server or device:

```sh
node artifacts/mobile/scripts/business-account-ui.test.mjs
pnpm --filter @workspace/mobile typecheck
pnpm --filter @workspace/mobile test:phase2
pnpm --filter @workspace/mobile test:partner-vehicles
pnpm --filter @workspace/mobile test:partner-service-requests
node --experimental-strip-types artifacts/mobile/scripts/partner-foundation.test.mjs
pnpm --filter @workspace/mobile test:ghost-garage-ui
pnpm --filter @workspace/mobile test:part7-security
```

The business form is intentionally wired to the generated
`useRegisterBusiness` client hook and the three generated Connect operations
listed above. Generic financial activity remains on the documented custom
fetch boundary because those four endpoints are not present in the generated
client. API schema/codegen ownership remains with the backend/API workstream.
Mechanic payout routes remain unchanged. No workflow restart, browser test,
backend migration, or notification fabrication is included here.