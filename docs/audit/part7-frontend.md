# Part 7 frontend inventory and API-usage audit

**Checked:** 2026-09-13 (UTC)  
**Scope:** `artifacts/mobile/app`, the mobile route layouts and guards, direct
API callers, generated-client usage, and the existing fixture/script/browser
evidence. This is a coverage inventory, not a claim that every screen has
passed a device or browser acceptance test.

## Coverage legend and limits

The route matrix uses the following status:

* **browser-tested** — an existing Part 7 browser record exercised that route
  with real app navigation and scoped fixture data.
* **fixture/script-tested** — an existing deterministic script or fixture
  integration check covers a route contract. Most of these are source-contract
  checks rather than rendered-screen tests.
* **static-only** — the route and its static wiring/API call sites are in the
  inventory, but there is no route-specific runtime evidence in the records
  reviewed here.
* **untested** — no route-specific static assertion or runtime evidence was
  found. A route marked untested is still listed in the static inventory; the
  label prevents the inventory from being mistaken for behavioral coverage.

The inventory contains **86 TSX files**: **77 screen files**, **8 layouts**, and
the not-found screen. Route groups in Expo Router are omitted from the URL:
`(customer)/index` is `/`, `(mechanic)/available` is `/available`, and so on.
The existing browser records were not rerun for this inventory. Native device,
push, camera, location, Stripe-hosted checkout, and physical iOS/Android
behavior remain uncertified.

## Executive findings

1. Two direct `customFetch` caller families were missing the generated client's
   `/api` prefix. The generated client's base URL is the origin, so the calls
   would otherwise target origin-root paths and 404. The admin certification
   calls now use `/api/admin/...`; mechanic progression calls now use
   `/api/mechanic/...`.
2. The admin user screen already supported the `advanced` tier in the
   progression concept but skipped it in `TIER_ORDER`. The order now explicitly
   reads `detailer → technician → senior → advanced → master`. No tier
   threshold, fee, commission, or percentage was changed.
3. Generated hooks were not replaced with ad hoc fetches. The targeted screens
   continue to use generated hooks where available; direct calls were checked
   for an explicit `/api` prefix. `getApiUrl()` callers continue to pass
   API-relative paths because that helper adds `/api`.
4. The static server now canonicalizes and bounds decoded paths with
   `path.resolve`/`path.relative`, rejects malformed encoding/NUL bytes, and
   keeps manifest platforms allowlisted by the request handler. Regression
   coverage includes plain and encoded traversal, sibling-prefix containment,
   invalid manifest platforms, and valid iOS/Android manifests.
5. This audit did not change money amounts, fee/commission policies, dispatch
   rules, or tier percentages.
6. The sole browser tester confirmed a customer `/vehicles` web blocker after
   a valid Add Vehicle submission. The post-mutation vehicle card used
   `Link asChild` with an RN style array; Expo Router/React Native Web passed
   that array to the anchor and the ErrorBoundary reported
   `CSSStyleDeclaration indexed property[0] setter unsupported`. The narrow
   fix flattens the child style in both `VehicleCard` and the equivalent
   `JobCard` pattern. No created row was erased; persistence of the reported
   customer vehicle remains unverified until the same tester retests.

## Route inventory

### Authentication

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `(auth)/login.tsx` — `/login` | Login, token/session bootstrap, role destination | static-only |
| `(auth)/register.tsx` — `/register` | Account registration and role selection, including `shop_owner` | fixture/script-tested |
| `(auth)/forgot-password.tsx` — `/forgot-password` | Password-reset request and privacy-safe response classification | static-only |

The auth stack is intentionally not a role tab. The root guard redirects an
unauthenticated user into `/login`, while an authenticated user in the auth
group is sent to the destination returned by `getRoleDestination`.

### Customer tabs and customer entry points

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `(customer)/index.tsx` — `/` | Customer dashboard and service entry points | static-only |
| `(customer)/jobs.tsx` — `/jobs` | Customer job list | static-only |
| `(customer)/profile.tsx` — `/profile` | Customer profile/settings | static-only |
| `(customer)/vehicles.tsx` — `/vehicles` | Customer vehicle list | browser-tested (blocker fixed; persistence unverified) |
| `request-service.tsx` — `/request-service` | Create a service request/job from a vehicle and service selection | static-only |
| `detailing.tsx` — `/detailing` | Detailing package/job creation and location lookup | static-only |
| `loyalty.tsx` — `/loyalty` | Loyalty balance/activity | static-only |
| `referral.tsx` — `/referral` | Referral entry and status | static-only |
| `review/[jobId].tsx` — `/review/:jobId` | Customer review submission | static-only |

The customer tab layout redirects missing users to auth and non-customers to
their role destination. The root stack registers the shared modal/card routes;
it does not grant access independently of the auth/role guards.

#### Confirmed customer vehicle browser blocker

The sole tester exercised the real customer `264` at `/vehicles` and submitted
the following valid form values:

* VIN `3P7CUST2641234567`
* year `2021`, make `Honda`, model `Civic`, trim `EX`
* plate `P7CUST`, mileage `18000`, color `Red`

After the Add Vehicle mutation, the target list render entered the ErrorBoundary
with:

```text
CSSStyleDeclaration indexed property[0] setter unsupported in <a>
```

The confirmed route-specific cause was `VehicleCard`'s
`<Link asChild><Pressable style={[...]}></Pressable>` shape. On web, Expo
Router's Link uses an anchor/slot path; the RN style array could reach the DOM
anchor's `style` assignment. `JobCard` had the same equivalent Link/Pressable
style pattern and is fixed in the same narrow change. Both cards now pass
`StyleSheet.flatten([...])` to the Pressable, preserving Link navigation and
native behavior while giving React Native Web a single style object.

The tester did not verify persistence after the ErrorBoundary, and no row was
deleted or cleaned up by this pass. The owning agent should restart the
existing app process as needed and resume the same tester for a post-fix
submission/list/reload check; this subtask did not use the browser tester.

### Mechanic tabs, work, and progression

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `(mechanic)/index.tsx` — `/` in mechanic group | Mechanic dashboard | static-only |
| `(mechanic)/available.tsx` — `/available` | Available-job discovery and acceptance | browser-tested |
| `(mechanic)/active.tsx` — `/active` | Active jobs and status progression | static-only |
| `(mechanic)/history.tsx` — `/history` | Mechanic job history | static-only |
| `(mechanic)/profile.tsx` — `/profile` | Mechanic profile | static-only |
| `(mechanic)/progression.tsx` — `/progression` | Tier metrics, certifications, promotion history | fixture/script-tested |
| `(mechanic)/amplification.tsx` — `/amplification` | Mechanic amplification/growth surface | static-only |
| `mechanics.tsx` — `/mechanics` | Mechanic directory/discovery | untested |
| `mechanic/[id].tsx` — `/mechanic/:id` | Mechanic profile/detail | untested |
| `mechanic/earnings.tsx` — `/mechanic/earnings` | Earnings summary | static-only |
| `mechanic/payouts/index.tsx` — `/mechanic/payouts` | Payout summary/history | static-only |
| `mechanic/payouts/[jobId].tsx` — `/mechanic/payouts/:jobId` | Job-level payout detail | untested |
| `mechanic/parts/[jobId].tsx` — `/mechanic/parts/:jobId` | Mechanic parts workflow | untested |
| `mechanic/vin.tsx` — `/mechanic/vin` | VIN lookup entry | untested |
| `mechanic/workspace/[vin].tsx` — `/mechanic/workspace/:vin` | VIN workspace | untested |

The mechanic tab layout requires `user.role === "mechanic"` and redirects
other roles. `progression.tsx` uses explicit `/api/mechanic/me/...` paths for
its three reads and certification deletion/upload calls. The added static
regression checks all direct calls in this screen for the prefix.

### Admin tabs and growth

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `(admin)/index.tsx` — `/` in admin group | Admin dashboard | static-only |
| `(admin)/users.tsx` — `/users` | User search/status/tier actions | fixture/script-tested |
| `(admin)/payments.tsx` — `/payments` | Payment-state and payout administration | static-only |
| `(admin)/jobs.tsx` — `/jobs` | All-job administration | static-only |
| `(admin)/flags.tsx` — `/flags` | Reports/flags | static-only |
| `(admin)/trust.tsx` — `/trust` | Trust and safety controls | static-only |
| `(admin)/certifications.tsx` — `/certifications` | Certification review and promotion queue | fixture/script-tested |
| `(admin)/disputes.tsx` — `/disputes` | Dispute administration | untested |
| `(admin)/finance.tsx` — `/finance` | Finance summaries | static-only |
| `(admin)/growth/index.tsx` — `/growth` | Growth dashboard | untested |
| `(admin)/growth/queue.tsx` — `/growth/queue` | Growth content/action queue | untested |
| `(admin)/growth/library.tsx` — `/growth/library` | Growth content library | untested |
| `(admin)/growth/content/[id].tsx` — `/growth/content/:id` | Growth content detail/edit | untested |
| `(admin)/growth/referrals.tsx` — `/growth/referrals` | Referral growth metrics | untested |
| `(admin)/growth/cpa.tsx` — `/growth/cpa` | Acquisition/CPA metrics | untested |
| `(admin)/growth/trends.tsx` — `/growth/trends` | Growth trends | untested |
| `(admin)/growth/regions.tsx` — `/growth/regions` | Growth regions | untested |
| `(admin)/growth/integrations.tsx` — `/growth/integrations` | Growth integrations | untested |
| `(admin)/growth/amplification.tsx` — `/growth/amplification` | Amplification controls | untested |
| `(admin)/growth/admin-controls.tsx` — `/growth/admin-controls` | Growth administration controls | untested |

The admin layout requires `user.role === "admin"` and redirects to the
authenticated user's role destination otherwise. The certification screen
uses `/api/admin/certifications`, `/api/admin/promotions/pending`, and
`/api/admin/mechanics/:id/promote`; review mutations also use
`/api/admin/...`. The user screen uses `getApiUrl("/users...")`, which is a
different, correct helper contract.

### Shop-owner and partner workflows

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `(shop-owner)/index.tsx` — `/` in shop-owner group | Locations/partner dashboard | fixture/script-tested |
| `(shop-owner)/vehicles.tsx` — `/vehicles` | Shop-owner vehicles | static-only |
| `(shop-owner)/post-job.tsx` — `/post-job` | Post a job | static-only |
| `(shop-owner)/invoices.tsx` — `/invoices` | Invoices | static-only |
| `(shop-owner)/bookings.tsx` — `/bookings` | Ghost Garage bay booking approvals/rejections | fixture/script-tested |
| `(shop-owner)/profile.tsx` — `/profile` | Shop-owner profile/partner identity | fixture/script-tested |
| `(shop-owner)/organizations.tsx` — `/organizations` | Organization selection and location linking | fixture/script-tested; browser-tested |
| `(shop-owner)/partner-vehicles.tsx` — `/partner-vehicles` | Organization-scoped vehicle operations | fixture/script-tested |
| `(shop-owner)/service-requests/index.tsx` — `/service-requests` | Organization-scoped request list/filter | fixture/script-tested; browser-tested |
| `(shop-owner)/service-requests/new.tsx` — `/service-requests/new` | Create a partner service request | fixture/script-tested |
| `(shop-owner)/service-requests/[id].tsx` — `/service-requests/:id` | Scoped request detail/status transitions | fixture/script-tested; browser-tested |

The parent and nested service-request layouts are included in the guard table
below. Partner scripts cover organization context keys, status transitions,
vehicle capability rules, and source-level route contract assertions. Existing
browser records cover organization switching, retained detail routes,
deep-links, reload/back/forward, and no-exposure behavior for unrelated
organizations.

### Shared job, payment, dispatch, and workbench routes

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `job/[id].tsx` — `/job/:id` | Job detail, status, authorization visibility, bay/lift state | fixture/script-tested; browser-tested |
| `job/[id]/approve.tsx` — `/job/:id/approve` | Owner approval/decline | fixture/script-tested; browser-tested |
| `job/[id]/confirm-work.tsx` — `/job/:id/confirm-work` | Customer work confirmation | untested |
| `job/[id]/invoice.tsx` — `/job/:id/invoice` | Job invoice | untested |
| `job/[id]/tip.tsx` — `/job/:id/tip` | Hosted tip checkout entry | static-only |
| `bays/[jobId].tsx` — `/bays/:jobId` | Bay selection/scheduling | fixture/script-tested |
| `shop/[id].tsx` — `/shop/:id` | Shop detail, bay/availability editor | fixture/script-tested; browser-tested |
| `worklog/[jobId].tsx` — `/worklog/:jobId` | Mechanic work log and booking status | fixture/script-tested |
| `tracker/[jobId].tsx` — `/tracker/:jobId` | Job tracking | untested |
| `transport/[jobId].tsx` — `/transport/:jobId` | Transport/location workflow | fixture/script-tested |
| `transfer/[vehicleId].tsx` — `/transfer/:vehicleId` | Vehicle transfer | untested |
| `inspection/[jobId].tsx` — `/inspection/:jobId` | Inspection capture/review | untested |
| `workbench/[jobId].tsx` — `/workbench/:jobId` | Vehicle/job workbench | static-only |
| `messages/[jobId].tsx` — `/messages/:jobId` | Job messaging | untested |
| `vehicle/[id].tsx` — `/vehicle/:id` | Vehicle detail | untested |
| `history/[vehicleId].tsx` — `/history/:vehicleId` | Vehicle history | untested |
| `parts/[vehicleId].tsx` — `/parts/:vehicleId` | Vehicle parts | untested |
| `obd2/[vehicleId].tsx` — `/obd2/:vehicleId` | OBD-II/diagnostic workflow | untested |
| `profile/[id].tsx` — `/profile/:id` | Public/profile detail | untested |

`job/[id].tsx` uses the generated checkout/tip contracts and only exposes
authorization based on server-returned job state and customer-of-record
ownership. It does not locally mark payment captured. The existing payment
audit covers the hosted checkout boundary and the commercial
`shop_owner` customer-of-record visibility fix; it does not claim a live
Stripe or device result.

### Shared and fallback routes

| Route file / URL | Primary responsibility | Status |
| --- | --- | --- |
| `+not-found.tsx` — unmatched routes | Not-found rendering | static-only |

The root stack also registers shared modal/card routes explicitly:
`shop/:id`, `bays/:jobId`, `inspection/:jobId`, `vehicle/:id`, `job/:id`,
`request-service`, `transfer/:vehicleId`, `history/:vehicleId`,
`worklog/:jobId`, `workbench/:jobId`, `parts/:vehicleId`, `tracker/:jobId`,
`transport/:jobId`, `obd2/:vehicleId`, `messages/:jobId`, `referral`, and
`detailing`. Registration is static evidence only; it is not a behavioral test.

## Guard and deep-link inventory

| Guard/layout | Static behavior | Runtime evidence |
| --- | --- | --- |
| `app/_layout.tsx` | Validates API configuration before mounting the app; root auth guard sends anonymous users to auth and authenticated auth-group users to `getRoleDestination`; wraps query/error/safe-area providers | fixture/script-tested for API configuration and role destinations; browser evidence covers authenticated deep-links |
| `app/(auth)/_layout.tsx` | Stack for login/register/forgot-password; no role claim | static-only |
| `app/(customer)/_layout.tsx` | Requires customer role; redirects missing/non-customer users | static-only |
| `app/(mechanic)/_layout.tsx` | Requires mechanic role; native/classic tabs selected safely; redirects other roles | static-only |
| `app/(admin)/_layout.tsx` | Requires admin role; redirects other roles | static-only |
| `app/(shop-owner)/_layout.tsx` | Requires `shop_owner`; wraps screens in the selected-organization boundary | fixture/script-tested for partner context; browser-tested for organization isolation |
| `app/(admin)/growth/_layout.tsx` | Nested growth stack/tab boundary | untested |
| `app/(shop-owner)/service-requests/_layout.tsx` | Nested list/new/detail stack | fixture/script-tested |

Role destination tests cover `customer`, `mechanic`, `admin`, and
`shop_owner`, and reject display names such as `dealer`/`fleet` as login
roles. They do not certify native navigation animations or every direct
deep-link on a physical device.

## Frontend API contract review

### Generated client and direct calls

The root layout calls `setBaseUrl(apiConfig.origin)`. Generated operation URLs
already contain `/api`, so generated hooks remain the preferred path. A direct
`customFetch` call must include `/api` itself; otherwise it requests the
origin-root path.

The confirmed direct-call correction was limited to:

* `app/(admin)/certifications.tsx`
  * `/api/admin/certifications?status=pending`
  * `/api/admin/promotions/pending`
  * `/api/admin/mechanics/:id/promote`
  * `/api/admin/certifications/:id`
* `app/(mechanic)/progression.tsx`
  * `/api/mechanic/me/progression`
  * `/api/mechanic/me/certifications`
  * `/api/mechanic/me/promotion-history`
  * `/api/mechanic/me/certifications/:id`

The added `test:part7-security` script statically checks every literal direct
call in those two screens for the `/api/` prefix and checks the admin tier
order. It is a regression guard for the confirmed path-prefix defect, not a
replacement for an authenticated API/browser run.

### Payments, payouts, and pricing boundary

The frontend uses generated checkout/tip operations and opens the returned
hosted URL. It does not accept a client-provided total as authoritative and
does not locally transition a job to paid. The existing payment audit records
the commercial-principal visibility fix and the dynamic platform-fee label
correction. Neither this inventory nor the security fix changes a fee,
commission, payout, dispatch, or tier percentage.

### Partner context boundary

Partner list/detail/vehicle routes use the selected organization context and
the existing context-key/query invalidation helpers. The browser evidence
covered switching organizations while a stale detail URL was retained,
cross-organization deep-links, reload, back/forward, and absence of unrelated
vehicle/request data. The static scripts cover payload ownership and route
contract checks; they do not prove every server authorization branch.

## Static server security follow-up

The scanner findings in `docs/audit/part7-security-scanners.json` pointed to
filesystem reads in `artifacts/mobile/server/serve.js`. The manifest handler
currently dispatches only `ios` or `android` header values, which limits the
specific manifest data flow in normal requests, but relying on a string
prefix/path normalization check is brittle:

* `path.normalize` did not decode encoded traversal before checking.
* `startsWith(STATIC_ROOT)` is not a canonical containment test and can accept
  a sibling path sharing the same string prefix.
* A future caller of the manifest helper could pass an unallowlisted platform.

The targeted fix keeps the existing server behavior while making the boundary
explicit: decode once, reject malformed encoding and NUL bytes, resolve
canonically beneath `STATIC_ROOT`, and reject `..`/absolute relatives. The
request handler retains the iOS/Android allow-list, and `serveManifest` uses
the same containment helper as static files.

Focused coverage in
`artifacts/mobile/scripts/part7-security-regression.test.mjs` checks:

* plain, nested, encoded, mixed-case encoded, and encoded-slash traversal;
* a sibling-prefix path;
* NUL and malformed percent encoding;
* valid Android and iOS manifests;
* an invalid manifest platform returning no file contents; and
* an encoded traversal HTTP request returning `403`.

## Existing evidence and remaining gaps

| Evidence | Scope | Classification |
| --- | --- | --- |
| `scripts/phase2-regression.mjs` | API host validation, build/Metro helper behavior, role destinations, password-reset classification, push diagnostic redaction, transport static checks | fixture/script-tested |
| `scripts/ghost-garage-ui.test.mjs` | Bay booking/approval/lift/approval/worklog UI contracts and generated hooks | fixture/script-tested |
| Partner scripts | Partner identity, organization context, service-request transitions, vehicle capability/payload contracts | fixture/script-tested |
| `docs/audit/part7-initial-browser.md` | Scoped organization/request navigation, mechanic acceptance, owner approval, shop/bay editor | browser-tested |
| `docs/audit/part7-initial-payments-mobile.md` | Payment source audit and safe mobile/payment checks; no live charge/device claim | static/fixture evidence |
| `scripts/part7-security-regression.test.mjs` | Static-server path boundary, API-prefix/tier regressions, and Link style flattening for customer/job cards | fixture/script-tested |

Routes marked static-only or untested need authenticated route-level browser
coverage before being called certified. The customer vehicle blocker is a
confirmed fixed code path but remains uncertified until the tester verifies
persistence and reload. In particular, no evidence here certifies native
camera/inspection, OBD/location permissions, push delivery, messaging realtime
behavior, payout settlement, Stripe Checkout completion, or physical-device
back/forward/deep-link behavior.

## Commands for the owning agent

The main agent should run the focused and existing checks from the repository
root:

```text
pnpm --filter @workspace/mobile run test:part7-security
pnpm --filter @workspace/mobile run test:phase2
pnpm --filter @workspace/mobile run test:ghost-garage-ui
pnpm --filter @workspace/mobile run test:partner-vehicles
pnpm --filter @workspace/mobile run test:partner-service-requests
pnpm --filter @workspace/mobile run typecheck
git diff --check
```

These commands are intentionally listed for handoff; this subtask did not
launch or restart a workflow and did not run the browser tester.