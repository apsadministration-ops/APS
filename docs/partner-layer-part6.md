# Partners Layer — Part 6 operational integration

## Scope and existing architecture

Parts 1–5 and the existing jobs, mechanic approval, work-log, payment, shop,
bay, and booking implementations were reviewed before implementation.
This phase connects those systems; it does not introduce a separate mechanic
dashboard, dispatch system, reservation system, or earnings calculation.

Internal `shop_owner` roles, Partner routes, organization subtypes, legacy
unlinked shops, and canonical vehicles remain in use. Location classification
does not determine organization subtype. No customer ownership records are
created or reassigned by the commercial bridge.

## Commercial request → APS workflow

1. The primary owner creates/submits an organization-scoped dealership or
   fleet request for its registered operational vehicle.
2. **Send to APS** validates the submitted request, active organization,
   operation/vehicle association, and active linked location. A catalog service
   or valid mapped job category determines the existing APS service policy.
3. A transaction creates one ordinary `REQUESTED` job and records the source
   request link. Matching retries return that same job; conflicting inputs
   fail rather than creating duplicates.
4. Mechanics discover the job in their existing job board with a
   **Dealership** or **Fleet** tag, vehicle, requested work, urgency, and location.
5. Standard mechanic acceptance opens the existing approval flow. The exact
   source organization's primary owner can approve using the normal job
   screen; existing timeout behavior remains.
6. Work proceeds through existing APS status, inspection where applicable,
   work-log, completion, and payment paths.
7. The organization request detail polls the linked job and real work logs.
   Fleet maintenance history displays actual completed service records.

The organization owner is the standard job's customer-of-record principal,
not a new vehicle owner. Server access requires the exact linked organization,
request, and owner relationship; merely having the `shop_owner` role is not
sufficient.

After linking, the source request's internal lifecycle/content cannot be
edited to compete with APS. Its source status remains submitted; the displayed
APS progress and completion come from the actual job/work log, not a second
status engine. Historical Part 5 internal records are not auto-converted.

Private service notes, operational snapshots, inventory/unit notes, and source
codes are not copied into mechanic-facing descriptions. Public requested work
is the job description. Existing commission, pricing, payment gates, and
earnings calculations are reused without changing percentages.

## Ghost Garage workflow

The assigned active mechanic can select **Require Lift** on an eligible
accepted/in-progress job. A newly required lift resets transport approval;
the customer or exact commercial owner must approve through the existing
job communication flow before reservation.

**Schedule a Lift** searches the existing bay inventory by job, scheduled
date/time, and duration. Results include location, equipment, supported work,
rate, and availability. Owners can manage active status, equipment, rates,
auto-approval, and explicitly labelled UTC weekly availability windows in
the existing bay editor. Empty weekly availability retains legacy
always-available behavior.

Reservations derive mechanic, job, vehicle, bay, location/shop, organization
(nullable for legacy shops), rate snapshot, and status on the server.

- Manual approval: `pending` → owner approves → `reserved` (confirmed).
- Auto-approval: existing `autoApprove` bays create `reserved` directly.
- Rejection: the mechanic sees the reason and can request another bay.
- Cancellation: releases availability and permits a new request for the same job.
- Reserved/active bookings occupy their scheduled interval. Pending/rejected
  requests do not occupy availability.
- Job/bay transaction locks and the live-booking uniqueness constraint prevent
  conflicting confirmations and duplicate live requests.
- Rejected/cancelled/completed booking records are retained. Only one
  pending/reserved/active booking may exist per job.

The mechanic's job screen shows reservation state and cancellation/rebooking
actions. Existing shop-owner Bookings handles approval/rejection. Work logs
cannot use pending, rejected, cancelled, or stale terminal bookings in place
of the current confirmed booking. Existing inspection and billing rules remain.

This same workflow applies to normal customer, dealership, and fleet jobs.

## Customer visibility

Ordinary customers cannot browse bay inventory or create/manage reservations.
Their existing job screen exposes lift-related communication only for their
own job when a lift is required, including transport approval. Bay selection,
inventory, and reservation management remain mechanic/shop operational tools.

## Contracts and development migrations

- `docs/partner-part6-commercial-api.md`
- `docs/partner-part6-bays-contract-fragment.md`
- Canonical OpenAPI: `lib/api-spec/openapi.yaml`; generated clients and Zod
  output use the existing Orval 8.5.3/Zod 3-compatible setup.

Applied only to development:

- `migrate:partner-part6-commercial`
- `migrate:partner-part6-bays`
- `migrate:partner-part6-bay-history`

These add source links and availability support and replace the old
one-booking-ever-per-job restriction with one-live-booking uniqueness.
Existing rows and terminal booking history are preserved; no organization or
vehicle backfill was performed. No production migration was executed.

## Focused verification

Passed:

- Two real-database commercial scenarios: dealership and fleet send,
  idempotent/concurrent conversion, mechanic acceptance, owner approval,
  normal work-log completion, linked completion/history, unchanged earnings,
  and unchanged customer ownership.
- Focused eligibility cases: invalid service selection, draft/inactive
  requests/organizations, and unrelated/cross-organization access.
- Three real-database bay scenarios covering discovery, manual/auto approval,
  rejection, cancellation, same-job rebooking, preserved history, overlap
  conflicts, role/job validation, and lift/transport approval.
- API/mobile TypeScript checks, generated library checks, Partner helper
  checks, Ghost Garage UI contract checks, and diff checks.
- API and mobile workflows start; login preview renders.

Connected browser verification:

- Dealership and fleet owners opened valid API-created request details and
  used **Send to APS**, receiving the actual linked job and source tag.
- The mechanic found the Fleet job through the existing Work Down tier filter,
  accepted it, submitted the real work-log form, and saw COMPLETED with its
  final total. The owner saw the actual completed Fleet maintenance history.
- Owner approval mutations succeeded through the actual UI. A post-approval
  redirect loop was found: the destination job query still held
  PENDING_APPROVAL. The final fix refreshes the exact generated job query
  before navigating, including timeout approval; TypeScript and focused UI
  contract checks passed. A fresh approval-click browser run was not repeated
  after this final cache fix.
- The dealership job's mechanic used Require Lift; its owner approved
  transport. The mechanic scheduled a future UTC interval and submitted a
  pending booking.
- The shop owner rejected that booking with a reason. The mechanic requested
  another bay for the same job; the shop owner approved it. The mechanic saw
  the confirmed reservation on the job, cancelled it, and saw both bays
  available again.
- Owner bay availability/equipment/rate editing was implemented and
  typechecked but not exercised in the final browser pass. Backend scheduling
  and availability behavior was covered by the focused database scenarios.

All synthetic fixtures were removed transactionally. Final counts returned to
52 users, 4 shops, 4 bays, 2 bookings, 13 vehicles, 12 ownership-history rows,
8 jobs, and zero organizations, operations, requests, and request-history rows.
The checks used synthetic development data, not real repairs or live payments.

## Explicitly deferred / not certified

Part 7 remains the full audit, deep debugging, comprehensive regression,
security, database-integrity, cleanup, and beta-readiness phase.

- The previously reported retained navigation accessibility back-link remains
  a known issue; Part 6 does not certify it as fixed.
- Native VoiceOver/TalkBack, physical-device behavior, and live provider
  payments/payouts were not certified.
- Runtime reports the existing Stripe webhook signing-secret configuration
  issue. No provider endpoints, credentials, or financial configuration were
  changed during Part 6.
- No contracts, recurring execution, staff permissions, advanced accounting,
  enterprise billing, or speculative features were added.