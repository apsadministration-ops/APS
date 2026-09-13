# Business account registration contract

This contract adds a business-first signup path without adding an organization
membership model. A signup creates exactly one `users` row and one
`partner_organizations` row in the same transaction; the user is the
organization's `primaryOwnerId`.

## `POST /auth/register-business`

The request JSON is exact (`additionalProperties: false` at every level):

```ts
{
  business: {
    legalName: string;
    name?: string; // DBA/display name; defaults to legalName
    subtype: "shop" | "dealership" | "fleet";
    email: string;
    phone: string;
    address: string;
    city: string;
    region: string;
    zipCode?: string;
    contactName?: string;
  };
  administrator: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  };
}
```

`business` and `administrator` are validated independently. Business email
and phone are always required; administrator phone is optional. The
administrator email is the login principal and is intentionally independent of
the business contact email. No role, status, `primaryOwnerId`, Stripe, or
location fields can be supplied by the caller.

The server derives `role: "shop_owner"`, `status: "active"`, and
`primaryOwnerId: administrator.id`. `administrator.name` and contact details
populate the user; `business.name` (or `business.legalName`) is the canonical
organization display name. `business.legalName` is retained separately.
Subtype-specific required fields are not introduced.

Successful registration returns the ordinary auth response plus an
organization object:

```ts
{
  token: string;
  user: User;
  organization: PartnerOrganization;
}
```

The organization response does not include Stripe identifiers. `stripeAccount`
fields are internal Connect-helper fields and are not public registration or
mechanic-context fields.

Existing owner-only `POST /partner-organizations` and
`PATCH /partner-organizations/{organizationId}` accept optional validated
`legalName`; `name` remains the canonical display/DBA value. Existing
`businessLicense` and EIN fields remain location-editor fields and are not
required by signup.

The user insert and organization insert are atomic. Duplicate administrator
login email (including a concurrent unique conflict) returns `409` and leaves
no user or organization row. Existing `/auth/register`, `/auth/login`, and
`/auth/me` behavior is unchanged. A person-only `shop_owner` request to the
legacy route is rejected with a redirect-to-business-signup error rather than
creating an orphan owner.

## Organization identity and jobs

`partner_organizations` remains the only organization table and
`primaryOwnerId` remains the only ownership relationship. There are no staff
memberships or alternate ownership rows. No shop/location is created by
registration; locations remain an explicit owner workflow.

For a commercial source-linked APS job, owner-facing identity labels may use
the linked organization's canonical display `name` (and legal name where a
legal label is specifically requested). `jobs.customerId` remains the human
principal for authorization, payments, reviews, audit, and ordinary customer
jobs. Mechanics never receive business Stripe IDs, private organization notes,
or unauthorized business contact information. Ordinary customer jobs continue
to display the human user's name.

Notifications continue to target the primary owner user's push token. A
commercial notification may use an organization-scoped title/body, but no new
notification subsystem or membership recipient is introduced.

## Connect-helper schema handoff

`partner_organizations` adds these nullable/provider-state fields:

| field | SQL/type | contract |
| --- | --- | --- |
| `stripe_account_id` | `text`, nullable | opaque Connect account ID; unique only when non-null |
| `stripe_account_ready` | `integer NOT NULL DEFAULT 0` | provider readiness state |
| `stripe_account_type` | nullable enum `"individual" \| "company"` | Connect account type; business onboarding should use `"company"` |

The migration is additive and does not backfill legacy Connect IDs. Stripe
fields are not accepted in registration or organization create/edit payloads.