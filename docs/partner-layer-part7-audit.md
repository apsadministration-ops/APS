# Partners Layer — Part 7 application-wide audit

**Audit date in the evidence set:** 2026-09-13 UTC  
**Decision:** **NOT READY for public launch or a payment beta**  
**Scope:** the complete customer, mechanic, shop-owner, dealership, fleet,
service/APS, Ghost Garage/lift, security/tenant, database, API/UI, accessibility,
browser/mobile, payment, external-integration, regression, cleanup, and
beta-readiness checklist.

This is the application-wide Part 7 report, not a narrower Part 6 report. It
consolidates the ten audit records under [`docs/audit/`](audit/), both scanner
artifacts, and the actual working-tree diff inspected for this handoff. It is
an evidence and remediation report, not a production approval. It deliberately
does not claim all-features end-to-end coverage.

## 1. Executive decision

The repository has meaningful hardening and regression evidence:

* the mandatory initial connected-browser checks were performed before the
  broader static and executable audit;
* authorization/privacy defects, overnight bay continuation, mobile API paths,
  mobile payment visibility, stale fee text, card-style flattening, dispute
  ordering, tip event ordering, payout-event error propagation, email connector
  headers, and the local APS ordering declaration were addressed in the current
  diff;
* the latest API evidence records **30 unit/static tests passing**;
* the database-focused suites record **16/16 cases passing**;
* the mobile script inventory records **6/6 scripts passing**;
* the resumed connected customer journey reached Job 129 completion,
  invoice/history/reviews, and the customer card runtime no longer reproduced
  the VehicleCard/JobCard style crash;
* all tracked synthetic fixtures were cleaned in one guarded transaction, with
  fresh-ID absence queries returning zero and the original baseline counts
  restored; and
* dependency findings fell from the baseline of 102 to six residual dependency
  findings; and
* the privacy scanner reported zero findings in both scanner artifacts.

Those positives do not establish a launchable product. The following remain
release-gating or material limitations:

1. the running API reported `Stripe webhook NOT ready`,
   `missing_signing_secret`, with 16 matching endpoints and missing
   dispute/transfer/payout event families;
2. webhook claim-before-effects crash replay and the analogous
   capture-before-loyalty/referral/progression failure remain a financial beta
   blocker;
3. the shop Connect onboarding account is stored on `users`, while
   shop-destination checkout reads `shops`;
4. there is no refund ledger for provider refund identity, amount, currency,
   partial refunds, or provider-confirmed time;
5. provider payment identifiers are indexed but not uniquely constrained;
6. final SAST did not complete (`UNEXPECTED_DISCONNECT` in the final run
   outcome; the JSON artifact records status `rejected` and
   `"[object Object]"`), so the two initially reported traversal findings have
   targeted tests but no final scanner certification;
7. the final owner/Job 100 Ghost Garage repeat was not certifiable because the
   assigned fixture-262 credential was unusable and fresh mechanic 292 was
   correctly denied job-specific access (a fixture/authorization-context
   limitation, not an application defect);
8. the mobile static build timed out at the Metro/iOS bundle stage and there is
   no physical-device or signed-native evidence; and
9. external Stripe, email, push, AI, media storage, VIN/NHTSA, and supplier
   behavior remains provider- or device-uncertified.

The correct classification is therefore **internal development / continued
targeted testing only**, not public release, payment beta, or a claim that all
routes and features passed E2E.

## 2. Evidence labels and boundaries

The report uses four explicit evidence labels. A source review, a passing
script, and a connected browser session are not interchangeable.

| Label | Meaning in this report |
| --- | --- |
| **actualbrowser** | A recorded real app navigation in a connected browser context using scoped fixture data. Screenshots/accessibility trees alone are not elevated beyond the action actually observed. |
| **executabletests** | A unit test, integration test, deterministic mobile script, typecheck, build, HTTP probe, or scanner command that actually ran. A passing source assertion is not a provider/device result. |
| **staticreview** | Source, generated API, schema, migration, configuration, route, or working-tree-diff inspection. Static presence is not runtime success. |
| **blockedunverified** | Not run, unavailable, timed out, provider/device dependent, failed before the relevant assertion, awaiting cleanup, or awaiting the main-agent final update. It must not be reported as pass. |

The existing audit documents also use `browser-tested`,
`fixture/script-tested`, `static-only`, and `untested`; those are mapped here to
the labels above. `fixture/script-tested` is **executabletests** unless the
record explicitly says a connected browser action occurred.

### Scope and provenance notes

* The original prior prompt was **not found** in the available repository or
  evidence context. That absence is recorded rather than inferred. Scope was
  enumerated from the user's full checklist, the mounted route inventory, the
  mobile route inventory, the database schema, the scanner artifacts, the audit
  records, and the current diff.
* The mandatory initial checks occurred first. The initial browser record says
  “mandatory initial checks only; broader regressions were not run” and
  precedes the later security, payment, database, dependency, and regression
  review. Later records are not backdated into the initial pass.
* No workflow was launched or restarted by this report task. No workflow logs
  or console logs are used as evidence here.
* No live charge, test-card submission, provider entity mutation, webhook
  delivery, physical-device run, production mutation, migration application, or
  broad fixture deletion is claimed.

## 3. Source index

The complete Part 7 evidence set is retained in these files:

| Evidence path | What it contributes |
| --- | --- |
| [`docs/audit/part7-initial-browser.md`](audit/part7-initial-browser.md) | Mandatory initial browser fixtures, approval-cache flow, bay editor, tenant switching, deep links, reload/back/forward, and accessibility traversal. |
| [`docs/audit/part7-browser-regression.md`](audit/part7-browser-regression.md) | Initial customer vehicle blocker, resumed customer → mechanic 292 journey through completion, Job 100 Ghost reachability limit, and transactional cleanup evidence. |
| [`docs/audit/part7-frontend.md`](audit/part7-frontend.md) | The complete 86-TSX frontend inventory, route/API wiring, guard matrix, and browser/native limitations. |
| [`docs/audit/part7-security-backend.md`](audit/part7-security-backend.md) | Mounted backend route-family inventory, authorization/tenant review, fixed privacy defects, focused tests, and residual negative-case gaps. |
| [`docs/audit/part7-bay-validation.md`](audit/part7-bay-validation.md) | Overnight-window contract, continuation-day defect and fix, and bay regression scope. |
| [`docs/audit/part7-database.md`](audit/part7-database.md) | Read-only development DB consistency checks, source/live schema drift, missing constraints/indexes, payment IDs, refund audit, and migration limitation. |
| [`docs/audit/part7-payment-integrations.md`](audit/part7-payment-integrations.md) | Stripe lifecycle, webhook/idempotency, tips, disputes, payouts, Connect, AI/email/push/media/VIN/supplier findings, and 30-test record. |
| [`docs/audit/part7-initial-payments-mobile.md`](audit/part7-initial-payments-mobile.md) | Initial payment/mobile checks, runtime webhook warning, safe HTTP probes, mobile/native setup, and physical-device boundary. |
| [`docs/audit/part7-dependencies.md`](audit/part7-dependencies.md) | Dependency baseline, targeted remediation inventory, compatibility blockers, frozen install, and codegen handoff. |
| [`docs/audit/part7-regression.md`](audit/part7-regression.md) | API/DB/mobile scripts, typechecks, builds, generated-output diff check, and mobile build timeout. |
| [`docs/partner-layer-part6.md`](partner-layer-part6.md) | Prior Part 6 connected Ghost-owner browser flow used only as historical supporting evidence; not recast as a fresh Part 7 repeat. |
| [`docs/audit/part7-security-scanners.json`](audit/part7-security-scanners.json) | Baseline dependency/SAST/privacy scanner artifact. |
| [`docs/audit/part7-security-scanners-final.json`](audit/part7-security-scanners-final.json) | Final dependency result, rejected SAST result, and zero privacy findings. |

### Actual current diff reconciliation

The working-tree diff inspected for this report was **309 files,
16,567 insertions, and 19,479 deletions**. Most of that volume is generated
Orval output and the frozen dependency lockfile, not 309 independently
implemented features. The non-generated changes are accounted for below:

| Current-diff area | Files | What was actually changed |
| --- | ---: | --- |
| API server source | 16 | Authorization/privacy gates, overnight bay evaluation, dispute/tip/webhook/payout/email/APS behavior, admin finance, and affected routes |
| API integration tests | 2 | Part 7 bay/Ghost Garage coverage and test fixture/assertion updates |
| Mobile app screens | 6 | Admin certification/payment/user, mechanic progression, customer/commercial job payment visibility, and shop bay validation/hint |
| Mobile components/scripts/server | 5 | Flattened card styles, partner/Ghost assertions, and canonical static-file containment/test injection |
| Mobile package manifest | 1 | Focused security-test script/dependency state |
| Database schema | 1 | Tip status documentation for recoverable failed attempts |
| API spec/codegen config | 2 | Orval 8.22 compatibility and generated-barrel de-duplication |
| Generated API clients/types | 273 | Regenerated client/Zod output; export compatibility was checked, but generated churn is not new feature behavior |
| Dependency/workspace files | 2 | `pnpm-lock.yaml` and `pnpm-workspace.yaml` remediation/resolution state |
| Existing Part 6 contract fragment | 1 | Contract wording/update retained in the working tree; not treated as a new Part 7 feature |

The diff contains no checked-in Part 7 migration, no provider endpoint
mutation, no production fixture cleanup, and no new report besides this
requested file. The diff-level changes are the basis for the “fixed” claims;
the limitations and residual issues below are not silently counted as fixed
because a related source line changed.

## 4. Mandatory initial checks and chronology

### 4.1 Initial browser pass — **actualbrowser**

The mandatory initial pass used scoped `p7-initial-*` fixtures:
owner 261, mechanic 262, unrelated owner 263, dealership organization 185,
location/shop 217, service request 34, APS job 100, and bay 47.

The recorded results were:

* **Approval-cache journey: pass.** The owner selected organization 185 and
  sent request 34 to APS. The mechanic accepted job 100 from the real
  Available Jobs UI. The owner approved the mechanic. The job navigated to
  `/job/100`, showed `ACCEPTED`, and stayed there after reload.
* **Owner bay editor: mostly pass.** Bay 47 was created, edited, saved,
  reloaded, and reopened with the expected active/rate/tier/category/equipment/
  auto-approval/UTC-weekly values. Blank name, negative rate, and no-category
  validation were blocked with the recorded messages.
* **Reversed availability result: corrected classification.** The initial
  record called Monday `19:00–08:00` a defect. The later contract review found
  that non-equal reversed times are valid overnight UTC windows. The actual
  defect was that a Tuesday-morning interval was not compared with Monday's
  overnight window. The evaluator and editor were fixed; the new continuation
  behavior is covered by executable tests, but the later browser record did
  not retest it.
* **Selected organization accessibility/navigation: pass for executable
  checks.** An 18-tab traversal did not expose a hidden retained
  previous-organization link. Request detail, back, forward, direct deep link,
  and reload retained the selected scope.
* **Two-organization isolation follow-up: pass for recorded checks.**
  Organization 186 was added through scoped APIs. Switching from organization
  A to B while retaining A's detail route settled to a scoped 404 with no A
  data. B list/detail, reload, back/forward, direct B link, and direct A-on-B
  link all used B-scoped endpoints and did not expose A content.
  Native VoiceOver/TalkBack was not performed.

The evidence IDs, fixture identities, and exact browser observations remain in
[`part7-initial-browser.md`](audit/part7-initial-browser.md). They are not
general certification of every role, route, provider, or device.

### 4.2 Broader audit chronology

After the mandatory initial pass, the evidence set covered source/security,
database, dependencies, payments/mobile, frontend inventory, bay validation,
and executable regression. The later resumed browser record then completed a
fresh customer → mechanic 292 journey through work-log completion and
transactional cleanup. Its narrower Job 100 Ghost Garage repeat remained
unreachable for the reasons documented in §10.3; that limitation is not
silently converted into an application failure or a full Ghost browser pass.

## 5. Full feature inventory

### 5.1 Frontend inventory — all 86 TSX files

The authoritative complete inventory is
[`docs/audit/part7-frontend.md`](audit/part7-frontend.md), not a hand-selected
screen list in this summary. It contains **86 TSX files**: **77 screens,
8 layouts, and `+not-found.tsx`**. Route groups are omitted from URL paths.

The summarized matrix below preserves the inventory's coverage labels:

| Frontend area | Inventory | Recorded coverage summary | Main gap |
| --- | ---: | --- | --- |
| Authentication | 3 screens | One fixture/script check; two static reviews | No complete browser auth/reset matrix. |
| Customer | 9 screens | Initial `/vehicles` runtime blocker was fixed; one connected customer → mechanic journey reached completion, invoice/history/reviews; remaining customer routes are static-only | Payment was intentionally not submitted; cancellation/ownership and other customer routes remain unverified. |
| Mechanic | 15 screens | Available-job acceptance is actualbrowser; progression has executable evidence; several routes static-only or untested | Workbench, inspection, messaging, parts, VIN, payout detail, and native behavior lack route-level certification. |
| Admin/growth | 20 screens | User/certification scripts; remaining finance, disputes, moderation, growth, and integrations are mostly static or untested | No broad authenticated admin HTTP/browser negative matrix. |
| Shop-owner/partner | 11 screens | Organization/service-request/shop/bay evidence includes actualbrowser and executable partner checks | All permutations and native partner behavior are not certified. |
| Shared job/payment/workbench | 19 screens | Job/approval/workbench/log/invoice rows have selected connected or fixture evidence; many detail routes are static/untested | Inspection, messages, tracker, transfer, OBD, and hosted payment completion remain unverified. |
| Layouts and fallback | 8 layouts + not-found | Guards and selected-organization boundaries are statically reviewed; selected-org browser checks passed | Native deep-link/session and reader behavior remain unverified. |

For the **77 screen rows**, the source matrix labels two rows directly
`browser-tested`, six additional rows `fixture/script-tested; browser-tested`,
12 rows `fixture/script-tested` only, 29 `static-only`, and 29 `untested`.
These are overlapping labels where a row has both browser and script evidence;
they are not a percentage of all features passing.

The mounted backend route-family review is available in
[`docs/audit/part7-security-backend.md`](audit/part7-security-backend.md), and
the complete 86-TSX matrix is available above. Availability of those review
matrices is not a claim that every UI feature or route family passed E2E.

### 5.2 Customer

**Implemented surface:** authentication, dashboard, jobs, profile, vehicles,
service request, detailing, loyalty, referral, review, job approval/
confirmation/invoice/tip, history, workbench, messaging, inspection, and
vehicle/parts/diagnostic entry points.

**Evidence and findings:**

* **actualbrowser:** after the initial VehicleCard runtime crash, customer 264
  reauthenticated, found vehicle 245 exactly once, opened/reloaded its detail,
  selected the vehicle, and created ordinary Job 129 through the real UI. The
  fresh mechanic 292 context accepted it; customer approval, status progress,
  Workbench/work-notes gating, work-log entry, and completion all succeeded.
  Job 129 settled at `COMPLETED` with `$179.00` estimated/final total.
* **actualbrowser:** invoice `APS-000129` opened as `held` with one `$179.00`
  labor line and **no payment-entry or charge button**; `Pay & Authorize` was
  not clicked. Vehicle history showed one VIN-linked completed Maintenance
  record. The customer and mechanic each submitted a review.
* **actualbrowser/staticreview/executabletests:** `VehicleCard` and equivalent
  `JobCard` now use `StyleSheet.flatten`. The resumed vehicle/job lists
  rendered normally, and the focused mobile security script checks the fix;
  the original runtime style-array bug is therefore fixed in the exercised
  journey.
* **blockedunverified:** the customer UI exposes no Edit control or edit form
  on the vehicle list/detail. Vehicle edit is unavailable through the requested
  UI, but this is not a reproduced regression because the UI never exposed the
  edit action; no API edit bypass was used. Cancellation/ownership permutations
  and every other customer route remain outside this single journey.

Customer ownership is server-authoritative. Payment success is not inferred
from a customer screen; the backend/webhook state is authoritative.

### 5.3 Mechanic

**Implemented surface:** available/active/history/dashboard/profile,
progression/certifications, amplification, directory/profile, earnings and
payouts, work logs, inspections, transport, lift requirement, VIN workspace,
parts, recommendations, vehicle/job workbench, messages, and status progression.

**Evidence and findings:**

* **actualbrowser:** fresh active technician mechanic 292 rendered Available
  Jobs, tier and Work Down filters, accepted Job 129, advanced it through
  driving/arrival/start-work, opened Workbench and Work Notes, and submitted a
  complete Maintenance work log. Customer reloads observed authoritative
  `EN_ROUTE`, `IN_PROGRESS`, and `COMPLETED` states.
* **blockedunverified:** mechanic 262 remained unusable for the retained
  fixture context (HTTP 401, including guarded credential recovery), so it was
  not retried again. This does not invalidate the fresh 292 journey.
* **executabletests:** progression API-prefix checks, authorization state gates,
  bay/lift integration coverage, commercial/partner tests, and mobile scripts
  cover selected contracts.
* **staticreview:** active-mechanic gates are applied to acceptance, work logs,
  inspections, transport mutations, bays, payouts, loyalty redemption, and
  sensitive actions. The API re-loads role/status from the DB on each request.
* **blockedunverified:** inspection capture, messages, physical-device
  behavior, payout settlement, and all mechanic route permutations are not
  certified merely because the Job 129 maintenance work log passed.

### 5.4 Shop-owner

**Implemented surface:** shop/location dashboard, profile, organizations,
partner vehicles, post-job, invoices, bay editor/bookings, service requests,
APS bridge, and shop detail.

**Evidence:** the initial browser pass exercised organization selection,
request detail and navigation, shop/bay editing, owner approval, and
organization isolation (**actualbrowser**). Partner organization, vehicle,
service-request, commercial, Ghost Garage, and bay suites provide
**executabletests**. Shop-owner route authorization, selected-organization
context, and ownership predicates were also **staticreviewed**.

**Limit:** this is not evidence that every shop-owner route, native flow,
payment destination, or external Connect account works end to end.

### 5.5 Dealership

Dealership is an organization subtype within the existing `shop_owner`
surface, not a separate login role. The tenant key is the authenticated
organization primary owner; location, operation, vehicle, and service-request
rows are scoped to that owner and organization.

* **actualbrowser:** the mandatory initial request 34 was a dealership
  organization request sent to APS; the linked job was accepted and approved.
  The selected-organization deep-link/no-exposure checks also used the
  dealership context.
* **executabletests/staticreview:** organization, operation, service-request,
  commercial bridge, vehicle capability, and generated contract checks cover
  subtype and scope rules.
* **blockedunverified:** no claim is made for every dealership status,
  inventory, billing, review, or native route permutation.

### 5.6 Fleet

Fleet is likewise an organization subtype, not a display role or separate
authentication system. Fleet vehicle operations and service requests bridge
into ordinary APS jobs without changing customer ownership semantics.

**Evidence:** fleet subtype/status/source-snapshot rules are covered by
**executabletests** and **staticreview** in the partner/commercial records.
The application inventory includes the same shop-owner screens for fleet
context. A fleet-specific broad browser journey is **blockedunverified** in
the Part 7 evidence set; a prior Part 6 browser record must not be silently
recast as fresh full-feature Part 7 coverage.

### 5.7 Service / APS

The intended path is:

1. an active organization owner submits an organization-scoped dealership or
   fleet request for a registered operational vehicle;
2. Send to APS validates organization, operation, vehicle, location, active
   status, and service policy;
3. a transaction creates or idempotently reuses one ordinary `REQUESTED` job;
4. mechanics discover and accept the job through the normal board;
5. the exact commercial principal approves it; and
6. ordinary work-log, completion, history, invoice, and payment paths apply.

**actualbrowser:** the initial pass observed the real Send to APS action,
`Request sent to APS as job #100`, mechanic acceptance, owner approval,
`ACCEPTED` state, and reload stability.

**executabletests:** commercial bridge and partner DB suites cover scope,
idempotency, source links, completion/history projection, and unchanged
ownership/earnings. The latest audit records the commercial suite among the
16 passing DB cases.

**staticreview:** request source status remains distinct from linked APS
progress; operational notes and snapshots are not copied into mechanic-facing
descriptions; server-side organization and owner predicates are required.

**blockedunverified:** no complete customer-facing commercial payment,
provider settlement, or every APS failure/retry permutation is certified.

### 5.8 Ghost Garage lift and bay availability

The lift surface is an operational mechanic/shop workflow:

* an assigned active mechanic can require a lift;
* a new lift requirement resets transport approval;
* the exact customer/commercial principal approves transport;
* the mechanic searches existing bays by job, interval, equipment, category,
  tier, status, and shop/location;
* manual approval is `pending → reserved`; auto-approval creates `reserved`;
* rejected/cancelled/completed history is retained; and
* only one pending/reserved/active booking is allowed for a job.

**executabletests:** the bay unit/evaluator checks and Part 6 bay integration
coverage include overnight windows, normal windows, exact boundaries,
malformed/equal values, legacy always-available configuration, manual/auto
approval, rejection/cancellation/rebooking, conflicts, inactive bays,
mechanic lift approval reset, and booking state. The regression record reports
the bay suite **PASS 4/4** and the Ghost Garage script passing.

**staticreview:** server-derived booking identity, shop/mechanic/job
relationships, work-log booking status, and customer visibility boundaries
were reviewed.

**actualbrowser:** the initial browser pass covered bay creation/editor
validation and persistence. The final owner/Job 100 repeat was not a full
lift-browser pass: owner Job 100 was read-only, assigned fixture mechanic 262
could not authenticate, and fresh mechanic 292 was correctly denied
job-specific booking access (two 403 resource loads and a senior-tier/bay
eligibility mismatch). This is a fixture/authorization-context limitation,
not an application bug. The backend bay suite is **PASS 4/4**, the prior
Part 6 connected Ghost browser flow passed, and the initial owner bay edit
passed; however, a complete repeated Part 7 Ghost owner/job-100 browser flow
is not certified. The corrected continuation-day overnight interval also
remains executable-test evidence rather than a final browser claim.

## 6. Security and tenant audit

### 6.1 Authentication and roles

The API requires bearer authentication, verifies JWT signature/expiry, reloads
the current user from the database, and rejects suspended accounts. Sensitive
mechanic operations use `requireActiveMechanic`; shop/partner management uses
active `requireShopOwner`; admin surfaces are router- or route-gated. A
seven-day JWT with no server-side revocation table remains a documented
security hardening risk.

### 6.2 Fixed authorization/privacy defects

The current diff and focused tests support these fixes:

| Finding | Current behavior | Evidence |
| --- | --- | --- |
| Job-linked flags | Validates body, job existence, target existence, and reporter/target participant relationship | **staticreview**, `authorization.test.ts` **executabletests** |
| Mechanic private profile | Public projection omits email, phone, referral, loyalty, balance, and account status; mechanic/admin retain private view | **staticreview**, `userProfile.test.ts` **executabletests** |
| Historical booking cancellation | Requires active canonical mechanic/shop owner or admin; stale role/ownership is insufficient | **staticreview**, authorization tests **executabletests** |
| Inactive mechanic mutations | Cancellation, customer rating, reviews, and flags now require active status | **staticreview**, focused authorization tests **executabletests** |
| Historical vehicle contact | Email/phone is omitted for past owners and historical mechanics; current owner, admin, or active assigned mechanic can receive it | **staticreview**, vehicle formatter tests **executabletests** |
| Static file traversal | Decode/reject malformed encoding/NUL, canonical `resolve`/`relative` containment, allowlisted manifest platforms | **staticreview**, focused mobile security script **executabletests** |

The changes do not alter fees, commissions, dispatch policy, bay eligibility,
or payment amounts.

### 6.3 Tenant isolation

Partner queries require authenticated `primaryOwnerId` plus the organization,
location, operation, vehicle, or request relationship. Optimistic versions,
idempotency fingerprints, transactions, and locks protect material
organization-scoped transitions. The initial two-organization browser record
observed no unrelated organization data after switch, stale detail, direct
link, reload, back, or forward.

This is strong evidence for the exercised partner context, not blanket
runtime certification of all backend negative cases. The security record
explicitly leaves broad tests for customer A/B resources, mechanic A/B
resources, inactive/pending mutation attempts, admin route denials, and every
cross-organization child-ID permutation as unexecuted.

## 7. Database constraints and migrations

### 7.1 Observed development snapshot

The read-only development snapshot (before the resumed browser run's final
cleanup) contained 56 users, 16 vehicles, 9 jobs, 2 work logs, 2 payments, 2 bay
bookings, 13 ownership rows, 2 partner
organizations, 2 partner vehicle operations, 2 partner service requests,
32 catalog parts, and zero parts orders. It is fixture data, not production
volume or a historical consistency proof.

Observed aggregate checks were clean: no FK orphan, payment duplicate,
payment/work-log mismatch, invalid VIN relationship, ownership overlap,
negative financial value, parts arithmetic error, or partner-scope mismatch.
The payment rows were legacy-looking `held` rows with no modern provider
intent/session/transfer/payout identifiers; that does not prove Stripe flow.

### 7.2 Missing relational guardrails

The absence of bad current rows is not the absence of future-write risk:

* provider intent/session/transfer/payout IDs are not partial-unique
  constraints;
* `payments.job_id` is not unique, and whether one canonical payment row or
  payment-attempt history is intended remains a product/payment review;
* there is no local refund/refund-event ledger with provider refund ID,
  payment/tip link, amount, currency, status, partial-refund total, or
  provider-confirmed time;
* payment statuses, nonnegative/money arithmetic, fee/payout reconciliation,
  provider-state identifiers, and timestamp/state relationships are not live
  PostgreSQL checks;
* several denormalized links lack FKs, including selected bay booking/shop,
  payment/shop, work-log booking/inspection links, and paired commercial job
  source fields;
* ownership interval exclusion and one-open-owner uniqueness are application
  policy, not database constraints; and
* `immutable_flag` is a marker, not a trigger or restricted-write guarantee.

Source/live index drift includes `disputes_mechanic_idx`,
`payout_events_created_idx`, `tips_customer_idx`, and `tips_intent_idx`.
The favorites unique index has a legacy name but retains uniqueness.

### 7.3 Migration status

The migration/report review found **seven migration `.mjs` scripts** under
`scripts/src/`: `migrate_partner_organizations.mjs`,
`migrate_partner_part4_vehicle_operations.mjs`,
`migrate_partner_part5_service_requests.mjs`,
`migrate_partner_part6_commercial.mjs`, `migrate_partner_part6_bays.mjs`,
`migrate_partner_part6_bay_booking_history.mjs`, and
`migrate_parts_system.mjs`. Their presence is script evidence, not proof that
every script has run successfully or that it is a durable production migration
ledger.

Separately, no checked-in application migration directory or SQL migration
history/ledger was found outside dependencies/vendor directories. This is a
**ledger-absence** finding, not a claim that migration scripts are absent.
No migration, `drizzle-kit push`, schema rebuild, fixture backfill, or
production database change was performed for this audit. Source/live
differences therefore remain drift: they may be unapplied, intentionally
legacy, or generated outside this repository. Recommended constraints require
a reviewed backfill, retry, unknown-provider-event, payment-attempt, and
delete-behavior policy before application.

## 8. API and UI contract audit

### 8.1 Generated and direct API calls

The root layout sets the generated client base URL to the API origin, while
generated operation paths already include `/api`. Direct `customFetch` calls
must include `/api`.

The current diff corrects missing prefixes in:

* `artifacts/mobile/app/(admin)/certifications.tsx`:
  `/api/admin/certifications`, `/api/admin/promotions/pending`,
  `/api/admin/mechanics/:id/promote`, and certification review;
* `artifacts/mobile/app/(mechanic)/progression.tsx`:
  `/api/mechanic/me/progression`, certifications, promotion history, and
  certification deletion.

The admin tier order now includes `advanced` between `senior` and `master`.
The fee label now says `Platform fee` rather than asserting a stale 10%
percentage. These are display/contract corrections only; no fee rule changed.

Orval was updated from 8.5.3 to 8.22.0 while retaining major 8, Zod 3
generation, generated route/client behavior, export compatibility, and a
barrel de-duplication hook. The generated files account for most of the large
working-tree diff and are not hand-authored feature evidence.

### 8.2 UI behavioral fixes

* `VehicleCard` and `JobCard` now flatten React Native style arrays before
  passing them through Expo Router `Link asChild`, fixing the observed web
  anchor style setter error.
* The customer-of-record commercial principal can now see the server-authorized
  mobile payment action; the backend remains the authority.
* The shop bay editor rejects malformed/equal times and explains that reversed
  times continue into the next UTC day.
* Partner service-request scripts now assert `router.dismissTo(...)` for
  context-reset navigation rather than the unsafe old replacement/back pattern.

## 9. Accessibility and navigation

### Evidence

The mandatory initial browser pass recorded an 18-tab keyboard traversal
through the selected-organization request list. It found logical order, no
hidden retained previous-organization backlink, and no stale cross-tenant
action after switching. Detail, direct-link, reload, back, and forward checks
settled to the selected organization's data or a scoped 404.

The route/layout source has explicit role guards and selected-organization
boundaries. The security script and partner scripts provide executable
regressions for selected static contracts.

### Limitations

* Native VoiceOver and TalkBack were not run.
* Camera/inspection accessibility, push, GPS/location, OBD permissions,
  physical keyboard behavior, native deep-link/session persistence, and
  animation/focus behavior are **blockedunverified**.
* Browser accessibility evidence covers the exercised partner context, not all
  86 TSX files.
* The resumed customer flow rendered after hydration and completed its planned
  customer → mechanic 292 journey, but this does not certify every route or
  native reader behavior.

## 10. Browser and mobile status

### 10.1 Customer → mechanic 292 journey — **actualbrowser**

The resumed connected run reauthenticated customer 264 through the real
`POST /api/auth/login`. After frontend hydration, vehicle 245 appeared exactly
once with the intended VIN, plate, trim, color, mileage, and zero-service
state. Vehicle detail opened and reloaded with the expected VIN/EX/Red data.

The customer opened Request Service, selected `Full Synthetic Oil Change`,
entered the ordinary description/address, and created Job 129 through the UI.
The first submit correctly returned `Please select a vehicle.` because the
displayed vehicle card had not been selected; the second submit after selecting
the card succeeded. Job 129 was `REQUESTED`, `MAINTENANCE`, VIN-linked, and
estimated at `$179.00`.

Fresh active technician mechanic 292 then:

* rendered Available Jobs, tier filtering, and Work Down filtering;
* accepted Job 129 through the UI and confirmation;
* enabled customer approval and progressed through driving, arrival, and
  start-work;
* opened Workbench and the Work Notes gate;
* submitted a complete Maintenance work log (odometer 18,100, labor
  `$179.00`, 1.5 hours, symptoms/root cause/repair/monitoring/customer notes,
  and no itemized parts); and
* produced `COMPLETED` with estimated/final `$179.00`, independently confirmed
  by a customer reload.

Customer completion evidence:

* invoice `APS-000129` opened as `held`, with one Labor line for `$179.00`;
* there was **no payment-entry or charge button**, and `Pay & Authorize` was
  intentionally not clicked;
* Vehicle 245 Service History showed one VIN-linked completed Maintenance
  entry, mechanic, amount, and description; and
* the customer and mechanic each submitted a review.

The browser evidence IDs retained by the source record include vehicle/list
`hrws50`, detail/reload `l0z20p`/`o50zjx`, request/job creation
`0y39n2`, `hao1lp`, `w3g2xh`, `m3x7xs`, `55aolq`, `by8s9f`, acceptance
`czp6dt`, approval/status `g5z0ns`, `dvjxhy`, `qam099`, `iov2d9`, workbench/
work-log `anke2w`, `vl851z`, `22esxx`, `e2tm9t`, completion
`qszz40`/`zjhhvy`, invoice `sxf1pn`, history `65a7t4`, and reviews
`1w2iuu`/`4bopim`. They are evidence for the recorded actions only, not a
claim that every linked route passed.

The initial `VehicleCard`/`JobCard` style-array crash therefore has an
**actualbrowser** runtime fix in the exercised journey, in addition to the
`StyleSheet.flatten` **executabletests/staticreview** evidence.

Vehicle edit remains **blockedunverified**, but not a reproduced regression:
the customer vehicle list/detail UI exposes no Edit control or edit form. No
API edit bypass was used. Cancellation/ownership permutations and the other
unvisited customer routes remain untested.

### 10.2 Final owner/Job 100 Ghost Garage repeat — **blockedunverified, not an app bug**

Owner 261 could reauthenticate; shop 217 and bay 47 rendered with active
`$160.00/hr`, minimum senior tier, repair/diagnostic categories, and the
expected equipment. Organization 185 was selected once to open the existing
request list. Job 100 rendered as an accepted dealership repair, but the owner
UI exposed it read-only with no lift, transport, bay, approve/reject, or
other mutation controls.

The assigned fixture mechanic 262's credential remained unusable (HTTP 401)
and was not retried again. Fresh mechanic 292 could reach `/bays/100`, but
received only generic technician-eligible lift listings, two correctly
forbidden HTTP 403 resource loads, and no job-specific booking control.
Mechanic 292 was not the assigned mechanic for Job 100, and the available bay
eligibility did not match the required senior/job context. This is a
fixture/authorization-context limitation, **not an application bug**.

The backend bay suite remains **PASS 4/4**; the prior Part 6 connected
Ghost-owner browser flow passed; and the mandatory initial owner bay edit
passed. These support the implementation, but the complete repeated Part 7
owner/Job-100 lift/transport/approve/reject/cancel/rebook browser flow is not
certified. The corrected continuation-day overnight interval likewise remains
executable-test evidence rather than a new browser claim.

### 10.3 Mobile build and native availability

**executabletests:** mobile phase-2, partner, Ghost Garage, and Part 7
security scripts are recorded as 6/6 passing; mobile typecheck passed.

**blockedunverified:** the configured static build reached Metro readiness and
approximately 99.9% of the iOS bundle transform, then timed out at 300 seconds
without returning and without writing the expected platform manifests. The
unqualified root build also failed because `PORT` and `BASE_PATH` were not
provided; API, demo-video, and mockup package builds passed with configuration.

No physical device is registered in local Expo metadata, no signed EAS build
was verified, and no iOS/Android installation, permissions, push receipt,
browser handoff, biometric, store, or native reader result is claimed.
Static JS manifests, if present from an earlier state, would not be signed
native binaries.

## 11. Payments and external integrations

### 11.1 Stripe configuration

**staticreview:** raw-body mounting before JSON parsing, signature verification,
event-ID deduplication, server-side pricing, manual capture, ownership gates,
destination readiness, rate limits, and state guards are present. Mobile opens
the returned hosted URL and does not mark a job paid locally.

**executabletests:** safe unsigned HTTP probes reached health/config/auth
boundaries; they did not create a Checkout Session, PaymentIntent, charge,
refund, transfer, payout, or provider endpoint.

**blockedunverified/confirmed runtime blocker:** the supplied running-process
evidence reported:

```text
Stripe webhook NOT ready
status: missing_signing_secret
matchingEndpoints: 16
missing: charge.dispute.* transfer.* payout.*
```

The environment status showed a secret name, but the running process did not
load an accepted signing secret. Values were not read. Reconcile secret scope
and process state with the intended existing development endpoint, add the
missing event families without creating duplicates, and observe one signed
event plus one duplicate delivery before calling this ready.

### 11.2 Payment lifecycle and financial controls

The source supports server-owned amounts/tax/commission, job locking, manual
capture, 24-hour confirmation/dispute hold, admin/state-gated refund/cancel
paths, deterministic full-refund idempotency, and role/object checks.

The following are still material:

* partial Stripe refunds are not reconciled; `charge.refunded` represents a
  full local refund, so a direct provider partial refund can diverge;
* no refund ledger records provider refund object identity, amount/currency,
  partial/multiple refunds, or provider-confirmed time;
* transfer IDs are not reliably back-linked to payment IDs and transfer/
  payout failure does not transition the associated payment to `payout_failed`;
* payment-provider identifiers lack live partial uniqueness; and
* no real checkout, capture, refund, Connect, transfer, payout, or signed
  webhook delivery was observed.

These are reasons for **NOT READY for payment beta**, even though source and
unit checks are favorable.

### 11.3 Tips and disputes — post-architect fixes

The post-architect tip/dispute fixes are in the current diff and the latest
API evidence records them within the **30 passing tests**:

* tips now distinguish recoverable payment failure from cancellation,
  allow same-intent failure → success recovery, make refunds terminal, resolve
  signed metadata safely, and make repeated events no-ops;
* dispute upsert uses a transaction, row lock, unique-provider insert race
  handling, monotonic status ranks, and terminal-first behavior without
  creating an inappropriate hold; and
* payout ledger insert failures now propagate so Stripe can retry.

This is **executabletests** plus **staticreview**, not signed-provider or
PostgreSQL concurrency certification. Duplicate tip HTTP requests remain a
real blocker: the current route inserts a row before it has the ID-derived
idempotency key. Add a client request key or locked pending-row reuse before
payment beta.

The final composed `failed → refunded → late success` guard is now fixed and
verified by 11 focused executable tests plus API typechecking. The actual
refund SQL path uses the shared `tipRefundableWhere` predicate, which accepts
retryable payment failures but preserves cancellation/refund terminal states.
Coverage includes same-intent and replacement-metadata ordering and SQL guard
generation. These tests overlap earlier coverage; they are not 11 additional
independent application journeys or signed-provider certification.

### 11.4 Connect, email, push, AI, media, VIN, and suppliers

| Integration | Current result | Classification and required next step |
| --- | --- | --- |
| Mechanic Connect | Source gates readiness and destination changes | **staticreview**; provider onboarding/transfer settlement **blockedunverified** |
| Shop Connect | Onboarding stores owner account on `users`; shop checkout reads `shops` | Confirm account-ownership/product model, then implement and test one coherent contract; payment-beta blocker |
| Email/Resend | Connector header typo fixed; errors are redacted | **executabletests/staticreview** only; send/delivery, timeout, and cache behavior uncertified |
| Expo push | Token allow-list, batching, timeout, ticket validation, nonfatal failures | **staticreview**; no receipt persistence or physical-device delivery |
| AI assistant | Auth/context gates and explicit provider-unavailable 503 | **staticreview**; no provider response, dedicated rate limit, content cap, or data-retention decision |
| Image/video | Admin/policy gates and asset state handling; video remains a stub; local bytes may disappear | **staticreview**; durable object storage and provider execution unverified |
| VIN/NHTSA | Strict VIN validation and 502 on provider failure; two implementations have no explicit timeout | **staticreview**; provider availability and timeout behavior unverified |
| APS Curated | Catalog-backed synthetic reference; now truthfully `supportsLiveOrders = false` | **staticreview/executabletests**; no live order |
| PartsTech/other suppliers | PartsTech explicit no-order stub; Nexpart/WHI/Worldpac absent | **blockedunverified**, no live supplier capability claim |
| Subscriptions | No recurring billing route/schema found | Not implemented; do not claim subscription support |

## 12. Dependency and scanner results

### 12.1 Scanner baseline to final

The baseline dependency artifact
[`part7-security-scanners.json`](audit/part7-security-scanners.json) reported
**102 dependency findings**:

| Baseline | Count |
| --- | ---: |
| Critical | 11 |
| High | 59 |
| Moderate | 26 |
| Low | 6 |

The final dependency artifact
[`part7-security-scanners-final.json`](audit/part7-security-scanners-final.json)
reported **6 residual dependency findings**:

| Final dependency result | Count |
| --- | ---: |
| Critical | 0 |
| High | 4 |
| Moderate | 1 |
| Low | 1 |

The four final highs are the two `image-size@1.2.1` findings and the
`uuid@3.4.0` / `uuid@7.0.3` findings. The moderate is
`decode-uri-component@0.2.2`; the low is `esbuild@0.27.3`. The dependency
record explains why these remain in Expo/Metro or parent-version compatibility
chains rather than applying out-of-range overrides.

### 12.2 SAST and privacy

The baseline SAST artifact contained two **HIGH** path-traversal findings in
`artifacts/mobile/server/serve.js` (manifest/static file path reads). The
current diff canonicalizes decoded paths and adds invalid encoding/NUL,
sibling-prefix, encoded traversal, platform, and HTTP 403 focused checks.
Those checks passed as **executabletests**.

The final SAST run did **not** complete: the final run outcome is
`UNEXPECTED_DISCONNECT`; the JSON artifact records `status: "rejected"` with
an unhelpful `"[object Object]"` error. Therefore the two initial SAST highs
are **not scanner-rescan-certified**. Targeted tests show the intended fix;
they do not prove the scanner's final result.

Privacy was **0 findings** in both baseline and final artifacts. That is
scanner evidence only, not a complete privacy review; the source audit still
found and fixed the mechanic-profile and historical-vehicle-contact
disclosures described above.

## 13. Executable regression and pre-existing regressions

### 13.1 Recorded executable results

| Check | Result | Label |
| --- | --- | --- |
| Latest API unit/static suite | **30 pass**; includes tip/webhook-focused coverage | executabletests |
| API typecheck | Pass | executabletests |
| DB partner/commercial/bay/Ghost suites | **16/16 pass**, 0 skipped | executabletests |
| Mobile scripts | **6/6 pass**, 0 failed/skipped | executabletests |
| Mobile typecheck | Pass | executabletests |
| Connected customer → mechanic 292 browser journey | Vehicle/request/job acceptance/approval/progress/work-log/completion/invoice/history/reviews recorded; no live payment | actualbrowser |
| Owner Job 100 Ghost repeat | Owner read-only; mechanic 262 unusable; mechanic 292 received proper 403/context mismatch | blockedunverified; not an application bug |
| Tracked fixture cleanup | One guarded transaction; fresh-ID absence queries all zero; baseline counts restored | executabletests/staticreview |
| Library/codegen/export compatibility | Pass; generated export checks retained existing surfaces | executabletests/staticreview |
| API/demo-video/mockup builds | Pass with required env configuration | executabletests |
| Root build without `PORT`/`BASE_PATH` | Failed at configuration validation | executabletests; configuration failure |
| Mobile static build | 300-second timeout after Metro/iOS near-completion; expected manifests absent | blockedunverified |
| Workspace `git diff --check` | Fails only generated EOF blank lines in three generated API files in the regression record | executabletests; cleanup/formatting item |

The regression record enumerates additional independent suites (API library,
password reset, and Anthropic package checks) separately; those counts must
not be added to the requested latest 30-test figure as though they were one
suite.

### 13.2 Pre-existing residual regression blockers

The following were known or pre-existing architectural/configuration gaps,
not introduced as new feature behavior by this report:

* webhook claim-before-effects crash replay can acknowledge a replay without
  reapplying effects after a process crash;
* `payment_intent.succeeded` can mark payment `captured` before loyalty,
  referral, and progression effects finish, leaving those effects unreplayed
  after a failure;
* shop Connect account ownership does not match shop checkout destination
  storage;
* payment IDs and refund history lack database/audit guardrails;
* running webhook configuration lacks the accepted signing secret and event
  families;
* mobile static build timeout/native-device unavailability remains unresolved;
* provider delivery, device push, external AI/email/VIN/supplier behavior
  remains uncertified.

The current diff hardens surrounding paths (dedup fail-closed, stale state
guards, tip/dispute transitions, payout insert errors), but it does not make
the crash-replay/capture-effects paths production exactly-once safe. These
remain **financial beta/P0** issues.

## 14. Cleanup status — complete for tracked synthetic fixtures

The resumed browser record documents one guarded transaction that nulled
cyclic Request 34/35 ↔ Job 100/129 links, deleted dependent approvals,
worklogs, messages, inspections, parts rows, transport legs, reviews/ledger
rows, and then deleted only the tracked fixture roots. It removed users
261/262/263/264/292, organizations 185/186, shops 217/218, Bay 47, vehicles
217/218/245, operations 116/117, requests 34/35, and jobs 100/129.

Fresh post-commit database reads returned:

| Relation | Count |
| --- | ---: |
| users | 52 |
| shops | 4 |
| bays | 4 |
| bay bookings | 2 |
| vehicles | 13 |
| ownership history | 12 |
| jobs | 8 |
| organizations | 0 |
| partner vehicle operations | 0 |
| partner service requests | 0 |
| remaining work logs | 2 |

Every tracked-ID absence query returned zero, including users, shops, Bay 47,
organization vehicles, vehicle 245, ownership rows, jobs 100/129,
organizations, operations, requests, and work logs. No live payment was
created or deleted by amount/global count, and no unrelated row was removed.
Old browser pages retained cached vehicle/job content after commit; the
absence/count result came from fresh database reads, not stale screens.

## 15. Prioritized bug and remediation table

“Fix” below means the concrete next action required for evidence; it does not
mean the action has already been performed.

| Priority / classification | Bug or gap | Exact evidence/source | Required fix and proof |
| --- | --- | --- | --- |
| P0 financial beta | Running webhook has no accepted signing secret; event families missing | `docs/audit/part7-payment-integrations.md`; runtime probe record; `artifacts/api-server/src/lib/stripeWebhook.ts` | Reconcile secret scope/process with the intended existing endpoint, add required event subscriptions without duplicates, deliver one signed event and one duplicate; record results without exposing secrets. |
| P0 financial beta, pre-existing | Dedup claim can survive a crash before business effects; concurrent claim can acknowledge before effects complete | `docs/audit/part7-payment-integrations.md` §3; `stripeWebhook.ts` | Design a bounded existing-transaction/outbox/replay repair, then execute crash/replay/concurrent-delivery tests. Do not claim exactly-once until verified. |
| P0 financial beta, pre-existing | Capture is recorded before loyalty/referral/progression effects complete; failed effects are not replayed | `docs/audit/part7-payment-integrations.md` §3 | Make effect completion/replay state transactional or explicitly recoverable; test failure after each boundary and replay. |
| P0 payment beta | Duplicate tip requests can create different rows/keys | `docs/audit/part7-payment-integrations.md` §4; `routes/tips.ts` | Add a client request key or transaction/row-lock pending-row reuse; test concurrent identical requests and one provider session. |
| P0 payment beta | Shop Connect owner-vs-shop destination mismatch | `docs/audit/part7-initial-payments-mobile.md`; `docs/audit/part7-payment-integrations.md`; `routes/payouts.ts`, `routes/payments.ts` | Decide account ownership for multiple locations, align onboarding/storage/checkout, then test readiness and destination changes. |
| P0 payment/audit | No refund ledger or partial-refund reconciliation | `docs/audit/part7-database.md` §3; `part7-payment-integrations.md` §2 | Define and migrate reviewed refund entity/event contract; test full, partial, repeated, delayed, and provider-confirmed refunds. |
| P0 integrity | Provider payment identifiers lack partial uniqueness | `docs/audit/part7-database.md` §§2, 5 | Confirm payment-attempt vs canonical-row model; backfill/check duplicates; add reviewed partial unique constraints and retry tests. |
| P1 security certification | Final SAST disconnected/rejected | `docs/audit/part7-security-scanners-final.json`; `part7-frontend.md`; `artifacts/mobile/server/serve.js` | Rerun the same SAST tool after the current process is stable and preserve a successful final artifact; targeted tests alone are insufficient. |
| P1 browser coverage | The Ghost owner/lift repeat remains uncertified because the retained mechanic fixture could not authenticate and its replacement was not assigned/eligible | `docs/audit/part7-browser-regression.md`; current report §10.2; `docs/partner-layer-part6.md` | Treat as a fixture/context limitation, not a code bug. Complete the required scoped role sequence with a valid assigned mechanic/bay fixture before claiming full browser regression coverage. |
| P1 mobile release | Static build timeout and no signed/physical device | `docs/audit/part7-regression.md`; `part7-initial-payments-mobile.md` | Resolve Metro/build harness, generate/verify artifacts, then test a registered physical iOS and Android device. |
| P1 provider readiness | Stripe settlement, Resend delivery, push receipts, AI, media durability, VIN, suppliers unverified | `docs/audit/part7-payment-integrations.md` §§8–10 | Add provider-safe test-mode evidence, timeouts/receipts/storage, and real adapters before enabling claims. |
| P2 database hardening | Missing FKs/CHECKs/ownership exclusion/immutability enforcement and source/live index drift | `docs/audit/part7-database.md` §§5–6 | Review backfill/deletion/unknown-event policy, generate checked-in migrations, apply only through owner-approved nonproduction then production process, and rerun integrity queries. |
| P2 operational hardening | AI prompt limits, email timeout/cache comment mismatch, NHTSA duplicate clients/no timeout, media local durability | `docs/audit/part7-payment-integrations.md`; `part7-security-backend.md` | Add bounded inputs/rate limits/timeouts/durable storage and execute focused tests. |
| P2 coverage | Reviews, messaging, inspections, disputes route/provider, finance/growth/admin negative cases lack broad route-level runtime coverage | `docs/audit/part7-regression.md`; `part7-security-backend.md`; `part7-frontend.md` | Add authenticated negative/positive matrices per route family; label each result actualbrowser or executabletests. |

## 16. Retest and sign-off plan

The customer browser run, transactional fixture cleanup, and focused composed
payment-event verification are complete. Their passing results do not resolve
the remaining release blockers or authorize a payment beta.

Before changing the decision from NOT READY, the owner must still:

1. produce a successful final SAST artifact rather than the disconnected/
   rejected result;
2. reconcile webhook configuration and capture a signed test-mode event plus
   duplicate;
3. verify the crash-replay and capture-side-effect repair under failure and
   replay, not merely ordinary happy-path unit tests;
4. resolve the shop Connect ownership contract, payment-ID constraints, refund
   ledger/partial-refund policy, and duplicate-tip request contract;
5. resolve the mobile build timeout and obtain physical
   device evidence for any native/mobile claim; and
6. run the remaining route-level negative and cross-tenant matrices, reporting
   blocked provider/device cases as blocked rather than pass.

## 17. Final beta classification

Final runtime check: the rebuilt API started successfully, and the mobile web
login rendered at a 402×874 viewport without a browser error. The Stripe
`missing_signing_secret` warning remains. Metro additionally recommends Expo
`~54.0.37` and expo-constants `~18.0.14` over installed `54.0.35` / `18.0.13`;
these compatibility warnings are recorded, not a physical-device pass.

| Release target | Classification | Rationale |
| --- | --- | --- |
| Public web launch | **NOT READY** | The connected customer journey passed through completion, but broad route-family coverage is incomplete; final SAST is not certified; external/device behavior is unverified. |
| Payment beta | **NOT READY / P0 BLOCKED** | Missing runtime signing configuration, crash-replay/capture-effects financial risk, shop Connect mismatch, refund audit gap, payment-ID constraints, and duplicate tip requests. |
| Native mobile beta | **NOT READY** | Build timed out; no signed EAS artifact or physical-device evidence; push/camera/location/OBD/reader behavior unverified. |
| Internal development testing | **Permitted with explicit limits** | Focused tests, static review, scoped browser evidence, and safe fixtures support continued engineering; they do not authorize public/payment claims. |

This report's honest coverage conclusion is: **substantial targeted
hardening is evidenced, but there is no all-features E2E claim and no public or
payment-beta readiness approval.**