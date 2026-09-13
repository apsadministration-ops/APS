# Partner Part 6 — commercial APS bridge API

Part 6 connects an explicitly submitted dealership/fleet service request to one
existing APS job workflow. It does not create a second dispatch, work-log,
approval, payout, fee, or ownership system.

## Eligibility and ownership

The bridge requires an authenticated, active `shop_owner` whose
`primaryOwnerId` is the requested organization owner. Only organization
subtypes `dealership` and `fleet` qualify. The organization must be active, the
request must be `submitted`, the operation must belong to that organization,
the operation's `vehicleId` must equal the request's canonical `vehicleId`, and
the destination must be the active location linked to that same organization
and owner.

The bridge does not claim or transfer canonical vehicle ownership and does not
write ownership history. A linked APS job keeps the existing principal pattern:
`jobs.customerId` is the organization's existing `primaryOwnerId`. Owner
access is still checked against the exact source organization/request link;
being any `shop_owner` is not sufficient.

Sold dealership operations and retired fleet operations cannot be sent. An
inactive organization or inactive/mismatched location cannot be used. No
staff, delegated role, contract, approval override, or invented commercial
permission is introduced.

## Explicit Send to APS

### `POST /partner-organizations/{organizationId}/service-requests/{requestId}/send-to-aps`

This is the only conversion endpoint. The owner must first submit the Part 5
request. It creates a normal APS `jobs` row in `REQUESTED` status in the same
transaction that records the source link on the request.

Request body (unknown fields are rejected):

```ts
type SendPartnerServiceRequestToApsInput = {
  expectedVersion: number; // current request version, required
  serviceSlug?: string | null; // optional catalog selection
  jobType?: "repair" | "diagnostic" | "maintenance" | "detailing" | null;
};
```

`serviceSlug` is resolved through the existing tier catalog. The server derives
`jobType`, `requiredTier`, and `estimatedPrice` from that catalog and the
canonical vehicle; callers cannot submit a price or tier. If no slug is
provided, `jobType` is used when present. Otherwise the request category maps
only as follows: `inspection`/`diagnostics` → `diagnostic`, `maintenance` →
`maintenance`, `repair`/`recall` → `repair`. `other` requires a valid
`jobType`. The existing partner urgency policy is reused from
`partnerJobs.ts`; request urgency is authoritative and drives mechanic
visibility. Commission and fee behavior is unchanged.

The public APS job description is the trimmed `requestedWork` only. Private
organization `serviceNotes`, creation snapshots, inventory/unit notes,
diagnostic codes, and other organization metadata are not copied to the job
or exposed to mechanics. The job uses the validated organization's linked
location for address/coordinates and the existing `requiresGhostGarage`
keyword policy; no bay schema or lift field is added here.

Response:

```ts
type SendPartnerServiceRequestToApsResponse = {
  request: PartnerServiceRequest; // includes linkedApsJobId and linkedAt
  job: Job;                       // ordinary APS Job, status REQUESTED
  replay: boolean;                // false for first send, true for same retry
};
```

Matching retries return `200` with `replay: true` and the original request/job.
The request stores a send fingerprint, and the database enforces the
organization/request source uniqueness plus the request's unique linked APS
job. Reusing the same request with different send options returns `409`.
Conflicting optimistic versions return `409`. There is no second idempotency
key supplied by the UI.

### Request response fields

The existing request response gains:

```ts
linkedApsJobId: number | null;
linkedAt: string | null;
```

After linking, `PATCH` and `/transition` return `409`; content and internal
request lifecycle editing cannot compete with the real APS job lifecycle. The
request remains `submitted` as the source record. Its detail response includes
the read-only `linkedProgress` projection:

```ts
type LinkedProgress = {
  apsJob: Job;
  worklogs: Array<{
    id: number;
    jobId: number;
    vehicleId: number;
    vin: string;
    mechanicId: number;
    serviceCategory: "repair" | "diagnostic" | "maintenance" | "detailing";
    serviceDescription: string;
    mileageAtService: number;
    laborCost: number;
    partsCost: number;
    totalCost: number;
    createdAt: string;
  }>;
  completion: boolean;
} | null;
```

`linkedProgress` is computed from the real `jobs` row and real `work_logs`
rows. `completion` is true only when the APS job is `COMPLETED`/`PAID` and a
work log exists. No copied status or parallel completion history is written.
Fleet maintenance history is therefore the linked completed request's actual
work-log projection, not an inventory or customer-ownership history.

## Existing APS workflow after send

Mechanics see the ordinary `REQUESTED` job through the existing available-jobs
policy. The normal acceptance path remains:

```text
REQUESTED
  -> mechanic POST /jobs/{jobId}/accept
  -> PENDING_APPROVAL
  -> existing owner approval endpoint (or default timeout auto-approval)
  -> ACCEPTED -> EN_ROUTE -> IN_PROGRESS
  -> existing POST /worklogs
  -> COMPLETED / payment confirmation flow
```

The linked organization's primary owner is authorized as the owner principal
for the linked job's:

- `GET /jobs/{jobId}` and owner-filtered `GET /jobs`;
- `GET /approvals/job/{jobId}`;
- `POST /approvals/{jobId}/approve` and `/decline`;
- `POST /jobs/{jobId}/transport-approval`;
- existing payment list/checkout access where payment is required.

All paths require the exact linked source organization/request relationship.
Mechanic assignment, dispatch, completion, work-log creation, payout, and
payment calculations continue using the existing APS routes and policies.

## Mechanic-facing source contract

`Job` adds nullable source fields:

```ts
sourceOrganizationId: number | null;
sourceServiceRequestId: number | null;
commercialSource: {
  organizationId: number | null;
  serviceRequestId: number | null;
  subtype: "dealership" | "fleet";
  requestedWork: string;
} | null;
```

Mechanic job cards/detail use the ordinary `vehicle`, `description`
(`requestedWork`), `urgency`, `locationAddress`, and
`requiresGhostGarage` fields. `commercialSource.subtype` is the sanitized
Dealership/Fleet tag. On mechanic responses the two linkage IDs are null; no
private organization notes, source codes, or creation-context operational
notes are included. Owner-scoped responses retain the linkage IDs.

## Generated client hook names

The central OpenAPI generation pass is complete (Orval `8.5.3`, Zod
3-compatible). The UI uses these generated operations:

- `useListPartnerServiceRequests` — owner request list;
- `useGetPartnerServiceRequest` — owner detail, history, and
  `linkedProgress`;
- `useUpdatePartnerServiceRequest` and `useTransitionPartnerServiceRequest` —
  Part 5 pre-link editing/submission only;
- `useSendPartnerServiceRequestToAps` — explicit Send to APS mutation;
- `useListJobs` / `useGetJob` — linked APS job detail;
- `useGetJobApproval` — approval state;
- `useApproveJobApproval` / `useDeclineJobApproval` — existing approval
  mutations;
- `useListAvailableJobs` — mechanic job board.

Bay/booking clients use the same central generated output:
`useGetShop`, `useCreateShopBay`, `useListShopBays`, `useGetBay`,
`useUpdateBay`, `useListAvailableBays`, `useCreateBayBooking`,
`useListMyBookings`, `useGetBayBooking`, `useApproveBayBooking`,
`useRejectBayBooking`, `useStartBayBooking`, `useCompleteBayBooking`,
`useCancelBayBooking`, `useGetJobLiftRequirement`, and
`useSetJobLiftRequirement`.

The send mutation must send `organizationId`, `requestId`, and the exact
`expectedVersion` plus optional `serviceSlug`/`jobType`; it must not send
vehicle IDs, VIN, prices, tiers, source notes, status, or ownership fields.
Invalidate the request detail/list and linked job queries after success.

## Migration and codegen ownership

`scripts/src/migrate_partner_part6_commercial.mjs` is additive and DEV-only. It
adds source-link columns/indexes and the bidirectional foreign keys without
backfill. It was applied to development during Part 6, not to production.

OpenAPI is the source of truth. The commercial and bay contracts were merged
and generated together. No generated file should be hand-edited or regenerated
with an incompatible Orval/Zod version.