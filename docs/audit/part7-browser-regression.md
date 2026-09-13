# Part 7 Broad Browser Regression

## Status

Completed for the connected customer → fresh mechanic journey and final fixture
cleanup. The independent owner Job 100 commercial/bay flow was only partially
reachable: the owner UI exposed the accepted job read-only, while the assigned
mechanic 262 credential remained unusable and was not retried. All tracked
synthetic fixtures were subsequently removed transactionally and baseline
counts were restored.

## Scoped customer fixture

- Customer: user 264, `p7-customer-1789261655733` (active customer)
- Vehicle intended for the customer UI: VIN `3P7CUST2641234567`, plate
  `P7CUST`, Honda Civic, 2021, mileage 18,000, trim EX, color Red
- Existing mechanic to use in a separate context: mechanic 262
- The vehicle's persistence after the prior failed UI submission is currently
  unknown. Do not create a duplicate VIN. Cleanup tracking must include any
  vehicle with this VIN if the prior submission committed server-side.

## Actual evidence before the fix/restart

The customer was authenticated in a separate browser context. On `/vehicles`,
the Add Vehicle form was opened and the above values were entered through the
real UI. The submit control was then clicked through the UI.

Expected: the form closes and the saved vehicle card appears.

Actual at that time: the app reset to `/` and showed:

- `Something went wrong`
- `Please reload the app to continue.`
- `Try Again`
- `Sign out & reload`

The browser console reported:

`TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration': Indexed property setter is not supported.`

The stack identified Expo Router/React DOM style application and an `<a>`
component. This was the VehicleCard/equivalent-job-card StyleSheet array bug
that was subsequently reported fixed with `StyleSheet.flatten`.

Evidence: `avnvm9` shows the fully populated form immediately before submit;
`wix7yk` shows the real customer form before submit.

## Resume attempt after reported fix

The old browser target had crashed. A fresh isolated customer page was
attempted using the retained scoped credentials; no new user was registered.
The first recovery page was blank at `/login`, and the browser worker then
disconnected while navigating to `/vehicles`.

The notebook was recreated and the retained customer login was retried through
the real API route:

`POST /api/auth/login`

Expected: HTTP 200 JSON containing customer 264's session.

Actual: HTTP 502 with an empty response body on two attempts, including a retry
after two seconds. No session token was obtained after the restart, so
`/vehicles` could not be reopened and VIN persistence could not be verified.
No duplicate vehicle was created and no core action was bypassed through API.

## Not executed because of the API blocker

The following broad-regression steps remain explicitly untested:

- verify/reload the original customer vehicle and edit it through customer UI
- ordinary customer APS service request
- mechanic 262 discovery, tier filters, and acceptance
- customer approval
- normal progress, vehicle workbench, worklog, and completion
- customer history, invoice, and payment-entry UI (no live charges)
- review/rating if available
- cancellation and ownership guards that fit this journey
- main-frontend feature inventory
- remaining partner/Ghost journeys

Previously passing approval-cache and two-organization switch scenarios were not
repeated. The bay overnight-window behavior is not treated as a defect; the
backend supports overnight hours and the continuation-day helper/editor hint
fix is not retested here because the API was unavailable.

## Cleanup tracking

Retain and track customer 264 and possible vehicle VIN
`3P7CUST2641234567` until server-side persistence is checked. Existing owner,
organization, mechanic, and Ghost/partner fixtures remain retained for the
next follow-up. No unrelated existing rows were changed.

## Resume after API/mobile restoration

The retained customer was reauthenticated through the real
`POST /api/auth/login` endpoint with HTTP 200 in a fresh isolated context. The
`/login` and initial `/vehicles` renders were blank for several seconds, but
after waiting for frontend hydration the customer UI rendered normally.

### Vehicle persistence and customer UI

- The original vehicle was present exactly once in the customer Vehicles UI:
  vehicle 245, `2021 Honda Civic`, VIN `3P7CUST2641234567`, plate `P7CUST`,
  18,000 miles, and 0 services (`hrws50`).
- Vehicle detail opened through the card and reload persisted the VIN, EX trim,
  Red color, and zero-service state (`l0z20p`, `o50zjx`).
- No Edit control or edit form is exposed on the customer vehicle list/detail
  UI. Vehicle edit is explicitly untested/unreachable through the requested
  customer UI; no API edit bypass was used.

### Ordinary customer request

The customer opened Request Service from vehicle 245, selected the catalog
service `Full Synthetic Oil Change`, and filled the ordinary description and
address through the UI. The first submit correctly surfaced
`Please select a vehicle.` because the vehicle card had not been explicitly
selected (the vehicle was displayed but its radio/card was unselected). After
selecting the vehicle card, the same UI submit succeeded.

Job 129 was created through the customer UI and settled at `/job/129` with:

- status `REQUESTED`
- type `MAINTENANCE`
- VIN `3P7CUST2641234567`
- address `901 Customer Way, Brooklyn, NY 11203`
- estimated price `$179.00`
- routine oil-change description

Evidence: `0y39n2`, `hao1lp`, `w3g2xh`, `m3x7xs`, `55aolq`, `by8s9f`.
No live charge or payment was performed.

### Current blocker: existing mechanic context

The previous mechanic browser context was lost when the original browser worker
crashed. Existing mechanic 262 was verified as active and technician-tier with
its original fixture email. The first retained password attempt returned HTTP
401. A guarded test-fixture-only credential recovery was attempted for mechanic
262 without changing role, status, tier, or operational data; the database
returned the updated hash row, but the public `/api/auth/login` endpoint still
returned HTTP 401. No mechanic UI or Available Jobs screen was opened, and no
new mechanic was created.

Consequently these remain untested in this resumed run:

- mechanic 262 discovery and tier filters
- mechanic acceptance of Job 129
- customer approval
- progress, workbench, worklog, and completion
- customer history, invoice, payment-entry UI, and review/rating
- journey-specific cancellation and ownership guards
- main-frontend inventory and remaining commercial/Ghost flows

Customer job 129 and vehicle 245 must remain in cleanup tracking. The mechanic
credential recovery attempt must also be reviewed/reset as part of final
fixture cleanup. Do not create another mechanic or duplicate VIN.

## Final connected journey (customer 264 → mechanic 292)

Customer 264 successfully reauthenticated through real auth. Vehicle 245 was
present exactly once with VIN `3P7CUST2641234567`. The customer created ordinary
Job 129 entirely through the UI after explicitly selecting the vehicle card
(the first submit correctly showed `Please select a vehicle.`). Job 129 was
created as a full synthetic oil-change request at `$179.00`.

Fresh mechanic 292 (`p7-reg-mech-*`, active technician) was created through
real registration/auth and used in a separate browser context:

- Available Jobs, tier filtering, and Work Down filtering rendered normally
  (`0msnt2`, `qspmb8`, `ap29dh`, `13p21h`).
- Job 129 was accepted through the UI, with the browser confirmation accepted
  (`czp6dt`).
- Customer approval succeeded (`g5z0ns`, `dvjxhy`).
- Active UI advanced the job through Start Driving and Arrived - Start Work.
  The mechanic list was briefly stale after each confirmation, but independent
  customer reloads showed authoritative `EN_ROUTE` then `IN_PROGRESS`
  (`qam099`, `iov2d9`).
- The mechanic opened Workbench and the Work Notes gate, then opened the real
  work-log form (`anke2w`, `vl851z`, `22esxx`).
- A complete Maintenance work log was entered and submitted through the UI:
  service description, odometer 18,100, labor `$179.00`, 1.5 hours, symptoms,
  root cause, repair steps, monitoring, and customer notes; no itemized parts,
  payment, or live charge was used (`e2tm9t`).
- Submission marked Job 129 `COMPLETED` with estimated/final `$179.00`
  (`qszz40`). Customer reload independently confirmed the completed state
  (`zjhhvy`).

Customer-side completion checks:

- Invoice `APS-000129` opened through `View Invoice`; it was `held`, contained
  one Labor line for `$179.00`, and had no payment-entry/charge control
  (`sxf1pn`). `Pay & Authorize` was intentionally never clicked.
- Vehicle 245 Service History showed one VIN-linked completed Maintenance entry,
  the mechanic, `$179.00`, and the submitted work description (`65a7t4`).
- Customer submitted a review: “Professional routine service and clear
  communication.” (`1w2iuu`).
- Mechanic submitted a customer review: “Customer provided clear service
  details and a suitable work location.” (`4bopim`).

## Final owner/commercial/Ghost reachability

Owner 261 was reauthenticated in a separate context. Shop 217 and Bay 47
rendered through the owner UI as active, `$160.00/hr`, minimum senior tier,
repair/diagnostic, with four-post-lift/tire-machine/scan-tool equipment
(`zigi90`). Organization 185 was selected once only to access its existing
request list; prior organization-switch/cache/accessibility scenarios were not
repeated.

Request 34 opened in the selected organization and showed `Submitted`,
`APS linked`, and linked APS Job 100 `ACCEPTED · In progress`, with no APS work
log (`a6kvk8`, `mhv4s1`). Owner Job 100 rendered as an accepted dealership
repair with the timeline through ACCEPTED, but no lift, transport, bay,
approve/reject, or other mutation controls were exposed (`luamvn`,
`m7i9gu`). The original assigned mechanic 262 credential remained unusable;
per the test constraint it was not retried or hash-surgeried again. Fresh
mechanic 292 could reach `/bays/100`, but only technician-eligible generic
lift listings were returned, with two 403 resource loads and no job-specific
booking control (`ochvqo`). Therefore the Job 100 lift/transport
approval/reject/cancel/rebook sequence is explicitly **not verified** in this
run. The visible repeated Lift City Garage entries are a minor UI/data
duplication concern, not treated as a core-flow failure.

## Transactional cleanup evidence

After testing, a single guarded transaction nulled the cyclic Request 34/35 ↔
Job 100/129 links, deleted dependent approvals, work logs, messages,
inspections, parts rows, transport legs, reviews/ledger rows, and then deleted
only the tracked roots: users 261/262/263/264/292, organizations 185/186,
shops 217/218, Bay 47, vehicles 217/218/245, operations 116/117, requests
34/35, and jobs 100/129. No live payment was created or deleted by amount/global
count.

Post-commit verification:

- users: 52
- shops: 4
- bays: 4
- bay bookings: 2
- vehicles: 13
- ownership history: 12
- jobs: 8
- organizations: 0
- partner vehicle operations: 0
- partner service requests: 0
- remaining work logs: 2
- every tracked-ID absence query returned 0 (users, shops, Bay 47,
  organization vehicles, vehicle 245, ownership rows, jobs 100/129,
  organizations, operations, requests, and work logs)

The old browser pages still displayed cached vehicle/job content after the
database commit; the absence/count verification was performed with fresh
database reads, not from those stale screens. Runtime-only warnings observed
throughout were unavailable push notifications, React Native web responder/
deprecated style-prop warnings, and one Metro disconnect while the pages were
open.