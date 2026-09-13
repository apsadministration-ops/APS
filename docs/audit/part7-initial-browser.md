# Part 7 initial browser audit

Date: 2026-09-13 (UTC)  
Scope: mandatory initial checks only; broader regressions were not run.

## Fixture and isolation

Fresh scoped fixtures used the `p7-initial-*` prefix:

- owner 261, mechanic 262, unrelated owner 263
- dealership organization 185, location/shop 217
- service request 34, APS job 100, bay 47

The mechanic was accepted through the real Available Jobs UI after setting the
synthetic account active and matching the request tier. The partner-priority
visibility timestamp was moved into the past for this synthetic request only.

## Approval-cache journey

**Pass.** In an isolated owner context:

1. Selected organization 185.
2. Opened request 34 and used the real Send to APS configuration/action.
3. Verified the UI message `Request sent to APS as job #100.` and linked
   `REQUESTED · In progress`.
4. In a separate mechanic context, opened `/available`, clicked the real
   `Accept Job`, and accepted the native confirmation. The dialog text
   confirmed the 2023 Honda Accord repair and 80% labor share.
5. Verified job 100 moved to `PENDING APPROVAL`.
6. Returned to owner, opened the linked job approval route, and clicked the
   real `Approve Mechanic`.
7. Verified one navigation to `/job/100`, `ACCEPTED`, with no error boundary or
   redirect back to `/job/100/approve`.
8. Reloaded `/job/100`; it remained on `/job/100` and rendered the unique job
   and `ACCEPTED` state.

Evidence: mechanic acceptance `ztq0qd`; owner approval `3ghpan`; reload
accessibility state `i0yg5e` (the reload screenshot itself was blank despite
the rendered accessibility tree).

## Owner bay editor

**Mostly pass.** On `/shop/217`, created bay 47 through the UI, then edited,
saved, reloaded, and reopened it. Final persisted state:

- `p7-initial-1789260700292 Bay Beta`
- active; `$160.00/hr`
- minimum tier `senior`
- categories `repair`, `diagnostic`
- equipment `four-post-lift, tire-machine, scan-tool`
- Auto-confirm off
- Monday UTC availability `08:00–17:00`; other days closed

The native update alert was `Bay updated` / `The rentable workspace
configuration was saved.` The final summary and edit reopen both confirmed the
saved values. Evidence: final saved card `o2jkke`; reopened persisted editor
`dq463l`; final DB read confirmed bay 47 active, auto_approve false and a UTC
weekly configuration.

### Validation results

- Blank name: blocked with exact message `Bay name is required.`
  (`4m6sp3`)
- Negative rate `-1`: blocked with exact message
  `Hourly rate must be a non-negative number.` (`bjvi29`)
- No categories: blocked with exact message
  `Select at least one allowed job category.` (`2mcwxc`)
- Reversed Monday time `19:00–08:00`: **defect**. Save returned to the
  summary, showed the native successful update alert, and reopening the editor
  showed `19:00–08:00` persisted with no validation message
  (`4h8tmp`). The value was then repaired to `08:00–17:00` and saved.

## Selected-organization accessibility/navigation

**Pass for the checks that were executable.**

- Selected-organization request list exposed the current dealership and
  request 34.
- 18-tab keyboard pass followed a logical order from Create, search, filters,
  location/request card; no hidden retained previous-organization backlink was
  reachable or present in the accessibility snapshot (`589s29`).
- Request-detail open, browser back, forward, direct deep link, and reload all
  retained the scoped request and linked APS job. Evidence: detail
  `vos8kp`, back list `8vt0v7`, forward `kccm82`, direct deep link `e5l7o3`,
  reload `6pjwle`.
- Separate owner 263 context showed `Select an organization` with no leaked
  organization/request data. Direct `/service-requests/34` showed
  `Select an organization first` and no detail data (`es3dzp`).

There was only one organization owned by owner 261, so switching between two
owned organizations could not be exercised without adding another fixture.
Native VoiceOver/TalkBack certification was not performed.

## Follow-up: two-owned-organization retained-detail check

This follow-up was run before any broader regression. A second unique fixture was
created for the same owner 261 through the real APIs:

- organization 186: `p7-switch-1789261402460 Organization`
- location/shop 218: `p7-switch-1789261402460 Location`
- vehicle operation 117, vehicle 218
- submitted service request 35 with an immutable vehicle snapshot
- request 35 is scoped to organization 186 and uses VIN `2P7SWITCH26109876`

The prior organization-A request 34 and its detail route were retained in
browser history. The initial failed operation POST returned 400 and created no
row; the corrected retry returned 201. Request creation returned 201 and the
draft-to-submitted transition returned 200.

### Switch A to B while A detail is retained

1. Started on org-A request detail `/service-requests/34`.
2. Navigated to Organizations; both active cards were visible and org 185 was
   selected (`x1zmuk`).
3. Selected org 186 through `card-organization-186`; the selected panel showed
   only org-B contact/address and linked location 218 (`0kmek7`).
4. Browser Back returned to the retained `/service-requests/34` route. After
   settling, the app showed `Request unavailable` and exact text
   `HTTP 404 : Partner service request resource not found`; no org-A vehicle,
   request, or snapshot data was exposed (`l2qzmz`).
5. The same retained-route 18-tab traversal cycled through only the generic
   `Back to requests`, current Locations/Vehicles/Post Job/Invoices/Profile
   tabs, floating control, and body. No hidden previous-organization link,
   request-34 action, or stale A link appeared (`0b4938`).

### B list/detail and navigation

- The selected-B request list made 200 calls to:
  `/api/partner-organizations/186/locations`,
  `/api/partner-organizations/186/service-requests?limit=100`, and
  `/api/partner-organizations/186/vehicle-operations`; it displayed only
  request 35 and no request 34 (`7eypob`).
- Request 35 detail showed only the B Toyota RAV4, B VIN/location, B notes,
  and B immutable snapshot (`3ngmmp`).
- Direct `/service-requests/35` deep link used org-186 endpoints, all 200,
  and an A-prefix text count was zero (`gxfgnq`).
- Reload of request 35 retained B data, submitted status, and no A content
  (`r91ka7`).
- Browser Back restored the B list with only request 35 (`pjs737`); Forward
  restored B request 35 detail (`vw5peb`).

### Direct A deep link while B is selected

Direct `/service-requests/34` while org 186 remained selected called
`/api/partner-organizations/186/service-requests/34`, which returned 404
twice. It initially displayed `Loading service request…` (`46pezf`) and then
settled to `Request unavailable` / `HTTP 404 : Partner service request resource
not found` (`2v0b5m`). No A details were exposed.

The final 18-tab traversal on this direct A-on-B route exposed only the generic
`Back to requests`, the five current bottom-navigation tabs, floating control,
and body. It contained no hidden A Back link or stale request control
(`gm35ai`).

Conclusion: the requested two-organization switch, retained-detail gating,
network scoping, accessibility tree, tab traversal, back/forward, deep-link,
reload, and no-exposure checks passed. No reproducible hidden previous-org link
remains. The delayed loading-to-404 state on a cross-organization detail route
was observed, but it settled to the correct scoped error and exposed no data.

Follow-up fixture cleanup tracking (do not clean yet): owner 261, org 186,
shop 218, operation 117, vehicle 218, request 35, plus the existing scoped
fixtures owner 261/org 185/shop 217/bay 47/request 34/job 100 and users 262
and 263.

The reversed availability-window defect from the initial pass was not retested
in this follow-up, per instruction.

## Limitations and non-blocking observations

The runtime repeatedly displayed: `Push notifications are unavailable in this
runtime. Job updates remain available in the app.` Several unrelated older
page contexts logged HTTP 401 background resource failures. Native screen
readers, audio, camera/inspection certification, live Stripe charges, and
external APIs were out of scope. The app also leaves prior inline validation
text visible after editing a field until another save attempt; this did not
prevent valid saves.
