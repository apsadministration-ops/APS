# Part 7 backend security and authorization audit

**Checked:** 2026-09-13 (UTC)  
**Scope:** `artifacts/api-server/src`, the mounted route families in
`src/routes/index.ts`, the authentication middleware, database authorization
predicates, and focused regression tests. This is a backend source and
fixture-test audit. It is not a claim that every endpoint has been exercised
against a deployed service.

## Executive summary

The audit reviewed authentication, account status, role checks, object-level
authorization, partner-organization tenancy, job/vehicle/work-history access,
media, messages, inspections, ratings, loyalty, referrals, payments/payouts,
and the Ghost Garage partner surface.

The following confirmed authorization or data-minimization defects were fixed:

1. A report could attach an unrelated job, or a job involving different
   participants, to its target. The report body is now schema-validated, the
   job must exist, and the reporter/target must match the job participants.
2. A mechanic profile returned private contact, referral, loyalty, balance,
   and account-status fields to every authenticated viewer. Other viewers now
   receive only the public mechanic profile; the mechanic and admins retain
   the private view.
3. A historical booking could be cancelled by an account that retained the
   old role/ownership relationship. Cancellation now requires an active,
   canonical assigned mechanic or active canonical shop owner (admins remain
   allowed).
4. An inactive mechanic could cancel an APS job, rate a customer, submit/edit
   a review, or create a flag. These state-changing surfaces now reject
   inactive mechanics; job cancellation additionally uses an explicit active
   assigned-mechanic authorization helper.
5. Vehicle detail responses exposed the current owner's email and phone to a
   past owner or to a mechanic who only had historical access. Contact is now
   returned only to the current owner, an admin, or a mechanic with an
   active assigned job (`ACCEPTED`, `EN_ROUTE`, or `IN_PROGRESS`). Historical
   vehicle access retains vehicle/service data but not unrelated contact data.

Payment/Stripe behavior, fee or commission calculations, dispatch policy, and
bay-availability semantics were not changed by this audit. Payment and bay
items called out below are report-only.

## Review method and evidence classification

The route inventory was derived from `src/routes/index.ts` and each mounted
route module. For each family, the review compared:

* authentication middleware and the fresh database-backed role/status loaded by
  `authenticate`;
* role/status chokepoints (`requireRole`, `requireActiveMechanic`, and
  `requireShopOwner`);
* object predicates using the authenticated user ID, job participant IDs,
  vehicle ownership, shop ownership, or partner organization owner;
* output formatting and whether private fields cross an authorization boundary;
* numeric/path parsing, Zod/API-schema validation, query escaping, and
  parameterized Drizzle SQL; and
* state transitions, conditional updates, row/advisory locks, idempotency, and
  optimistic versions where concurrent writes matter.

Labels in the route matrix mean:

* **focused-tested** — covered by the ten focused tests listed below;
* **fixture-tested** — an existing repository fixture/integration suite covers
  material behavior, but it was not rerun as part of this focused audit;
* **static-reviewed** — route and data predicates were inspected in source;
* **not runtime-certified** — no authenticated HTTP/browser run is claimed here.

Focused verification after dependencies became available:

```text
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server exec tsx --test \
  src/lib/authorization.test.ts \
  src/lib/userProfile.test.ts \
  src/routes/vehicles.test.ts
```

The API typecheck passed. The focused run passed all **10/10** tests:
authorization state gates (including linked flags, booking cancellation, and
job cancellation), public profile formatting, and vehicle contact formatting.
`git diff --check` also passed during the change. The focused tests are pure
helper/formatter tests; they do not replace authenticated route-level HTTP
tests.

## Authentication, sessions, and trust boundaries

### Authentication and session behavior

`authenticate` requires a `Bearer` token, verifies the JWT signature and
expiry, then reloads the user by ID from the database before setting
`req.userId`, `req.userRole`, and `req.user`. This second lookup is important:
role and account-status changes take effect on the next request instead of
waiting for a token to expire. Suspended accounts are rejected with `403`.
Pending mechanics may log in for approval UI, but sensitive mechanic actions
use `requireActiveMechanic`.

Production startup requires a configured `SESSION_SECRET` of at least 32
characters. Access tokens have a seven-day TTL. There is no server-side
token-revocation/session table: logout or a stolen token remains valid until
expiry unless the account is suspended or otherwise denied by a route. This
is a documented residual session risk, not an architectural change made in
this audit.

Registration assigns mechanics `pending` and other ordinary accounts
`active`; login rejects suspended accounts. Password reset uses bounded,
schema-validated input and privacy-safe responses. Admin bootstrap is
unauthenticated by design but requires a configured `ADMIN_SETUP_KEY`; the
comparison uses length checking and `crypto.timingSafeEqual`.

### Role and status gates

* `requireRole("admin")` protects admin finance, growth, integrations, parts
  catalog, moderation, payout overview, and destructive moderation actions.
* `requireActiveMechanic` protects job acceptance/status work, work logs,
  inspections, transport mutations, bay booking lifecycle, mechanic payout
  onboarding, loyalty redemption, amplification, and other sensitive
  mechanic actions.
* `requireShopOwner` requires both `shop_owner` role and `active` status for
  shop and partner-management routes.
* Where a route intentionally allows both a customer and mechanic, it checks
  the authenticated ID against the job's customer/mechanic column. A role
  check without that object check is not treated as sufficient.

The explicit status checks added to reviews, flags, job cancellation, and
customer ratings cover older route handlers that predated the centralized
middleware gate.

## Route-family authorization and tenancy matrix

The following matrix is the complete mounted backend family inventory. Paths
are grouped where they share the same authorization boundary; the route
source remains authoritative for exact payloads and lifecycle details.

| Family / representative paths | Authentication and role/status boundary | Object, tenant, and output boundary | Evidence / residual coverage |
| --- | --- | --- | --- |
| `health.ts` — `GET /healthz` | Intentionally public liveness endpoint. | Returns health state only; no user or tenant data. | Static-reviewed; deployment/network exposure is not runtime-certified. |
| `auth.ts` — register, login, `/auth/me`, admin setup | Register/login are public with API schemas; `/auth/me` uses `authenticate`; admin setup requires configured setup secret. | User rows are selected by normalized email or authenticated ID. Mechanic registration is pending. | Static-reviewed; password-reset fixture exists. Admin setup input still deserves a dedicated bounded schema. |
| `passwordReset.ts` — forgot/reset request, token view, reset | Public, rate-limited reset flow. | Reset token and user lookup are server-controlled; forgot response avoids account enumeration. | Fixture suite exists; not rerun here. |
| `users.ts` — admin list/delete, self read/update, mechanic profile, push token | Admin list/delete use `requireRole("admin")`; self endpoints compare `req.userId`; push token updates the authenticated row. | `/users/:id` is self/admin only. Mechanic profiles retain reputation fields but private profile/earnings are now self/admin only. | `userProfile.test.ts` and focused run. Self-update remains a validation follow-up. |
| `mechanics.ts`, `reviews.ts` — directory, reviews, reputation, badges | Authenticated reads; review author must be the customer or assigned mechanic on a completed/paid job; admin moderation only. Inactive mechanics are rejected from review create/edit. | Job participant and author ID checks prevent review IDOR; hidden reviews are masked by visibility lock. | Static-reviewed and focused review status guard; no full HTTP review suite. |
| `vehicles.ts` — vehicle list/create/remove/detail/history | Authenticated. Vehicle detail/history checks admin, current/past ownership, or mechanic assignment to a non-cancelled job. Workbench subroutes require the exact assigned job. | Partner shop vehicle list is owner/admin only. Transfer requires current ownership. Vehicle formatter now minimizes current-owner contact by purpose. | `vehicles.test.ts` and typecheck; route database predicates not runtime-certified. |
| `ownership.ts` — `GET /ownership/:vehicleId` | Authenticated. Admin or a current/past owner only. | Full ownership chain is not returned to unrelated mechanics; mechanic history uses worklog/vehicle gates. | Static-reviewed; negative HTTP cases not run here. |
| `jobs.ts` — list, available, create, detail, status, accept, cancel, location, delete, ratings | Authenticated. Customer lists are customer-scoped; available jobs require active mechanics and tier/visibility rules; accept/status/location require active assigned/eligible mechanics; delete is admin. | Detail checks customer, assigned/requested mechanic, commercial owner, eligible bidder, or admin. Cancel now requires customer ownership or an active assigned mechanic and limits state transitions. Ratings compare customer/mechanic IDs and job state. | Focused authorization tests for cancellation; existing job/browser evidence is separate. |
| `messages.ts` — job message list/send | Authenticated job participant or admin. | Both read and write compare the job's customer/mechanic IDs; sender is always `req.userId`. | Static-reviewed; content length is a report-only validation gap. |
| `worklogs.ts`, `inspections.ts` — worklog writes/reads and job inspections | Worklog writes and inspection writes require active mechanics. Reads use vehicle ownership, assigned service relationship, or admin checks. | Worklog/inspection IDs and VINs are tied back to the job/vehicle relationship; mechanics cannot browse arbitrary work history. | Static-reviewed; no route-level negative suite in this audit. |
| `workConfirmations.ts`, `customerApprovals.ts` — confirmation, dispute, transport approval | Authenticated customer/partner owner/assigned mechanic as appropriate; sweep is admin-only. | Each job lookup is followed by participant or canonical commercial-owner checks; confirmation/dispute status must be pending/valid. | Static-reviewed; state helper tests cover confirmation authorization. |
| `transport.ts`, `jobLiftRequirements.ts` — transport reads/legs and lift requirement | Reads are job-participant/admin; leg mutations and lift writes require active assigned mechanics. | Leg IDs are constrained to the requested job; customer transport approval is checked before relevant work. | Static-reviewed and partner/bay fixture source evidence; no live transport run. |
| `parts.ts` — VIN decode, recommendations, orders, customer view, catalog | Mechanic/admin chokepoint rejects customers and pending mechanics; admin catalog CRUD/flagged queue use admin role. | Recommendations/orders require assigned mechanic or admin. Customer view permits only job customer, mechanic, or admin and strips supplier/internal fields. | Static-reviewed; arbitrary VIN decode/profile persistence is an integrity follow-up. |
| `mechanicWorkspace.ts` — workspace, notes, installed parts, recommendations, compatibility | `/mechanic` router is authenticated and mechanic/admin; write/read operations also bind records to the assigned vehicle/job. | Workbench access requires exact vehicle and job context; owner/past mechanic cannot use live workbench endpoints. | Static-reviewed; not runtime-certified. |
| `dashboard.ts`, `assistant.ts` — role dashboards and AI assistant | Customer/admin dashboard role gate; mechanic dashboard active gate; assistant authenticated. | Dashboard queries are role-scoped. Assistant context loader receives authenticated user ID/role and loads only permitted job/vehicle context. | Static-reviewed; provider behavior and prompt/data leakage are not runtime-certified. |
| `favorites.ts`, `referrals.ts`, `loyalty.ts` — personal preferences and balances | Authenticated; role-specific loyalty endpoints; mechanic redemption requires active mechanic. | Queries use `req.userId`, so another user's balances/referrals/favorites are not addressable by a supplied ID. | Static-reviewed; focused role helper evidence only. |
| `flags.ts` — list/create/resolve | Authenticated list/create; resolve is admin. Mechanics must be active to create. | Target user and optional job are validated. A linked job must exist, and reporter/target must be the actual participants. | `authorization.test.ts`; focused 10/10 run. |
| `disputes.ts` — participant read, admin resolve | Authenticated participants/admin read; resolve requires admin and valid open/under-review state. | Non-admin query is filtered to customer/mechanic IDs; detail repeats object check. Stripe chargeback outcomes are constrained to `under_review`. | Static-reviewed and dispute helper tests; no payment behavior changed. |
| `tips.ts`, `invoice.ts` — job tips and invoices | Authenticated customer/participant checks; tip creation is rate-limited. | Job customer/assigned mechanic/commercial owner predicates are used; invoice customer-of-record is derived server-side. | Static-reviewed; hosted provider/device behavior not certified. |
| `payments.ts` — checkout, payment reads, release/refund, Connect | Checkout is authenticated and job/customer scoped; release/refund are admin; mechanic Connect uses active mechanic gate. | Payment rows are selected by job ownership/participant and provider IDs remain server-side. | **Report-only payment review.** Stripe/provider state, idempotency, and financial reconciliation were not changed or live-tested in this audit. |
| `payouts.ts` — summaries, job detail, retry, tax docs, Connect, destination | Caller job sets are derived from customer, assigned mechanic, or canonical commercial owner; admin overviews are admin-only; retry uses active assigned mechanic/admin state helper; shop Connect requires active shop owner. | Per-job destination additionally checks canonical posted shop/organization ownership inside a transaction. | Static-reviewed and state helper tests; provider behavior not runtime-certified. |
| `shops.ts`, `bays.ts` — shops, bays, availability | Shop create/update and bay create/update use active `requireShopOwner`; reads validate canonical shop/bay relationships. | A shop owner cannot edit another shop/bay by ID. Bay discovery is authenticated and filters eligibility. | Existing Ghost Garage/Part 6 fixture source evidence; bay semantics are documented separately and not changed here. |
| `bookings.ts` — booking create/read/start/complete/approve/reject/cancel | Creation/start/complete require active assigned mechanic; approval/rejection require active canonical shop owner or admin; cancellation now uses active actor and canonical ownership helper. | Booking detail and mutation look up the booking's mechanic, bay, and shop before allowing state changes; cancellation reasons are bounded. | `authorization.test.ts`; existing partner bay fixture available but not rerun here. |
| `progression.ts`, `amplification.ts` — mechanic progression/certifications and public amplification | Progression reads/writes are role-bound to `/mechanic/me`; admin certification/promotion routes are admin. Amplification private routes require active mechanic; public cards use referral-like code only. | Self routes never accept another mechanic ID; admin routes use explicit target IDs. | Static-reviewed; public card content/contact policy needs product review. |
| `growth.ts`, `media.ts`, `integrations.ts` — admin growth/content/media/provider settings | Router-level `authenticate + requireRole("admin")` covers admin growth and integrations, including nested media routes. Public media files require a strict filename extension/character allow-list. | Content/media IDs are admin-only; file path is derived from a constrained filename under the media directory. | Static-reviewed; AI provider/file serving not runtime-certified. |
| `adminFinance.ts` — global finance, jobs, mechanics, flagged feed | Router-level admin authentication and role gate. | Global queries are intentionally platform-wide and not user-tenant scoped because this is admin finance. | Static-reviewed; no admin HTTP run. |
| `tierCatalog.ts` — public catalog and authenticated quote | Catalog is public; quote requires authentication. | Quote derives vehicle/service eligibility from server catalog and authenticated caller context, not client price authority. | Static-reviewed; no pricing/fee changes. |
| `partnerJobs.ts` — commercial/partner job posting | Active `requireShopOwner`; shop owner/admin ownership exception is checked against the selected shop. | Partner kind must be dealership/fleet/GSA; vehicle must belong to that shop for non-admins; shop and vehicle status are checked. | Partner commercial fixture exists; not rerun here. |
| `partnerOrganizations.ts` — organization CRUD and location linking | All routes require active shop owner. | Every organization query includes `primaryOwnerId`; locations include organization and owner IDs. Inactive organizations cannot link locations. Transaction locks serialize subtype/status/link changes. | Partner organization fixture exists; static predicates reviewed. |
| `partnerVehicleOperations.ts` — partner vehicle operation list/create/link/update | Active shop owner only. | Organization, subtype, location owner, vehicle ID, and operation ID are all joined/scoped. Inactive organization/location writes fail; unknown fields and subtype-specific fields are rejected. VIN operations use advisory/row locks. | Partner vehicle fixture exists; static predicates reviewed. |
| `partnerServiceRequests.ts` — partner request list/create/detail/update/transition | Active shop owner only. | Organization owner, operation, vehicle, and location are locked/scoped together. Request paths include organization ID; optimistic `version` and idempotency fingerprint prevent cross-tenant/stale writes. | Partner service-request fixture exists; static predicates reviewed. |
| `commercialServiceRequests.ts` — send partner request to APS | Active shop owner only. | Organization/request/operation/vehicle/location are all checked under ownership and transaction locks; only submitted dealership/fleet requests bridge into an APS job. | Partner commercial fixture exists; this audit did not rerun it. |
| `admin` moderation/parts/growth/media surfaces | Admin role gates are applied at router or route level. | Target IDs are looked up server-side, state transitions use allowed current states, and public/customer serializers omit internal fields. | Static-reviewed; broad admin HTTP negative coverage remains untested. |

### Partner tenancy conclusion

The partner family uses the authenticated `primaryOwnerId` as its tenant key;
organization IDs supplied by clients are never accepted without an owner
predicate. Child rows (locations, vehicle operations, service requests) are
scoped by both parent organization and owner. The Part 6 fixture suites also
contain cross-organization cases and stale-detail/browser evidence, but this
audit did not relaunch browser tooling or rerun those suites.

## Confirmed findings and fixes

### F-01 — Job-linked flag participant integrity — fixed

`POST /flags` previously accepted a `jobId` reference without proving that the
reporter and target were the participants in that job. This allowed a
misleading moderation record and could attach evidence from an unrelated
interaction. The route now uses a bounded Zod payload, verifies the target
exists, verifies the job exists, and calls `canCreateJobFlag`. Customers can
report the assigned mechanic; mechanics can report the job customer; admins
may file on behalf of the platform but the target must still be a participant.

Negative focused cases cover wrong target, wrong reporter, unrelated admin
target, and missing job.

### F-02 — Mechanic profile private-field disclosure — fixed

`GET /users/:userId/mechanic-profile` remains available to authenticated users
because public mechanic reputation/discovery is a product feature. Its
non-private projection now excludes email, phone, referral code, loyalty
balances, mechanic balance, and account status. The mechanic and admin receive
the full private view, while public viewers receive no earnings total.

`userProfile.test.ts` asserts the sensitive field set is absent from the public
projection.

### F-03 — Historical booking cancellation authorization — fixed

`PATCH /bookings/:bookingId/cancel` now loads the canonical booking mechanic
and shop owner and calls `canCancelBooking`. Admins remain allowed; all other
actors need an active account and must be the assigned mechanic or owning shop
owner. A stale role/ownership row alone is not sufficient. Cancellation reason
input is capped at 500 characters.

Focused negative cases cover pending/suspended actors and wrong mechanic/shop
owner IDs.

### F-04 — Inactive mechanic state mutations — fixed

Several older routes checked only `req.userRole === "mechanic"` rather than
the account status. The following now reject pending/suspended mechanics:

* APS job cancellation (which reopens dispatch and may void a payment hold);
* customer rating;
* review create/edit; and
* flag creation.

The existing active-mechanic middleware remains the gate for acceptance,
worklogs, inspections, transport writes, bay lifecycle, payouts, and other
sensitive mechanic actions. The job cancellation helper has direct tests for
pending, wrong-assignee, active, customer, and admin cases.

### F-05 — Vehicle historical contact disclosure — fixed

The vehicle formatter selected the current owner and always serialized
`email`/`phone` for any authorized vehicle viewer. `canAccessVehicle` rightly
preserves historical vehicle/service access for past owners and mechanics who
completed service, but that historical purpose does not require contacting the
current owner. A source search found no mobile consumer of
`currentOwner.email`/`currentOwner.phone`; job messaging and current service
coordination are separate participant-scoped surfaces.

The formatter now omits contact fields unless one of these purposes is true:

* the requester is the current owner (self view);
* the requester is an admin; or
* the requester is the assigned mechanic on an active job
  (`ACCEPTED`, `EN_ROUTE`, or `IN_PROGRESS`).

The current-job mechanic path preserves the operational contact purpose. There
is no separate consent column in the current schema; the active job
participant relationship is the authorization/consent proxy and is narrower
than historical vehicle access. The formatter regression test verifies both
withholding and approved inclusion. A past owner or completed-job mechanic
still receives the vehicle/service response but not current-owner contact.

## Input validation, injection, and concurrency review

### Injection and unsafe input

Drizzle query builders are used for ordinary queries. Raw SQL uses tagged
`sql` expressions with bound values for locks and scoped selects; no reviewed
route concatenates an ID into SQL. Partner search escapes `%`, `_`, and
backslashes before `ILIKE`. Partner payloads reject unknown fields and use
Zod schemas, and review/flag/dispute/media payloads have explicit bounds.
Numeric IDs on reviewed paths reject malformed/non-positive/non-safe values.
Media filenames are character/extension allow-listed before filesystem access.

Residual input-hardening items are report-only:

* `PATCH /users/:userId` casts several admin/self fields directly instead of
  using a strict schema. In particular, `mechanicTier`, `status`, and
  `certifications` deserve enum/length validation; this is an integrity risk,
  not an object-ID bypass in the current ownership check.
* Job message content has a required/nonblank check but no explicit maximum
  length. Add a product-approved limit before relying on it for storage or
  notification throughput.
* Admin setup accepts a manually cast body rather than a bounded schema.
* Parts VIN decode is restricted to active mechanics/admins, but an active
  mechanic can decode an arbitrary valid VIN and best-effort persist a profile.
  The impact is primarily profile-integrity/third-party lookup cost; a
  vehicle/job binding policy should be decided separately.

### Resource authorization negative cases

The required negative-case set for a route-level regression suite is:

1. no bearer header, malformed token, expired token, deleted user, and a
   suspended account using an otherwise valid token;
2. pending mechanic attempting accept, worklog, inspection, transport, bay,
   payout, review, flag, rating, or cancellation mutations;
3. customer A requesting customer B's job, messages, approvals, invoice,
   payment/payout detail, work confirmation, vehicle, ownership, or parts
   resource;
4. mechanic A requesting mechanic B's job/worklog/vehicle/workbench/parts
   resource;
5. customer/mechanic attaching a job belonging to different participants to
   a flag;
6. mechanic/shop owner using the correct booking ID but wrong mechanic/shop
   ownership, including stale pending/suspended account status;
7. shop owner A using organization/location/operation/request IDs belonging to
   shop owner B;
8. stale partner request version, repeated idempotency key with changed
   content, inactive organization/location, and cross-organization child ID;
9. non-admin access to admin finance/growth/media/parts/payout/moderation
   routes; and
10. historical vehicle owner/mechanic receiving `currentOwner.email` or
    `currentOwner.phone`, while a current active participant retains the
    approved contact path.

Focused helper/formatter tests cover items 5, 6, 10, and related role/status
cases. Items 1–4 and 7–9 remain route-level test work, not silently certified
by the pure tests.

### Concurrency and state transitions

The review found conditional status updates and row locks on high-impact
partner transitions, payment destination changes, review visibility/removal,
and bay/booking operations. Partner organization, operation, and request
routes use transaction locks and version/idempotency checks. Job cancellation
and some legacy state updates still use a read-then-write pattern; no fee,
dispatch, or payment behavior was changed to address that broader
architectural concern.

## Explicitly report-only areas

### Payments and Stripe

Payment checkout, release/refund, Connect, payout destination, webhook, fee,
commission, capture, and provider behavior were not modified in this audit.
They require provider-backed integration tests and financial reconciliation
review. Existing route-level ownership/status checks were recorded in the
matrix, but no live Stripe result is claimed.

### Bay availability

The bay/booking routes enforce shop ownership, mechanic assignment, active
status, and booking state. Availability-window semantics and the overnight
UTC contract are covered separately in
`docs/audit/part7-bay-validation.md`; this security audit did not change bay
availability, bay status, tier/category eligibility, or booking policy.

### Session revocation and broad route runtime coverage

JWTs have a seven-day TTL and no independent revocation list. Database status
reload blocks suspended accounts promptly, but a dedicated logout/revoke
mechanism remains a future security-hardening decision. No browser/workflow
tool, workflow log, or deployment console was used for this audit.

## Untested route families and evidence gaps

The following families were statically reviewed but do not have a focused
authenticated HTTP regression in this audit:

* health/auth/admin setup and all password-reset edge cases;
* dashboards, assistant/provider behavior, public amplification cards, and
  public media file serving;
* full users self-update/admin mutation behavior;
* jobs, messages, vehicle, ownership, worklog, inspection, transport, lift,
  customer approval, invoice, tips, and review HTTP negative cases;
* loyalty, referrals, favorites, mechanics directory, progression, and
  amplification HTTP behavior;
* admin finance, growth, media generation, integrations, disputes,
  moderation, and parts catalog;
* payments, payouts, Connect, hosted checkout, and webhook/provider behavior;
* shops, bays, bookings, and the full overnight availability/booking matrix;
* all partner organization, vehicle-operation, service-request, APS bridge,
  and partner-job route permutations; and
* native device behaviors such as push, camera/inspection, GPS, OBD, and
  deep-link/session persistence.

Existing repository fixture suites provide additional evidence for password
reset, partner organizations, partner vehicle operations, partner service
requests, commercial partner jobs, Ghost Garage, and Part 6 bays. They were
not re-run in this focused pass; their existence must not be read as a claim
that every route row above is runtime-certified.

## Change boundary

The implementation changes for this audit are localized to authorization
helpers, affected routes, public profile/vehicle formatters, and focused
tests. No payment/Stripe file was changed for these findings. No fee,
commission, dispatch, or bay-availability policy was changed.
