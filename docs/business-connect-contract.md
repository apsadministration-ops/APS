# Business Connect ownership contract

This is the frontend/backend contract for organization-owned Stripe Connect
accounts. It is intentionally separate from the mechanic Connect contract.
Mechanic onboarding continues to use the existing user-owned routes and
`users.stripeAccountId`.

## Canonical owner

The canonical business Connect account belongs to one
`partner_organizations` row. The organization is identified by the explicit
`organizationId` path parameter, and its account is stored only on that row:

| Field | Type | Meaning |
| --- | --- | --- |
| `stripeAccountId` | nullable `text` | Stripe Express account ID |
| `stripeAccountReady` | `integer`, default `0` | `1` only when charges, payouts, and details are enabled |
| `legalName` | nullable `text` | Legal company name used to prefill Connect |

The account's Stripe metadata contains `organizationId`. `stripeAccountId` is
partially unique among non-null organization values. No organization account
is copied to `users` or `shops`.

Checkout writes the destination snapshot to the payment before creating the
provider session:

| Payment field | Meaning |
| --- | --- |
| `payoutOrganizationId` | nullable canonical organization resolved for a shop destination |
| `payoutAccountId` | nullable immutable Stripe connected-account ID used for the transfer |

These fields intentionally remain nullable for historical payments. The
development migration never backfills, rewrites, or reassigns old payment
destinations.

All business routes require an authenticated, active `shop_owner` who is the
organization's `primaryOwnerId`, and an organization with `status = active`.
An organization ID is never inferred from the current user, owner, location,
or the first matching row.

## Routes

The API is mounted below `/api`.

The canonical three routes below are also present in
`lib/api-spec/openapi.yaml` under the `business-connect` tag. Orval 8.22
generates their React client operations and response types; provider account
IDs are returned only by these authenticated owner-scoped operations and are
not part of public organization or mechanic-facing schemas.

### Create or resume onboarding

`POST /partner-organizations/:organizationId/payouts/onboard`

Request body: `{}` (no client-owned Stripe or payout fields are accepted).

Response `200`:

```json
{
  "organizationId": 42,
  "accountId": "acct_...",
  "ready": false,
  "url": "https://connect.stripe.com/..."
}
```

The first request creates one Express company account using the provider
idempotency key `business-connect:organization:42:account`. It prefills the
organization's legal/display name, email, phone, and structured address and
sets metadata `{ "organizationId": "42" }`. A retry resumes the same account
and creates a fresh account-link URL. The database row is locked while the
account ID is persisted.

Errors include:

* `400` — malformed or missing organization ID;
* `403` — caller is not an active primary owner;
* `404` — organization is not owned by the caller;
* `409` — organization is inactive;
* `503` — public URL or Stripe provider is not configured.

### Read readiness

`GET /partner-organizations/:organizationId/payouts/status`

Response `200`:

```json
{
  "organizationId": 42,
  "accountId": "acct_...",
  "ready": true,
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "detailsSubmitted": true
}
```

Before onboarding, `accountId` is `null` and all readiness flags are
`false`. The status route refreshes the provider state and persists only
`partner_organizations.stripeAccountReady`.

### Open the Express dashboard

`GET /partner-organizations/:organizationId/payouts/login-link`

Response `200`:

```json
{
  "organizationId": 42,
  "accountId": "acct_...",
  "url": "https://connect.stripe.com/..."
}
```

The route returns `400` with an actionable onboarding error when the
organization has no account. It never creates an account.

## Legacy route behavior

The old shop-owner Connect routes remain only as compatibility shims:

* `POST /payouts/shop/connect/onboarding`
* `GET /payouts/shop/connect/status`
* `GET /payouts/tax-documents`
* generic `/payouts/onboard`, `/payouts/status`, and `/payouts/login` aliases

For a shop owner, each requires an explicit `organizationId` body/query
parameter and delegates to the organization-owned account. Without that
parameter it returns an actionable `400` (`organizationId is required; use
the organization payout route`) and does not create or read a user-owned
account. The existing mechanic `/payments/connect/*` and
`/payouts/connect/status` routes are unchanged.

Existing unlinked legacy shops with a valid `shops.stripeAccountId` and ready
state retain their documented destination snapshots. They are not silently
switched to an organization account. A linked shop uses only its exact
`shops.organizationId` organization's ready account; a linked shop with no
ready organization account fails closed.

## Checkout destination

Shop-destination checkout resolves:

1. the explicitly persisted `payment.shopId`;
2. the shop's explicit `organizationId`, when present;
3. that organization's canonical ready account, with the shop owner and
   source organization association checked exactly.

Customers cannot select an arbitrary organization or payout destination.
Mechanic-destination checkout is unchanged. Destination, organization, and
account IDs are snapshotted atomically before provider checkout and cannot be
changed after checkout starts. An abandoned pending/failed/cancelled checkout
resumes on the same canonical payment row after the old Checkout Session or
PaymentIntent is expired/canceled, using the saved snapshot rather than
re-resolving a changed organization. A historical provider-referenced payment
without a verified account snapshot fails closed with an explicit legacy
resolution error; it is never guessed from current owner/location mappings.
Captured/refunded/paid rows remain non-retryable.

An unlinked legacy shop can continue using its already-valid shop account.
Multiple legacy account IDs, a linked shop/account mismatch, or any
organization/user/shop account collision blocks new onboarding or checkout
until an operator explicitly resolves the mapping. There is no automatic
migration, owner-based inference, or account stealing.

## `account.updated`

Webhook handling resolves the account ID in this order only when the mapping
is unambiguous:

* one canonical organization account → update that organization's readiness;
* one mechanic user account → update the existing mechanic readiness field;
* one deliberate unlinked legacy shop account → update that legacy shop's
  readiness.

Cross-table collisions, duplicate rows, linked-shop legacy mappings, and
ambiguous legacy IDs are fail-closed and do not update an arbitrary row.

Payout events retain nullable `organizationId` scope. An event is linked to a
payment only by an explicit provider transfer/payout ID whose immutable
payment account snapshot matches the event account. Account-level provider
payouts with no explicit payment linkage remain organization-scoped but are
not assigned to an arbitrary payment.

## Financial dashboard scope

Business payout summaries, buckets, job lists, and event views require an
explicit `organizationId` query parameter for a shop owner. When provided,
jobs and financial rows are limited to that organization and its explicitly
linked locations. A business job detail also checks that the path's job
organization equals the selected organization. Mechanic payout metrics
continue to use their existing mechanic scope. No new fees, percentages,
split-payout behavior, or native provider capabilities are introduced by this
contract.

## Development verification

Apply the additive, idempotent development correction before exercising the
organization fields (it never backfills IDs, rewrites rows, creates locations,
or runs in production). It adds nullable payment destination snapshots
(`payments.payout_organization_id`, `payments.payout_account_id`) and nullable
event organization scope (`payout_events.organization_id`) without changing
historical rows:

```sh
NODE_ENV=development node scripts/src/migrate_partner_business_accounts.mjs
```

Pure ownership/helper tests use no database or provider:

```sh
pnpm --filter @workspace/api-server run test:business-connect
```

The scoped database integration uses fixture rows and a mocked provider only;
it never calls Stripe and removes its rows in dependency order. Run it only
against a development database:

```sh
RUN_BUSINESS_CONNECT_INTEGRATION=1 NODE_ENV=development \
  pnpm --filter @workspace/api-server run test:business-connect-integration
```

The integration covers primary-owner versus other-organization access,
multiple organizations under one owner, multiple linked locations sharing the
canonical account, legacy user/shop mapping collisions, `account.updated`
readiness mapping, immutable organization/account payment snapshots across an
account change, explicit transfer/payout event linkage, organization event
visibility with other-owner denial, arbitrary-organization rejection, and
preservation of existing payment destination snapshots. It also verifies
abandoned/cancelled checkout retry on the same payment row, old-session
expiration, mapping-change snapshot reuse, paid-terminal rejection, legacy
provider rows without snapshots, and ambiguous duplicate rows without
deletion.
