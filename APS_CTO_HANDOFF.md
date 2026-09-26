# APS — CTO takeover manual

**Baseline:** repository commit `ff83ecd`, initially clean. **Evidence date:** Part 7 audit dated 2026-09-13, followed by the business-account correction. This handoff reviews that evidence against the current repository source. It is **not** a new production inspection, deployment authorization, or release approval.

**Decision retained from last recorded audit:** **NOT READY** for public web launch, payment beta, or native mobile beta. Internal development with explicitly scoped tests is appropriate. Actual deployed URL, production database, provider configuration, production migrations, and current running state were **not queried** for this handoff. Do not mistake a source-complete feature for a live-certified one.

## Contents

1. [How to read this manual](#1-how-to-read-this-manual)
2. [System architecture and repository](#2-system-architecture-and-repository)
3. [Frontend architecture and screen ownership](#3-frontend-architecture-and-screen-ownership)
4. [Backend services and background work](#4-backend-services-and-background-work)
5. [Database model, constraints and migrations](#5-database-model-constraints-and-migrations)
6. [Identity, authentication and authorization](#6-identity-authentication-and-authorization)
7. [Customer journey](#7-customer-journey)
8. [Mechanic journey](#8-mechanic-journey)
9. [Admin and growth](#9-admin-and-growth)
10. [Partner shops, Ghost Garage, dealership and fleet](#10-partner-shops-ghost-garage-dealership-and-fleet)
11. [Scheduling, lifts and transport](#11-scheduling-lifts-and-transport)
12. [Payments, fees, Connect and financial state](#12-payments-fees-connect-and-financial-state)
13. [Parts ordering and fulfillment](#13-parts-ordering-and-fulfillment)
14. [Notifications and external services](#14-notifications-and-external-services)
15. [Actual API route map](#15-actual-api-route-map)
16. [Environment and configuration ownership](#16-environment-and-configuration-ownership)
17. [Dependencies and security](#17-dependencies-and-security)
18. [Known defects, gaps and historical audit reconciliation](#18-known-defects-gaps-and-historical-audit-reconciliation)
19. [Non-executing deployment and recovery runbook](#19-non-executing-deployment-and-recovery-runbook)
20. [Tests, evidence and verification plan](#20-tests-evidence-and-verification-plan)
21. [Priorities, acceptance criteria and first week](#21-priorities-acceptance-criteria-and-first-week)
22. [Source index and open product decisions](#22-source-index-and-open-product-decisions)

## 1. How to read this manual

### Status vocabulary

| Status | Precise meaning |
| --- | --- |
| **Implemented** | Current source has the end-to-end *application-code path* described; **not** a claim of live provider, production, physical-device, or all-route certification. |
| **Partially Implemented** | A useful path exists but a material part of that named capability remains missing. |
| **Incomplete** | The named capability is actually absent/unfinished in current inspected source, **not** merely untested. |
| **Planned** | Explicitly supported by a documented contract/TODO; not a promised delivery date or approved roadmap. |
| **Needs Verification** | Source may implement it, but the specified runtime/provider/deployment outcome is not demonstrated. |

**Evidence:** `current source` means read-only inspection of the commit baseline; `historical test` means previously recorded execution in the cited document; `historical browser` means its recorded connected session; `provider/native/production unverified` means exactly that. Current source supersedes stale Part 7 assertions, including 86→87 TSX, 7→8 scripts, shop Connect ownership, canonical retry, and transfer linkage. Part 7 remains essential historical evidence, not a current-diff description: its former “309 changed files” describes an *old* working tree, not this clean baseline.

### Trust boundaries

```text
Expo Router web/native UI  --bearer JWT-->  Express /api  --> PostgreSQL/Drizzle
       | generated Orval hooks                |   |   |
       | direct customFetch                   |   |   +-- app-local schedulers
       +-- Expo device APIs                  |   +------ Stripe managed connector,
                                           |           Anthropic/OpenAI, Resend,
                                           |           Expo push, NHTSA
                                           +---------- catalog/parts adapters,
                                                        media local filesystem
Stripe signed events --> raw-body /api/stripe/webhook --> payment/ledger/job effects
```

Browser UI authority is never equivalent to server authorization; Stripe webhook/payment records, not a local UI callback, determine payment outcome. Role, organization ownership, job relationship, fees and payout destination are enforced/re-derived on the server. Provider and timer delivery remain outstanding operational boundaries.

## 2. System architecture and repository

| Location | Owner / purpose | Start editing here |
| --- | --- | --- |
| `artifacts/mobile/app/` | Expo Router route-group screens, layouts and shared deep links | Role group or shared route `.tsx`; `app/_layout.tsx` |
| `artifacts/mobile/context/AuthContext.tsx`; `hooks/useSelectedPartnerOrganization.ts`; `lib/` | Session, selected tenant, API/device helpers | Auth/tenant change begins here **and** on API |
| `artifacts/mobile/components/`; `data/obd2Codes.ts` | Shared cards/widgets; local diagnostic code catalog | Do not infer hardware OBD support |
| `artifacts/mobile/server/serve.js`; `scripts/build.js`; `app.json`; `eas.json` | Static web serving/build and native configuration | Reconfirm actual platform targets |
| `artifacts/api-server/src/app.ts`; `index.ts`; `routes/index.ts` | Express startup, middleware, route mounting | Webhook ordering and process startup |
| `artifacts/api-server/src/routes/`; `lib/`; `middlewares/` | HTTP policy, engines, integration clients and guards | Start with owning route, then engine and tests |
| `artifacts/api-server/tests/`; `src/lib/*.test.ts` | Node/TS focused integration and unit tests | Nonproduction flags for DB integration |
| `lib/db/src/schema/`; `lib/db/src/index.ts` | Drizzle schema and connection | Schema ≠ applied live schema |
| `lib/api-spec/openapi.yaml`; `lib/api-client-react/`; `lib/api-zod/` | Contract and Orval-generated client/validators | Edit contract then regenerate; avoid hand-editing generated output |
| `lib/tier-catalog/src/index.ts` | Shared tier, commission, split rules | Check API use and mobile presentation together |
| `lib/integrations-{anthropic,openai}-ai/`; `artifacts/demo-video/`; `artifacts/mockup-sandbox/` | AI wrappers; separate Vite presentation artifacts | Not core mobile routes |
| `scripts/src/`; `pnpm-workspace.yaml`; `pnpm-lock.yaml`; `.replit` | Development migration scripts, workspace pinning, deployment configuration | No implicit production migration |

The workspace uses pnpm and TypeScript, React 19.1, Expo 54 / React Native 0.81.5, Expo Router 6, React Query, Express 5, Drizzle and PostgreSQL, Orval-generated React/Zod API layers. Node 24 and PostgreSQL 16 appear in `.replit` configuration; **running versions were not verified**. `.replit` configures an autoscale application router, local port mappings and postbuild pruning. Workspace artifact preview routes reported here are `/` (mobile), `/api` (API), `/demo-video/`, and `/__mockup`; preview paths are not evidence of production URLs. Confirm configuration path syntax and actual deployed routing before use; never infer a public address from EAS scaffolding.

### Primary data flow

```text
customer / human business admin -> user + vehicle / partner operation
                                -> ordinary job <- partner request (Send to APS)
mechanic board -> accept -> customer-of-record approval -> work/log/inspection
             -> completion -> confirmation/dispute/hold-expiry capture decision
 accepted job -> eligible hosted Checkout -> manual authorization
             -> capture request -> signed webhook -> payment/job/ledger effects
 checkout stores Connect destination snapshot -> provider event + payout_event
```

These are interacting flows, not a guarantee that all legacy jobs completed payment authorization. Checkout currently requires an accepted job; do not move initial checkout after completion based on this diagram. Business identity labels may display on the job, but the human `jobs.customerId` remains the payment/approval/review/audit principal. A shop is a location, not an organization or automatically created member account.

## 3. Frontend architecture and screen ownership

**Current source inventory:** **87 TSX** = **78 screens + 8 layouts + `+not-found.tsx`**. The older Part 7 inventory of 86/77 predates business payout UI; its route-by-route test labels are historical and not a fresh certification of screen 87.

Root `app/_layout.tsx` constructs the shared React Query client and generated-client API base URL, shows a visible configuration error for invalid API config, restores auth, routes unauthenticated visitors to login and authenticated users by role, mounts shared stacks and an AI assistant widget/push-unavailable banner. Generated paths already include `/api`; direct `customFetch` callers must use `/api`. Route groups `(customer)`, `(mechanic)`, `(admin)`, `(shop-owner)`, `(auth)` are directory organization, not literal URL segments.

| Role | Major real screen files and capabilities | Status / boundary |
| --- | --- | --- |
| Auth | `(auth)/login.tsx`, `register.tsx`, password-reset screen; `AuthContext.tsx` | **Implemented** person and business signup forms; business-first choice among Customer, Mechanic, Shop, Dealership and Fleet (historical 5/5 browser signup). Login does not directly pass org ID; selection is resolved afterwards. |
| Customer | `(customer)/index`, `jobs`, `vehicles`, `profile`, `request-service`, `detailing`, `loyalty`, `referral`, `review/[jobId]` | **Implemented** create/remove vehicle, ordinary request and job views; **Incomplete** vehicle edit UI on current vehicles screen. |
| Mechanic | `(mechanic)/index`, `available`, `active`, `history`, `profile`, `progression`, `amplification`; `mechanic/[id]`, `mechanics`, `mechanic/earnings`, `mechanic/payouts/{index,[jobId]}`, `mechanic/parts/[jobId]`, `mechanic/vin`, `mechanic/workspace/[vin]` | **Implemented** board, filters, progression and work paths; payout provider settlement **Needs Verification**. |
| Admin | `(admin)/index`, `users`, `payments`, `jobs`, `flags`, `trust`, `certifications`, `disputes`, `finance` | **Implemented** API-connected management surfaces; full negative-access and provider reconciliation **Needs Verification**. |
| Growth | `(admin)/growth/{index,queue,library,content/[id],referrals,cpa,trends,regions,integrations,amplification,admin-controls}` | **Partially Implemented** editorial/queue/settings and provider-dependent publish/media paths; avoid promising external publishing. |
| Shop/partner | `(shop-owner)/{index,vehicles,post-job,invoices,bookings,profile,organizations,partner-vehicles,payouts}` and `service-requests/{index,new,[id]}` | **Implemented** organization-scoped screens, owner locations, request/APS bridge, bay editor; Connect result **Needs Verification**. |
| Shared | `job/[id]` + approve/confirm-work/invoice/tip; `bays/[jobId]`, `worklog/[jobId]`, `inspection/[jobId]`, `workbench/[jobId]`, `transport/[jobId]`, `tracker/[jobId]`, `messages/[jobId]`, `vehicle/[id]`, `history/[vehicleId]`, `parts/[vehicleId]`, `obd2/[vehicleId]`, `transfer/[vehicleId]`, `shop/[id]`, `profile/[id]` | **Implemented** screens as named, not a claim all provider/native workflows work. |

`workbench/[jobId].tsx` is a substantial tabbed implementation (overview/diagram, parts, history, recommendations, assistant and work notes). It requires the assigned mechanic and an eligible job state; unauthorized contexts show a locked screen. `inspection/[jobId].tsx` supports pre/post, photo picker, mileage, checklist, transport damage and a create mutation requiring at least one photo. **Needs Verification:** native capture/upload/persistence and role permutations.

`obd2/[vehicleId].tsx` only searches local `data/obd2Codes.ts` with vehicle context: **Implemented** lookup; **Incomplete** BLE pairing, ECU transport and live telemetry. Push hook registers native Expo tokens and handles tap navigation, but web/Expo Go is explicitly unavailable; receive listener is not an in-app notification feed. Do not present the latter as merely untested.

`AuthContext` stores token/user in **AsyncStorage, not SecureStore**; bootstrap verifies `/auth/me` with a 5-second abort, clears on 401/403, and retains cached credentials on network/unexpected failure. Per-user selected organization is validated against returned owned organizations; stale selections clear and a sole owned organization can auto-select. The selected-organization UI does not replace server tenant checks.

## 4. Backend services and background work

`src/app.ts` mounts the signed raw-body Stripe webhook **before** default JSON/URL-encoded middleware, then mounts `/api` routes, logging, generic error handling, and process-start initializers. There are **44 route modules** mounted under `/api` plus the separately mounted Stripe webhook. `cors()` is broad; `express.json()` uses its framework **default size limit**, with **no explicit custom limit** in app source—do not claim an unlimited body. `trust proxy=1` and `pino-http` are configured.

| Service / engine | Starting files | Key behavior and caveat |
| --- | --- | --- |
| Auth, tenancy, validation | `lib/auth.ts`, `middlewares/authenticate.ts`, `routes/auth.ts`, `lib/sharedRegistrationValidator.ts` | bcrypt, JWT, DB reload, business signup transaction; enforce negative cases server-side. |
| Job/partner | `routes/jobs.ts`, `partnerOrganizations.ts`, `partnerVehicleOperations.ts`, `partnerServiceRequests.ts`, `commercialServiceRequests.ts` | Ordinary job and organization-scoped commercial bridge; version/idempotency/transaction guards. |
| Payments/Connect | `routes/payments.ts`, `payouts.ts`, `stripeWebhook.ts`, `lib/businessConnect.ts`, `payoutEventEngine.ts`, `payoutHoldEngine.ts`, `tipEngine.ts` | Hosted manual-capture lifecycle; canonical payment retry; unresolved crash-safe effects. |
| Bays/transport | `routes/bays.ts`, `bookings.ts`, `jobLiftRequirements.ts`, `transport.ts` | UTC interval/equipment/tier/collision checks and principal approval. |
| Parts | `routes/parts.ts`, `lib/partsOrderEngine.ts`, `lib/suppliers/`, `lib/partsProviders/` | Catalog, compatibility and synthetic ordering; **not live fulfillment**. |
| Notifications/provider | `lib/notifications.ts`, `email.ts`, `vinDecodeService.ts`, `mediaEngine.ts`; AI integration wrappers | Push send/Resend/NHTSA/local media/assistant; delivery and durability not certified. |
| Growth | `routes/growth.ts`, `integrations.ts`, `media.ts`, `lib/growthSchedulerInit.ts` | Content/queue/integration management and process-local sweeps. |

Process startup initializes payout, work-confirmation/approval and growth schedulers, supplier/media/publishing registries, credential cache and webhook config. `payoutSchedulerInit.ts` and `growthSchedulerInit.ts` use process-local timers (documented roughly 60-second sweeps), not a durable queue. `.replit` selects **autoscale**: scale-to-zero can miss sweeps, multiple instances can duplicate sweeps, and a restart can interrupt them. DB claims/locks mitigate some races but **do not make timers durable**. Design an externally scheduled durable worker/lease and idempotent replay before financial production.

## 5. Database model, constraints and migrations

`lib/db/src/schema/*.ts` declares **52 `pgTable` relations** in current source; this does **not** establish that 52 tables exist in today's production DB. Read-only Part 7 *development* fixture counts and checks were historical and cannot be projected onto prod. The later business-account correction documented cleaned development fixtures, not a current DB query.

| Domain | Representative relations and relationships |
| --- | --- |
| Identity/reputation | `users`, password-reset tokens, mechanic certifications, promotion/reputation/badge/amplification relations; JWT principal maps to DB user. |
| Vehicle/service | `vehicles`, ownership history, `jobs`, `work_logs`, inspections, transport legs, workspace/installed-parts notes and recommendations; job links customer and optional mechanic and vehicle. |
| Business/locations | `partner_organizations` → `primary_owner_id` (`users`); `shops` may link `organization_id`; organization → vehicle operations → service requests/history → ordinary APS job; shop → bays → bookings. |
| Financial | `payments` → job, customer/mechanic and payout snapshot; `tips`, `payout_events`, processed Stripe events, disputes, approvals, confirmations, loyalty/referral ledgers; Stripe reference IDs are not ownership substitutes. |
| Parts | `parts_catalog`, fitment/offers/orders/items and related entries: catalog compatibility, candidate order and itemized parts are separate concepts. |
| Content/privacy | Messages, reviews, flags/audit logs, favorites, growth content/settings, integration credentials and media metadata. |

Current organization fields include `legal_name`, `name` (DBA/display), `stripe_account_id`, `stripe_account_type`, `stripe_account_ready`, and `primary_owner_id`. Organization Connect ID has a **partial unique index in source**. Payments have nullable `payout_organization_id` and `payout_account_id` destination snapshots; payout events have nullable `organization_id` for mechanic/legacy events. Legacy `shops` location Connect columns and `users` mechanic columns still exist. Payout-event provider-event uniqueness and partner request composite constraints are declared; inspect individual schema files for exact DB types and deletion behavior before a migration.

**Not yet guaranteed in live DB:** `payments.job_id` unique canonical row; provider intent/session/transfer/payout partial-unique identifiers; a refund/refund-event ledger with provider ID, amount, currency, partial/multiple totals and confirmation time; comprehensive payment CHECK/state/money reconciliation; some denormalized booking/shop/worklog/inspection/commercial FKs; ownership no-overlap/open-owner exclusion; immutable marker enforced by trigger/restricted writes. Source/live index drift was reported for disputes, payout events and tips; its *current* live status is **Needs Verification** because no DB query was made here. The historical development snapshot had no observed duplicates/orphans in its checked set, which is not a uniqueness guarantee.

**Eight current migration scripts:** `scripts/src/migrate_partner_business_accounts.mjs`, `migrate_partner_organizations.mjs`, `migrate_partner_part4_vehicle_operations.mjs`, `migrate_partner_part5_service_requests.mjs`, `migrate_partner_part6_commercial.mjs`, `migrate_partner_part6_bays.mjs`, `migrate_partner_part6_bay_booking_history.mjs`, `migrate_parts_system.mjs`. The business migration is additive, idempotent, *development-only* and refuses production; Part 6 scripts likewise reject production. Others read `DATABASE_URL`; presence is neither proof of execution nor a managed production migration ledger. Part 7's seven-script count predated the business script. Do not hand-run development scripts on production or silently `drizzle-kit push`. Plan reviewed forward/backfill/rollback and compare **development and separate production schemas** through the approved Replit publishing schema-diff process.

## 6. Identity, authentication and authorization

**Individuals:** `/api/auth/register` creates customer or mechanic; legacy person-only `shop_owner` signup is rejected in favor of business registration. Passwords use bcryptjs cost **10**. JWT uses `SESSION_SECRET`, 7-day expiry and **no server-side revocation table**. Production auth requires a secret of at least **32 characters**; a development fallback exists. `lib/credentialStore.ts` derives an AES credential-encryption key from the **same** `SESSION_SECRET`; rotating it without a re-encryption/old-key strategy can make encrypted integration credentials unreadable. Never copy secret values into tickets/docs.

**Businesses:** `/api/auth/register-business` validates distinct `business` and human `administrator` objects, atomically creates exactly one active `shop_owner` user and one `partner_organizations` row with that `primaryOwnerId`; no automatic shop/location, staff membership or second owner. The human email authenticates; business contact/email/address are separate. Duplicate admin login email returns 409/rollback. Business subtype is `shop`, `dealership` or `fleet`, not three login roles. Existing per-user organization selection is never authorization by itself. `GET /api/auth/me`, login and organization lookup reconstruct the safe session; business jobs may use a safe label but customer-of-record remains the human user.

`authenticate` validates bearer signature/expiry, reloads current role/status from DB and rejects suspension. Sensitive mechanic routes use `requireActiveMechanic`; partner management requires active shop owner **and** exact primary owner/organization plus child scoping; admin routes require admin. Payment ownership checks customer/job/destination; bookings check assigned mechanic and owning shop. Part 7 fixed participant checks on flags, historical cancellation rights, private mechanic profile projection, historical vehicle contacts, and inactive mechanic mutations. Those targeted tests do not certify every cross-tenant route. Negative matrices for customer A/B, mechanic A/B, stale child IDs, pending/inactive users and admin denial remain **Needs Verification**.

**Security posture:** token persistence in AsyncStorage increases device exposure relative to secure keychain; 7-day nonrevocable tokens amplify incident response. Password-reset and payment limiters exist, but no global authorization proof follows from them. Rate-limit checkout 10/min, payment read/config 60/min, tip 5/min per user-or-IP (source); investigate proxy trust and abuse models. Broad CORS, default JSON body cap, local media and credential-key coupling need an explicit threat review.

**Incomplete hardening:** ordinary registration and login handlers in `routes/auth.ts` do not attach a dedicated authentication rate limiter. Do not confuse the reset/payment limiters with login brute-force protection. Establish abuse controls and session-revocation policy before public access.

## 7. Customer journey

**Implemented:** login/registration, dashboard/jobs/profile, VIN-linked vehicle creation/removal, service request and detailing, service history, approval/confirmation, invoice, hosted payment action when authorized, tip, review, loyalty/referral, messages, inspection read and job tracker. Source starts at `(customer)/`, shared `job/[id]`, `vehicle/[id]`, `history/[vehicleId]`, `routes/vehicles.ts`, `jobs.ts`, `customerApprovals.ts`, `workConfirmations.ts`, `payments.ts`.

**Historical browser evidence:** customer created a VIN-linked ordinary request, mechanic accepted/progressed, customer approved, work log completed, invoice appeared held, history and reviews were visible. **No charge button was clicked and no payment was made** in that journey. Card style-array crash was corrected via `StyleSheet.flatten` and browser rendering retested. The customer vehicle screen currently implements create and remove **but no edit button/form/update API caller**: vehicle editing is **Incomplete**, not an unverified regression. Cancellation, ownership transfer and payment/provider permutations were not covered by that one browser run.

## 8. Mechanic journey

**Implemented:** tier-filtered available/active/history board; accept/drive/arrive/start-work/status; work logs and inspection UI; VIN workspace, diagrams/parts/history/recommendations; progression/certifications, ratings, earnings/payout views; lift/transport; amplification/public profile. Check `routes/jobs.ts`, `worklogs.ts`, `progression.ts`, `mechanicWorkspace.ts`, `payouts.ts` and shared screens. `workbench/[jobId]` locks out nonassigned mechanics and wrong states. Job status and payment status are different state machines.

**Historical browser:** a newly active technician accepted an ordinary job and completed Maintenance work notes, with customer observing `EN_ROUTE`, `IN_PROGRESS`, `COMPLETED`. This did not test all inspections, messages, external VIN/parts, actual payout or native device. A retained older mechanic fixture failed authentication and a replacement correctly received 403 on another mechanic's Ghost job; **fixture/context limitation, not an application bug**. The later business signup browser still documented an existing mechanic dashboard three-resource **403** condition for pending status: isolate expected pending access versus genuine dashboard defects before changing guards.

## 9. Admin and growth

Admin screens and routes support users/status, jobs, payment refund/release, certifications/promotions, flags/trust, dispute resolution, finance overview/job/mechanic/flagged summaries. `routes/adminFinance.ts`, `payments.ts`, `progression.ts`, `disputes.ts`, `reviews.ts` are entry points. Correct admin fee UI says “Platform fee,” not a hardcoded stale 10%. Refund API is full-refund oriented; it does **not** provide a comprehensive provider refund ledger.

Growth routes implement overview, content generation/batch, review/approval/rejection, schedule, publish attempts, engagement, iteration/reuse, library/analytics/settings, mechanic kit and integration credential management. Relevant screens are `(admin)/growth/`; API is `routes/growth.ts`, `media.ts`, `integrations.ts`. Publishing/provider registries and media generation expose capabilities only where a provider is registered. Video generation remains a stub; external distribution and image durability are **Needs Verification/Partially Implemented**, not a completed multichannel platform. Credentials are encrypted with the SESSION_SECRET-derived key. AI/content retention and abuse controls require product/security decisions.

## 10. Partner shops, Ghost Garage, dealership and fleet

**Shop owner / organization:** a `shop_owner` human may own organization(s); selection is bound to the actual returned owned IDs. Organization is business identity; a `shop` is an explicitly created location with bays. Shop location can be linked to organization; old unlinked valid legacy shop Connect can be preserved after verification, never silently adopted by a linked organization. Current partner screens cover org/profile, locations, vehicles, operations, service requests, invoices, bays/bookings, payouts.

**Dealership and fleet:** both are organization subtypes sharing the same active `shop_owner` role and organization-scoped API, not independent credential systems. A registered operation links an eligible vehicle/location to org service requests. `send-to-aps` validates owner, org/operation/vehicle/location/status and service policy, transactionally creates or reuses **one ordinary REQUESTED job**; source request status and linked job status remain distinct. Mechanic sees sanitized job description rather than private operation notes/contact/Stripe IDs. The **exact human commercial principal** approves and pays the job. Historical dealership browser exercised Send to APS/accept/approve and org switching; fleet subtype has focused script/source evidence but no full fleet browser certification. There is **no staff membership model** in the correction contract; do not quietly build one.

| Subtype | Implemented operational data and functionality | Boundary |
| --- | --- | --- |
| **Dealership — Implemented** | Stock number, inventory state (`in_stock`, `preparing`, `ready`, `sold`), service-needed flag and service notes; scoped location/vehicle operations, service requests and APS dispatch bridge. | Not a full dealer-management or vehicle-sales system. Inventory metadata does not replace canonical vehicle ownership/history. |
| **Fleet — Implemented** | Unit number, group, operating state (`active`, `maintenance`, `out_of_service`, `retired`), odometer, usage hours, maintenance due date/mileage, downtime timestamp and notes; scoped service requests and APS job progress. | Due fields are stored operational data, not proof of automated preventive-maintenance dispatch, telematics ingestion or enterprise fleet billing. Those capabilities require separate verification/scope. |

Source: `lib/db/src/schema/partnerVehicleOperations.ts`, `routes/partnerVehicleOperations.ts` and the shared partner vehicle/request screens. One canonical vehicle may be registered with at most one partner organization at a time; operations belong to the organization/location relationship, not to the vehicle's permanent service history. Business signup and subsequent login/reload were historically verified for **both** dealership and fleet; the missing coverage is their broader operational/provider permutations, not all fleet browser activity.

**Ghost Garage:** location owner manages bay availability, equipment, category, tier, rate and auto-approval; mechanic assigned to a job requires a lift; exact customer/commercial principal approves transport; eligible bay booking can be pending/reserved/active/completed or rejected/cancelled with history. Prior Part 6 connected owner browser and Part 7 bay-editor/browser checks plus bay integration 4/4 support selected behavior. The Part 7 retained-job owner/lift *repeat* was unverified due to invalid assigned-fixture credentials and correct 403 for a nonassigned replacement; do not label those 403s a Ghost authorization defect.

## 11. Scheduling, lifts and transport

Bay search accounts for job/shop/active bay, time, UTC weekly windows, equipment, category, mechanic tier and overlap. Non-equal reversed hours (e.g. evening→next morning) are **valid overnight windows**. Part 7 fixed comparison of next-day early interval with the preceding day's overnight window; malformed/equal hours are rejected in editor and evaluator. Legacy always-available configuration is handled. Auto-approved bookings reserve immediately; manual requests require owner approval; one pending/reserved/active booking per job is enforced by application rules. Booking transitions allow rejection/cancellation/rebooking while preserving history; check DB constraints separately before claiming race-proof enforcement.

Lift requirement changes reset transport approval. Transport legs, damage/mileage checklist and booking/work-log gating are distinct from GPS/provider telemetry. Browser bay editor persistence and executable overnight/conflict tests exist; native/GPS/delivery coverage does not. Timed approvals, payout holds and growth publication use in-process schedulers: their **autoscale durability** is the operational blocker described in §4.

**Incomplete as a general scheduling product:** these reservation windows and timers do not establish a customer appointment calendar, recurring bookings, calendar-provider synchronization or automated fleet-maintenance scheduling. Do not promise those features based on bay reservations alone.

## 12. Payments, fees, Connect and financial state

### Authority and fee policy

`lib/tier-catalog/src/index.ts` is the commission source: same-tier ordinary work **20% platform / 80% mechanic**, work-down **25% / 75%**, detailing **15% / 85%**. `splitOnNetProfit` clamps parts cost to `[0,total]`, computes `net = total − parts`, takes the platform share of **net**, and passes parts cost plus mechanic net share to mechanic. Payment checkout derives service/catalog or category-default parts cost, excludes tax from commission base and can use the bounded stamped partner override (0–100%). Checkout's tax percentage input is **customer-supplied, server-clamped 0–15%**, not a tax engine or fee percentage. Tips currently have **0% platform fee**, i.e. 100% mechanic. Actual Stripe processing fees are best-effort fetched from provider balance transaction and persisted, not guessed as a fixed rate. **Do not change financial policy incidentally** while fixing bookkeeping.

### Checkout / capture / confirmation

The customer-of-record requests server-priced hosted Checkout; Stripe managed connector (not a direct `STRIPE_SECRET_KEY` application consumer) creates a manual-capture intent/session. The mobile app opens hosted URL and does not mark payment paid on return. Source has customer/job/status/readiness checks, user/IP rate limits, job locking, intended 24-hour confirmation/dispute hold and admin release/refund controls. Signed `payment_intent.succeeded` transitions authorized/capture-pending to captured, then marks job PAID and applies progression/loyalty/referral/mechanic point effects; related payout hold/release paths follow state guards. No signed provider event, real checkout, capture, transfer or refund was verified in this handoff.

**P0 reliability:** `processed_stripe_events` claims an event with conflict-ignore and returns 200 for duplicates; handler error deletes claim for retry, DB claim error returns 503. A process crash *after claim commit and before effects* leaves a claimed event with unapplied effects, so replay can be incorrectly acknowledged. Separately, capture state is persisted **before** downstream job/loyalty/referral/progression effects; a failure/replay can skip them. These paths are **Partially Implemented**, not crash-safe exactly-once.

**Canonical retries:** current `routes/payments.ts` reuses a single application-level payment row for a job, rejects ambiguous multiple rows, refuses authorized/terminal rows, preserves immutable destination snapshots on eligible retry and clears/replaces old provider refs so late events cannot authorize replacement. Historical provider-referenced rows **without verified payout snapshot are blocked**, not silently repaired. `payments.job_id` still lacks a DB uniqueness constraint; provider intent/session/transfer/payout refs need reviewed partial unique constraints. Distinguish *payment row* from multiple *provider attempts*.

### Connect ownership and payout correlation

For a new business, `partner_organizations` alone owns the **company** Connect account; onboarding/status/login-link require active primary owner, active exact organization ID. Human administrator is login principal; org is payout principal; linked shop inherits only exact ready organization's destination. Mechanic Connect remains individual/user-scoped; legacy **unlinked** shop account is accepted only when valid and unambiguous. Generic owner/shop aliases require explicit organization ID; they do not silently use a user-owned business account. Cross-table collisions, ambiguous legacy mappings and linked-shop/legacy conflicts **fail closed**. Part 7's old shop onboarding `users` versus checkout `shops` mismatch is **resolved for current canonical path**; legacy data still needs verified repair, not automatic backfill.

Checkout writes immutable `payoutOrganizationId`/`payoutAccountId` **before provider call**, and PaymentIntent metadata includes `paymentId`, job/customer/mechanic IDs, destination and optional organization. `payoutEventEngine.ts` links explicit transfer metadata (`paymentId` or `payment_id`) only when matching payment **and account snapshot**, filling a null `providerTransferId`; connected event account and provider IDs drive scoped payout-event attribution. **Fixed source linkage ≠ proof Stripe automatically forwards that metadata to every transfer**. Transfer failure/reversal records event and notifies but **does not transition associated payment status** to `payout_failed`; actual provider delivery, settlement and reconciliation remain **Needs Verification**. No live Connect onboarding was performed; historical integration used a mocked provider.

### Refund, disputes, tips

Admin full refund uses deterministic Stripe idempotency key, `reverse_transfer` and `refund_application_fee`; signed `charge.refunded` updates local payment/job/loyalty/referral state. There is **no partial/multiple-refund amount ledger**; direct partial provider refunds can be treated as full local refunds. Dispute upsert and monotonic ordering have row-lock/race tests; provider dispute delivery is unverified. Tip event ordering now handles recoverable payment failure, same-intent late success, terminal refund and duplicate events. However `POST /tips/jobs/:jobId` inserts a row *before* deriving ID-based Stripe idempotency key; identical concurrent HTTP requests can create distinct tips/checkouts. This is a P0 pre-beta request-idempotency gap.

### Payment state sketch (not exhaustive schema enum)

```text
job: REQUESTED -> ACCEPTED -> EN_ROUTE -> IN_PROGRESS -> COMPLETED -> PAID
payment: pending/failed/canceled --eligible checkout retry--> authorized
authorized -> capture_pending (confirmation/hold window) -> capture request
           -> captured (signed provider success);
admin cancel/refund and provider disputes are separately guarded transitions.
tip: created -> provider pending -> paid OR recoverable payment_failed;
     refunded/cancelled terminal; same-intent event ordering is guarded.
booking: pending -> reserved -> active -> completed;
         pending/rejected/cancelled retain audit history.
```

For exact allowed edges inspect `routes/payments.ts`, `lib/payoutHoldEngine.ts`, `routes/stripeWebhook.ts`, `lib/tipEngine.ts`, schema enums and tests; do not implement transitions from this abbreviated diagram.

## 13. Parts ordering and fulfillment

**Implemented source:** `PartsCatalog` and vehicle fitment/compatibility exist; mechanic recommendations, catalog parts and offer browsing feed candidate orders. `partsOrderEngine.ts` validates against the job vehicle and catalog: blocked fitment rejects order creation; warned fitment is recorded. Customer view removes supplier key/SKU/internal cost/margin; mechanic/admin have broader parts routes. Candidate → ordered → later authorized lifecycle is modeled; unsupported supplier remains candidate.

**Partially Implemented fulfillment:** `lib/suppliers/internal/apsCuratedAdapter.ts` draws local `parts_offers` and truthfully sets `supportsLiveOrders=false`; `placeOrder` produces only a synthetic reference, **not** a supplier purchase. `lib/suppliers/external/partsTechStub.ts` returns no offers and throws for placement even with configured keys. There is also an older parallel `lib/partsProviders/` adapter family; its PartsTech code reads `PARTSTECH_API_KEY`/`PARTSTECH_SHOP_ID` but is still stubbed. Resolve old/new adapter ownership before implementing live integration. Nexpart/WHI/Worldpac live adapters are not in the inspected current path. A catalog exists today; a future *production/live supplier catalog* is distinct, not “PartsCatalog absent.”

**P0 before enabling any real supplier:** candidate creation trusts caller `supplierKey`, `sku` and `unitPriceCents` when computing total; compatibility alone does not prove that SKU/price belongs to a server-resolved supplier offer. Require server-side offer lookup, immutable quote/price snapshot, expiry/reprice/error policy and negative tests before live order placement. Supplier fulfillment, shipment status, cancellation/refund reconciliation and real inventory availability are **Incomplete/Needs Verification** as appropriate; do not convert a synthetic reference into a live order claim.

## 14. Notifications and external services

| Capability | What current source does | What remains |
| --- | --- | --- |
| Expo push | Native token permission/register via `PUT /api/users/me/push-token`, allowlist, batching, timeout and nonfatal ticket errors; tap routes to job/mechanic board | **Partially Implemented:** no in-app feed/badge/read-state; no durable receipts/physical-device delivery evidence. Web/Expo Go intentionally unavailable. |
| Email | Resend connector/send with corrected headers and redacted errors | No explicit fetch timeout or delivered-message certification; distinguish provider send attempt from mailbox receipt. |
| AI | Auth/context-gated assistant and Anthropic/OpenAI integration wrappers; unavailable provider yields explicit 503 | Provider response **Needs Verification**; explicit assistant prompt/history bounds and dedicated limiter are **Incomplete**; retention/privacy policy needs a decision. |
| VIN | Server-side strict VIN format and NHTSA decode with 502 on failure | Duplicate clients and `fetch` without explicit timeout; remote availability **Needs Verification**. |
| Media | Admin-gated asset state, canonical filename containment, configurable local file path | Local published bytes not durable; video stub; use durable object storage/App Storage for release, confirm upload semantics. |
| OBD | Local code catalog search with vehicle context | **Incomplete:** hardware reader/BLE/ECU support. |
| Parts suppliers | APS Curated local synthetic; PartsTech stub, old and new adapter layers | No live supplier purchase. |
| External growth publication | Queued content and provider registry; explicit unavailable-provider error | Actual provider delivery, idempotent publication and schedules under autoscale not certified. |

**Known configuration mismatch — Incomplete:** the admin integration catalog accepts `openai_api_key`, but `lib/mediaProviders/openaiImage.ts` checks the managed OpenAI integration client/base URL. Entering the catalog credential alone does not activate image generation. Reconcile the credential contract before presenting the integration as connected. Business job push notifications still target the human primary owner's token; organization display identity does not create a separate business recipient or staff notification system.

## 15. Actual API route map

**Prefix:** examples below are public route paths with `/api` included. Routes are from current `routes/index.ts` and cited modules, not guessed REST aliases. Method/identity gates must still be read from route source; routes without auth (health/public card/hosted callback/webhook) are not interchangeable with privileged mutations. This is a **major endpoint inventory**, not every subroute or generated OpenAPI operation.

| Area | Method and path | Source |
| --- | --- | --- |
| Health | `GET /api/healthz` | `routes/health.ts` |
| Account | `POST /api/auth/register`, `POST /api/auth/register-business`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/admin-setup` | `routes/auth.ts` |
| Reset | `POST /api/auth/forgot-password`, `GET/POST /api/auth/reset-password` | `routes/passwordReset.ts` |
| Users | `GET /api/users`, `GET/PATCH /api/users/me`, `DELETE /api/users/:id`, `GET /api/users/:userId/mechanic-profile`, `PUT /api/users/me/push-token` | `routes/users.ts` |
| Mechanic reputation | `GET /api/mechanics`, `GET /api/mechanics/:mechanicId/reviews`, `GET /api/me/reviews`; `POST /api/reviews`, `GET /api/reviews/{user/:userId,job/:jobId,me/pending}`, `PATCH /api/reviews/:id`, `POST /api/reviews/:id/moderate-remove`, `GET /api/reputation/:userId`, `GET /api/badges/catalog` | `routes/mechanics.ts`, `reviews.ts` |
| Vehicles | `GET/POST /api/vehicles`, `GET /api/vehicles/:vehicleId`, `GET /api/vehicles/vin/:vin`, `DELETE /api/vehicles/:vehicleId`, `POST /api/vehicles/:vehicleId/transfer`, `GET /api/ownership/:vehicleId`, `GET /api/shops/:shopId/vehicles` | `routes/vehicles.ts`, `ownership.ts` |
| Vehicle workspace | `GET` history/component-specs/parts-catalog/recommendations under `/api/vehicles/:vehicleId`; `POST /api/mechanic/vin/decode`, `GET /api/mechanic/workspace/by-vin/:vin`, `GET /api/mechanic/workspace/:vehicleId` | `routes/vehicles.ts`, `mechanicWorkspace.ts` |
| Jobs | `GET /api/jobs`, `GET /api/jobs/available`, `POST /api/jobs`, `GET /api/jobs/:jobId`, `PATCH /api/jobs/:jobId/status`, `POST /api/jobs/:jobId/{accept,cancel,transport-approval,rate,rate-customer}`, `PUT /api/jobs/:jobId/mechanic-location`, `DELETE /api/jobs/:jobId` | `routes/jobs.ts` |
| Approvals/work | `GET /api/approvals/job/:jobId`, `POST /api/approvals/:jobId/{approve,decline}`, `GET /api/work-confirmations/job/:jobId`, `POST /api/work-confirmations/:jobId/{confirm,dispute}`, `POST /api/worklogs`, `GET /api/worklogs/{vin/:vin,:worklogId}` | `routes/customerApprovals.ts`, `workConfirmations.ts`, `worklogs.ts` |
| Inspection/comms | `GET/POST /api/jobs/:jobId/{messages,inspections}`; `GET /api/jobs/:jobId/transport`, `POST /api/jobs/:jobId/transport/legs`, `PATCH /api/jobs/:jobId/transport/legs/:legId/{finish,location}` | `routes/messages.ts`, `inspections.ts`, `transport.ts` |
| Dashboards | `GET /api/dashboard/{customer,mechanic,admin}` | `routes/dashboard.ts` |
| Shop/bays | `POST /api/shops`, `GET /api/shops/mine`, `GET/PATCH /api/shops/:shopId`, `GET/POST /api/shops/:shopId/bays`, `GET /api/bays/available`, `GET/PATCH /api/bays/:bayId` | `routes/shops.ts`, `bays.ts` |
| Booking/lift | `GET/PATCH/POST /api/jobs/:jobId/lift-requirement` (GET, PATCH and POST only); `POST /api/bays/:bayId/bookings`, `GET /api/bookings/mine`, `GET /api/bookings/:bookingId`, `PATCH /api/bookings/:bookingId/{start,complete,approve,reject,cancel}` | `routes/jobLiftRequirements.ts`, `bookings.ts` |
| Organizations | `GET/POST /api/partner-organizations`, `GET/PATCH /api/partner-organizations/:organizationId`, `GET/POST /api/partner-organizations/:organizationId/locations` | `routes/partnerOrganizations.ts` |
| Operations | `GET/POST /api/partner-organizations/:organizationId/vehicle-operations`, `POST /api/partner-organizations/:organizationId/vehicle-operations/link`, `GET/PATCH /api/partner-organizations/:organizationId/vehicle-operations/:operationId` | `routes/partnerVehicleOperations.ts` |
| Requests/APS | `GET/POST /api/partner-organizations/:organizationId/service-requests`, `GET/PATCH /api/partner-organizations/:organizationId/service-requests/:requestId`, `POST .../:requestId/transition`, `POST .../:requestId/send-to-aps`, `POST /api/partner/jobs` | `routes/partnerServiceRequests.ts`, `commercialServiceRequests.ts`, `partnerJobs.ts` |
| Parts | `GET /api/vin/:vin/decode`, `GET /api/jobs/:jobId/parts/recommended`, `POST /api/jobs/:jobId/parts/order`, `GET /api/jobs/:jobId/parts`, `GET /api/jobs/:jobId/parts/customer-view`, `PATCH /api/parts/orders/:id`, `GET/POST /api/admin/parts-catalog`, `POST /api/admin/parts-catalog/bulk-seed`, `GET /api/admin/parts-orders/flagged` | `routes/parts.ts` |
| Pay/Connect | `GET /api/payments/config`, `GET /api/payments`, `POST /api/payments/jobs/:jobId/checkout`, `GET /api/payments/checkout/return`, `POST/GET /api/payments/connect/{onboarding,status}` (respective source methods), `GET /api/payments/connect/return`, `POST /api/payments/:jobId/{release,refund}`, `POST /api/stripe/webhook` | `routes/payments.ts`, separately mounted `routes/stripeWebhook.ts` |
| Payouts | `GET /api/payouts/{summary,buckets,jobs,events,tax-documents}`, `GET /api/payouts/job/:jobId`, `POST /api/payouts/:jobId/retry`, `PATCH /api/payouts/job/:jobId/destination`, `GET /api/admin/payouts/overview` | `routes/payouts.ts` |
| Business Connect | `POST /api/partner-organizations/:organizationId/payouts/onboard`, `GET .../payouts/status`, `GET .../payouts/login-link`; compatibility `POST /api/payouts/shop/connect/onboarding`, `GET /api/payouts/shop/connect/status`, `POST /api/payouts/onboard`, `GET /api/payouts/status`, `GET /api/payouts/login` | `routes/payouts.ts` |
| Invoice/tips/disputes | `GET /api/jobs/:jobId/invoice`, `POST /api/tips/jobs/:jobId`, `GET /api/disputes`, `GET /api/disputes/:id`, `POST /api/admin/disputes/:id/resolve` | `routes/invoice.ts`, `tips.ts`, `disputes.ts` |
| Finance | `GET /api/admin/finance/{global,jobs,mechanics,flagged}`, `GET /api/admin/finance/jobs/:jobId` | `routes/adminFinance.ts` |
| Certifications | `GET /api/mechanic/me/{progression,promotion-history,certifications}`, `POST /api/mechanic/me/certifications`, `DELETE .../certifications/:id`, `GET /api/admin/{certifications,promotions/pending}`, `PATCH /api/admin/certifications/:id`, `POST /api/admin/mechanics/:id/promote` | `routes/progression.ts` |
| Growth | `GET /api/admin/growth/{overview,referrals,regions,balance,cpa,engagement,amplification,trends,topics,content,settings,library}`, `POST /api/admin/growth/content/{generate,generate-batch}`, `GET/PATCH /api/admin/growth/content/:id`, `POST .../:id/{approve,reject,schedule,publish,engagement,iterate,publish-now,reuse}` | `routes/growth.ts` |
| Integrations/media | `GET /api/admin/growth/integrations`, `PUT/DELETE /api/admin/growth/integrations/:key`, `GET /api/media/files/:filename`, `GET /api/admin/growth/media/providers`, `POST /api/admin/growth/content/:id/media/{generate,generate-video}` | `routes/integrations.ts`, `media.ts` |
| Loyalty/public page | `GET /api/loyalty/{customer,mechanic}`, `POST /api/loyalty/{customer,mechanic}/redeem`, `GET /api/referral`, `GET /api/p/m/:code`, `GET /api/p/m/:code/{vcard,card.svg}` | `routes/loyalty.ts`, `referrals.ts`, `amplification.ts` |

Do not infer a flat `/commercial-service-requests` or flat `/vehicle-operations` family. `lib/api-spec/openapi.yaml` is the contract; compare with actual mounts when changing routes.

## 16. Environment and configuration ownership

These are **actual first-party code consumers**, not an invitation to copy `.env.example` verbatim. Never put secret values in this manual, client `EXPO_PUBLIC_*` variables, logs, build artifacts or screenshots. Deployment/platform-injected variables should not be minted as application secrets.

| Names | Required/conditional and consumers |
| --- | --- |
| `DATABASE_URL` | Required for DB-backed API and opt-in DB integration/migrations; `lib/db/src/index.ts` fails without it. Development and production are separate DBs. |
| `SESSION_SECRET` | Required in production (>=32 characters) for auth and credential-store encryption; development auth fallback is not production policy. Plan key rotation and encrypted-data continuity. |
| `PORT` | API `src/index.ts` requires positive value; Vite demo/mockup configs also require `PORT`. Mobile dev command uses it; mobile static server has its own default. |
| `NODE_ENV` | Development/production gates for auth and integration tests; API dev script sets development. Explicit `NODE_ENV=development` required by business migration, not a production recipe. |
| `BASE_PATH`, `METRO_PORT`, `APS_BASE_URL`, `LOG_LEVEL`, `MEDIA_STORAGE_DIR` | Build/serve/API origin/log/media configuration; `BASE_PATH` required by demo/mockup Vite config, mobile build defaults `/`; media defaults to process-local `storage/media`. Confirm `APS_BASE_URL` consumers before changing generated origin. |
| `APP_BASE_URL`, `PUBLIC_BASE_URL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, `REPLIT_DEPLOYMENT` | Public URL/link resolution and provider environment. Deployed host selection uses valid `REPLIT_DOMAINS`; development domain fallback is different. No deployed URL was verified. |
| `REPLIT_CONNECTORS_HOSTNAME`, `REPLIT_IDENTITY`, `WEB_REPL_RENEWAL` | Server-side managed Stripe connector authentication; `REPLIT_DEPLOYMENT` selects provider mode. **No direct `STRIPE_SECRET_KEY` read in current Stripe client.** |
| `STRIPE_WEBHOOK_SECRET` | Server webhook signature verification; missing/invalid fails closed. Historical running process reported missing accepted signing secret; whether fixed now is unknown. |
| `ADMIN_SETUP_KEY` | Sensitive admin bootstrap endpoint; restrict handling and disable/revoke as policy requires. |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` | Server integration wrappers; optional feature-specific provider configuration. |
| `PARTSTECH_API_KEY`, `PARTSTECH_SHOP_ID` | **Read by old `partsProviders` adapter** but still a stub; credentials do not enable live ordering. |
| `APP_STORE_URL`, `PLAY_STORE_URL` | Optional amplification/marketing links; not proof of store publication. |
| `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_REPL_ID`, `REPLIT_EXPO_DEV_DOMAIN`, `EXPO_PACKAGER_PROXY_URL`, `REACT_NATIVE_PACKAGER_HOSTNAME`, `REPL_ID`, `REPLIT_INTERNAL_APP_DOMAIN` | Mobile public/dev host/build injection and Replit platform context; anything `EXPO_PUBLIC_*` is bundled/disclosed, never secret. |
| `RUN_BUSINESS_ACCOUNT_INTEGRATION`, `RUN_BUSINESS_CONNECT_INTEGRATION`, `RUN_PARTNER_ORG_INTEGRATION`, `RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION`, `RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION`, `RUN_PARTNER_COMMERCIAL_INTEGRATION`, `RUN_PART6_BAYS_INTEGRATION`, `RUN_SHOP_GHOST_INTEGRATION` | Opt-in test-only DB suite flags; require nonproduction `NODE_ENV` and `DATABASE_URL`. Do not toggle against production. |

`.env.example` contains illustrative/legacy self-hosted `STRIPE_SECRET_KEY`, Resend/Twilio names, not evidence of current app reads of those names; use actual code consumers above. Reconcile any newly added integrations by searching `process.env`/`EXPO_PUBLIC_` at change time. EAS profiles contain placeholder domain and TODO iOS submit IDs; `app.json` lacks verified EAS project ID. Neither establishes a real production address or signed app. Secure production secret scope and Stripe webhook endpoint subscriptions must be inspected by authorized operators without exposing values.

## 17. Dependencies and security

Current manifests declare React **19.1.0**, React Native **0.81.5**, Expo **~54.0.35**, Expo Router **~6.0.24**, Express **^5**, Drizzle **^0.45.2**, Zod **3.25.76**, TypeScript **~5.9.2**, Stripe **^22.1.0** plus managed `stripe-replit-sync ^1.0.0`, Orval 8.22 (historical codegen remediation), pnpm catalog/lockfile. Manifest ranges are not installed-runtime attestations; consult lockfile for resolutions and inspect package/build provenance before upgrade. The old Metro warning recommended Expo ~54.0.37 and expo-constants ~18.0.14 versus its installed versions; it is historical, not a new build failure.

**Compatibility debt:** generated API validation deliberately retains Zod 3 generation, while some Drizzle schema modules import the `zod/v4` subpath provided by the installed package. Do not globally change imports or regenerate with different defaults without validating both layers and existing barrel aliases.

**Historical final dependency scanner:** **6 residual findings** (0 critical, 4 high, 1 moderate, 1 low), **not a scan run for this handoff**. Baseline was 102. Locked residual versions: `image-size@1.2.1` JXL/HEIF high and ICNS high (two findings); `uuid@3.4.0` high and `uuid@7.0.3` high (two); `decode-uri-component@0.2.2` moderate (fix 0.5.0 noted historically); `esbuild@0.27.3` low (fix 0.28.1 noted historically). Parent compatibility/Expo/Metro chains constrain blind overrides. Confirm fresh advisories and actual use context before remediation; do not describe the historical result as a current new scan.

**Historical scanners:** original SAST reported two HIGH static-serving traversal findings; source canonicalization/decoding/containment and focused tests addressed them, but **final SAST was rejected / `UNEXPECTED_DISCONNECT`** and never certified clean. Historical privacy scanner reported 0 findings both times; separate source review still found and fixed mechanic-private-profile/historical-contact exposure. Preserve distinction among scanner result, source hardening, and provider/device evidence.

**Implemented controls:** bearer auth plus DB role/status reload; strict business registration; server tenant predicates; static path canonical containment; signed webhook raw-body parsing and event ID dedup fail-closed on DB claim failure; server-priced payments and rate limits; scoped payout snapshots; redacted email errors; push token validation. **Residual risks:** webhook crash replay/capture side effects, nonrevocable JWT, AsyncStorage token, broad CORS, default express JSON cap not a custom policy, missing financial uniqueness/refund ledger, incomplete negative-case tests, external input/provider timeouts, secret-derived credential key rotation, local media durability and autoscale timers. No fresh penetration test or production security review occurred.

## 18. Known defects, gaps and historical audit reconciliation

The following table explicitly reconciles **every unresolved P0/P1/P2 row** of Part 7's priority table against later current source; priority is an engineering release-gate proposal, not proof of an incident. “Resolved” is restricted to the narrow source issue shown.

| Part 7 item | Current status and source/evidence distinction | Required proof / owner |
| --- | --- | --- |
| **P0 webhook signing secret/event subscriptions** | **Needs Verification:** prior running process `missing_signing_secret`, 16 matching endpoints and missing dispute/transfer/payout families; no live config inspected now. Raw-body/signature source present. | Payment ops: authorized secret-scope check; existing endpoint event subscriptions; signed test event + duplicate evidence. |
| **P0 webhook claim-before-effects crash** | **Incomplete:** claim commits separately from effects; old source issue still current. | Payment engineer: transactional inbox/outbox/replay design; injected crash/concurrent signed delivery tests. |
| **P0 capture-before-downstream-effects** | **Incomplete:** captured state can block replay of loyalty/referral/progression and job effects. | Payment engineer: durable effect checkpoints/replay; each failure boundary exercised. |
| **P0 duplicate tip HTTP checkout** | **Incomplete:** row insertion precedes tip-ID idempotency key; event ordering fix does not solve requests. | Payment engineer: client request key or locked pending reuse; concurrent identical requests one tip/session. |
| **P0 shop Connect owner/shop mismatch** | **Resolved in current canonical source:** organization Connect account, exact ready org destination and explicit-ID shims. **Needs Verification** live provider and ambiguous legacy repairs; no auto-backfill. | Business/payments: account ownership acceptance; mocked tests exist; provider-safe readiness/onboard/settlement and legacy case review. |
| **P0 refund ledger and partial refund** | **Incomplete:** full refund/idempotency exists; amount/provider-refund identity/reconciliation absent. | Finance/payments: agreed schema/backfill; full/partial/repeated/delayed/provider-initiated cases. |
| **P0 provider payment identifier uniqueness** | **Incomplete:** app rejects ambiguous canonical rows; DB `payments.job_id`/provider partial uniques absent. | DB/payments: duplicate survey, migration, concurrency/retry proof without rewriting history. |
| **P1 final SAST** | **Needs Verification:** targeted path tests pass historically, final scanner rejected; not “clean scan.” | Security: successful same-tool final result plus path negative suite. |
| **P1 Ghost owner/lift repeat** | **Needs Verification**, historical fixture/context blockage; correct 403 is not a defect. | QA: fresh authorized assigned mechanic/shop/bay full lift sequence on safe fixtures. |
| **P1 native mobile release** | **Needs Verification:** previous static build timed out near Metro iOS completion; no signed device run. Timeout is not a fresh failure here. | Mobile: reproducible build, EAS IDs/domain finalized, signed iOS+Android physical device journeys. |
| **P1 external provider readiness** | **Needs Verification/Partially Implemented:** Stripe settlement, Resend, push, AI, media durability, VIN, supplier live order distinct; PartsTech still stub. | Integration owners: feature-specific safe provider/dev evidence, receipts, timeouts, durable assets; no blanket “integrations pass.” |
| **P2 relational constraints/index drift** | **Incomplete** source guardrails; historical source/live drift **Needs Verification** live read-only schema diff. | DB: approved schema comparison/backfill/constraints and explicit prod migration plan. |
| **P2 AI/email/VIN/media hardening** | **Partially Implemented:** AI gates, email redaction, VIN validation, file containment; no explicit email/VIN timeouts, durable assets or AI limit/retention closure. | Security/platform: policy, bounded requests, storage and tests. |
| **P2 broad route/negative coverage** | **Needs Verification:** focused regression evidence only; admin/growth, inspections, messages and disputes not broad E2E. | QA/security: signed-in positive/negative matrix per role and cross-tenant child resource. |

**Additional Part 7 items corrected by subsequent source:** 87 rather than 86 frontend TSX, eight rather than seven migration scripts; business signup now atomic and selected org validated; org-owned company Connect replaces user/shop mismatch; transfer metadata + immutable snapshot now enables **conditional explicit linkage** (old “no reliable back-link” blanket statement stale), yet automatic Stripe transfer metadata and payout failure status are **not proven**; canonical-row retry implemented **at app level**, not DB uniqueness. Tip/dispute event-order handling, overnight continuation, admin/mechanic `/api` prefixes, card style flatten, private profile/history contacts, payout-event insert failure propagation, Resend header and APS non-live flag were resolved in the historical hardening scope. Do not reopen these as unfixed based solely on the stale audit.

**Newly explicit current-source gaps:** customer vehicle edit UI **Incomplete**; OBD hardware **Incomplete**; in-app notification center **Incomplete**; business staff/membership and subscriptions **not implemented**, not approved roadmap; parts caller-supplied SKU/price is unsafe for live ordering; payout failure does not reconcile payment status; `partsProviders` and `suppliers` parallel layers create adapter drift. These are not equivalent to a failed runtime test. The old Ghost repeat was a fixture mismatch, not an app bug; current mechanic dashboard pending-user 403s are documented for diagnosis, not automatically a regression verdict.

### Planned versus merely missing

| Item | Status | Evidence and limit |
| --- | --- | --- |
| Signed native/store release | **Planned** | `artifacts/mobile/STORE_RELEASE.md`, `eas.json` profiles and TODO submission identifiers document the intended release process. No completed signing/store submission is certified. |
| Real supplier adapter implementation | **Planned** | Explicit PartsTech stub/adapter interfaces provide an extension point, not active ordering or an approved delivery date. Server-controlled offer authority must precede activation. |
| Actual video-generation provider | **Planned** | `lib/mediaProviders/videoStub.ts` marks unfinished provider behavior; an endpoint and media type are not generated-video capability. |
| Durable media storage | **Planned remediation** | Prior audit recommends replacing local media bytes with durable storage; not an implemented integration or committed vendor rollout. |
| Recurring billing, staff invitations/membership, live hardware OBD, notification inbox and general calendar | **Incomplete / not committed** | No corresponding completed capability is established in the inspected paths. Their absence does not make them an approved product roadmap. Obtain product scope first. |

**Technical-debt ownership:** financial replay and canonical-row invariants belong to payments/DB engineering; process timers, backups and local media to platform; duplicate VIN/parts adapters and provider credential contracts to integrations; generated-client compatibility, AsyncStorage and native build configuration to mobile/API owners. The repository contains no verified RPO/RTO, restore rehearsal or complete operational on-call/alerting runbook. Treat those as **Needs Verification**, not assurances supplied by hosting.

## 19. Non-executing deployment and recovery runbook

**This is a checklist, not commands executed or approval to publish.** Replit documentation for development/production data separation and troubleshooting: [Development and Production](https://docs.replit.com/features/data-and-storage/development-and-production), [Build troubleshooting](https://docs.replit.com/build/troubleshooting). Confirm workspace's actual deployment settings and responsible owner; no production URL, live deployment state or production DB was queried.

1. **Authorize scope first.** Obtain named owner approval, release classification, rollback owner and maintenance window. Current recorded readiness is NOT READY; do not publish simply because a build passes.
2. **Inventory environment by name only.** Verify scoped `DATABASE_URL`, `SESSION_SECRET` key continuity, managed connector identity, `STRIPE_WEBHOOK_SECRET` accepted by intended running environment, public URL/host, port/base path and feature-specific credentials; never print values. Confirm intended dev vs production Stripe account and existing webhook endpoint; avoid duplicate endpoints.
3. **Review DB separation.** Replit Publish uses a development→production **schema diff** with a **separate production DB**; inspect/approve suggested changes and existing production data/backfill behavior. Do **not** run handwritten development-only migrations, `drizzle-kit push` or fixture cleanup against production. Preserve rollback/backup and reconcile schema/index drift.
4. **Choose durable state before autoscale.** Local files on published instances are not persistent; media/assets need DB or Replit App Storage/durable object storage. Move timer-dependent financial/approval/growth work to durable scheduling/worker semantics with lease/replay/idempotency evidence before release.
5. **Gate financial rollout.** Resolve §18 P0s; test signed webhook and duplicate/crash replay, Connect destination/legacy mapping, payment/refund/dispute/tip consistency, reconciliation, provider event subscriptions and payout failures in approved test mode. Do not use production charges for initial proof.
6. **Build and validate in authorized environment.** Confirm pnpm lockfile/frozen install strategy, typechecks, opt-in DB tests only on disposable development DB, generated OpenAPI outputs, mobile/static build manifests and native signing. `.replit`/EAS placeholders are not production targets.
7. **Publish only after sign-off.** Record approved schema diff, artifact hashes, endpoint/domain, key scopes (not values), probe outcomes and rollback decision. Publishing changes production DB/runtime context; explicitly check production-only assumptions after deployment with safe read-only/signed test-mode checks as policy allows.
8. **Respond to incident.** Suspend mutations or feature flag payment acceptance as approved; preserve webhook IDs, account snapshot and immutable evidence; reconcile Stripe versus local ledger before replay/refund. A 200 dedup result is **not** proof business effects ran. Do not rotate `SESSION_SECRET` without decryptability plan. If published media is missing, recover from durable storage/backup, not from a prior instance's local filesystem.

**Current artifact production commands (configuration, not executions):**

| Artifact | Build / run | Configuration source |
| --- | --- | --- |
| API | Build: `pnpm --filter @workspace/api-server run build`; run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`; production environment sets `NODE_ENV=production`, port 8080; startup probe `/api/healthz`. | `artifacts/api-server/.replit-artifact/artifact.toml` |
| Mobile web bundle | Build: `pnpm --filter @workspace/mobile run build`; run: `pnpm --filter @workspace/mobile run serve`; configured port 18115 and base `/`. This serves the web/static artifact, **not** an App Store binary. | `artifacts/mobile/.replit-artifact/artifact.toml` |

Use the managed development workflows `artifacts/api-server: API Server` and `artifacts/mobile: expo` for local preview; do not deploy the API `dev` script, which explicitly sets development mode. Native distribution follows separately authorized EAS/store signing and provider configuration.

## 20. Tests, evidence and verification plan

**Historical only, not executed here:** later correction records **46/46 API unit/route cases (includes 10 Connect)**, **16/16 partner/commercial/bay integration**, **4/4 business-registration integration**, **1/1 mocked-Connect development-DB integration** (no Stripe calls), mobile business-account static script PASS, **5/5 real-UI signup choices** plus business login/session/reload checks, and root typecheck PASS. These suites overlap; **do not sum the 10 Connect into 46 or sum historical tests into one “all app tests” number**. Earlier Part 7 reported API 30, DB 16, mobile scripts 6/6, typechecks, one customer→mechanic browser journey, with no live charge, and a static mobile build timeout. The 30 and 46 are different historical snapshots, not competing current test runs. Neither historical fixture counts nor cleanup IDs belong in a production test plan.

**Recommended commands only — no command below was run in this handoff:**

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/mobile run typecheck
pnpm --filter @workspace/mobile run test:business-account-ui
pnpm --filter @workspace/mobile run test:part7-security
pnpm --filter @workspace/mobile run test:ghost-garage-ui
# Optional build validation after supplying reviewed PORT/BASE_PATH as required:
pnpm run build
# Only on an approved, disposable development DB; opt-in suite flag required:
NODE_ENV=development RUN_BUSINESS_ACCOUNT_INTEGRATION=1 pnpm --filter @workspace/api-server run test:business-accounts
NODE_ENV=development RUN_BUSINESS_CONNECT_INTEGRATION=1 pnpm --filter @workspace/api-server run test:business-connect-integration
```

For other DB suites use their **matching** `RUN_PARTNER_ORG_INTEGRATION`, `RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION`, `RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION`, `RUN_PARTNER_COMMERCIAL_INTEGRATION`, `RUN_PART6_BAYS_INTEGRATION` or `RUN_SHOP_GHOST_INTEGRATION` flag and package script; all additionally require nonproduction `NODE_ENV` and `DATABASE_URL`. Unit `test:business-connect` does not establish real provider delivery. `pnpm run build` requires appropriate `PORT`/`BASE_PATH` for certain artifacts; mobile build previously timed out, so use a properly timed authorized harness and preserve separate manifest/native evidence. Do not treat a historical timeout or root configuration error as a new code regression. No live DB/provider/network verification is required to read this manual.

**Evidence ladder:** source inventory → typecheck/unit/static script → scoped nonproduction DB integration → connected browser journey → signed provider test-mode event/duplicate/crash replay → signed native physical-device test → authorized production smoke/reconciliation. Report each tier separately. Accessibility historical browser evidence was limited to selected-org keyboard traversal/navigation; VoiceOver/TalkBack, camera, OBD, GPS and push receipt need actual device evaluation. Rerun final SAST successfully; record current dependency scan separately from the six historical locked findings. Keep secret values and private test fixture identities out of results.

## 21. Priorities, acceptance criteria and first week

| Priority / workstream | Acceptance evidence before changing readiness |
| --- | --- |
| **P0 finance: webhook + capture durability** | Replayable inbox/outbox or equivalent transactional checkpoints; crash injected after claim and each capture effect; concurrent duplicates produce one complete financial outcome; signed test-mode delivery and reconciliation. |
| **P0 finance: refund/tip/DB guardrails** | Reviewed refund ledger with partial/full/repeated/provider-initiated policy; client tip idempotency with concurrent one-session proof; DB canonical job/provider uniqueness after safe backfill; matching statements and audit trail. |
| **P0 Connect/settlement** | Organization vs mechanic vs verified unlinked legacy identity matrix; immutable checkout snapshot; provider-confirmed transfer/payment attribution; failure/reversal payment-state reconciliation and human resolution of ambiguous legacy rows. |
| **P0 parts if real fulfillment proposed** | No live adapter enabled before server-verified supplier offer/SKU/price snapshot, expiration/reprice rules and blocked forged-price/SKU tests. Until then explicitly label APS reference synthetic. |
| **P1 security/mobile/providers** | Successful SAST artifact; role/tenant negative matrix; reproducible mobile static and signed native builds; physical-device auth/photo/push/deep-link checks; provider-safe deliverability and durable media. |
| **P1 operations** | Autoscale-safe durable worker/leases and missed/duplicate timer replay tests; dev/prod schema diff and backup/rollback rehearsal. |
| **P2 product/tech debt** | Vehicle edit, notification feed, hardware OBD only after explicit product scope; resolve duplicate parts adapter ownership, AI/VIN/email bounds and generated/client contract drift. |

**First-week takeover sequence (non-executing until approved):**

- Day 1: record repository commit/branch, named service owners, actual product acceptance and explicit NOT READY status; inspect `.replit`, artifact paths, system boundaries and evidence index. Do not publish or run scripts.
- Day 2: map real development versus production DB/schema and managed Stripe connector/webhook endpoint **read-only with authorized access**; establish backup, secret scope and key-rotation owner without disclosing values.
- Day 3: reproduce P0 payment state/inbox/side-effect hazards in unit/nonproduction fixtures; agree canonical row/provider-attempt, refund, payout failure and legacy mapping contracts with finance.
- Day 4: sequence migrations and delivery hardening, verify source/API-client drift; assign durable scheduler, media storage and supplier offer-authority owners. Do not enable live supplier ordering.
- Day 5: run approved focused tests/scanners and scoped browser/native/provider test plans with named evidence owners; publish a new readiness decision **only** after acceptance artifacts, not because this manual exists.

## 22. Source index and open product decisions

**Primary evidence (relative links):**

- [Part 7 application audit](docs/partner-layer-part7-audit.md): historical readiness, findings, browser/test chronology; its 86-screen/seven-script and shop Connect assertions are superseded where noted.
- [Business identity correction](docs/business-account-identity-correction.md), [business Connect contract](docs/business-connect-contract.md), [business account contract](docs/business-account-contract.md): current atomic signup, canonical organization/account design, historical focused test evidence.
- [Part 7 payment/integrations](docs/audit/part7-payment-integrations.md), [database](docs/audit/part7-database.md), [security/backend](docs/audit/part7-security-backend.md), [frontend](docs/audit/part7-frontend.md), [browser regression](docs/audit/part7-browser-regression.md), [dependency findings](docs/audit/part7-security-scanners-final.json): historical deeper details, never silently elevated to new production evidence.
- [Business browser verification](docs/business-account-browser.md), [mobile correction](docs/business-account-mobile.md), [regression record](docs/audit/part7-regression.md), [mobile store guide](artifacts/mobile/STORE_RELEASE.md): durable supporting evidence and operating references. Current source paths cited throughout this manual are the starting points for reproducing the static findings; no temporary investigation files are required.
- [OpenAPI source](lib/api-spec/openapi.yaml), [API routes mount](artifacts/api-server/src/routes/index.ts), [Express startup](artifacts/api-server/src/app.ts), [DB schema](lib/db/src/schema/index.ts), [fee source](lib/tier-catalog/src/index.ts), [workspace versions](pnpm-workspace.yaml), [deployment config](.replit).

**Decisions the incoming CTO/product/finance owners must explicitly make:**

1. Is payment history a single canonical row with separate provider attempts? Current retry code says yes; database constraint and attempt/audit strategy still require approval.
2. What is the treatment of partial/multiple/direct provider refunds, dispute reserves, tip request retry and payout failure? Approve reconciled ledger and customer-facing semantics before beta.
3. Which legacy unlinked shops may retain Connect destinations, and who verifies historic no-snapshot payment mapping? Never infer ownership from first match.
4. What are organization administrator/staff/member roles beyond the single primary owner? **No staff membership/subscription capability is implemented**; do not promise or invent it as committed roadmap.
5. Will live supplier purchase, vehicle edit, OBD hardware, notification feed and native release be funded/scoped? Existing catalog/local OBD lookup are different deliverables.
6. Which approved durable queue/scheduler, object storage, KMS/key rotation, provider retention policy and public URL/deployment owner will replace current local/process assumptions?

**Takeover rule:** source, historical tests, current deployment and intended product policy are four different things. Reconcile all four with explicit evidence before changing the NOT READY decision.