# Business account backend findings and implementation notes

The existing backend already has the required business boundary:
`partner_organizations.primaryOwnerId` points at a `users` row with the
existing `shop_owner` role. The implementation therefore keeps the existing
table and relationship, adds `legalName` and organization-level Connect state,
and does not add memberships, a person/business account table, or automatic
shop locations.

## Existing commercial job boundary

Part 6 commercial jobs are linked by
`jobs.sourceOrganizationId` + `jobs.sourceServiceRequestId`; the bridge checks
the exact organization owner/request/operation/location relationship. The job
still stores the primary owner in `customerId` for existing payment, approval,
review, invoice, and audit behavior. Private service-request notes and
creation context are not copied into mechanic-facing job descriptions.

The job and dashboard formatters resolve a linked organization only from the
complete source reverse-link. Mechanic-safe commercial output remains
sanitized (no organization contact or Stripe fields), while the business
display label is used instead of the administrator's personal name. Ordinary
customer jobs continue to use the human user's name.

Push notification helpers apply the same scoped lookup for customer-facing
commercial titles/bodies. The recipient is still the `customerId` primary
owner's push token; no membership recipient or parallel notification system
was introduced.

## Migration posture

`scripts/src/migrate_partner_business_accounts.mjs` is a development-only,
additive, idempotent correction. It adds nullable legal/Connect columns and a
partial unique index for non-null organization Connect IDs. It does not
backfill legacy IDs, rewrite rows, create locations, or run in production.
Schema changes should still flow through the normal development/publish
process.

The authorized development invocation is:

```sh
NODE_ENV=development DATABASE_URL="$DEV_DATABASE_URL" \
  node scripts/src/migrate_partner_business_accounts.mjs
```

The script refuses to run unless `NODE_ENV=development` is explicit.

## Focused verification

The business registration integration suite covers:

- customer, mechanic, legacy shop owner, and all three business subtypes;
- independent administrator and business contacts;
- strict extra/owner/Stripe field rejection;
- duplicate administrator rollback/no orphan rows;
- multiple organizations under one existing owner;
- login and `/auth/me`;
- existing organization create/edit and explicit location workflow;
- source-linked commercial job identity and mechanic sanitization.

The normal customer/mechanic registration path and fee, payment, payout,
webhook, and job lifecycle code remain unchanged.