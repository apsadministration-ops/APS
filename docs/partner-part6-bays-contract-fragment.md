# Partner Part 6 — Ghost Garage bay API contract

This contract is merged into the canonical `lib/api-spec/openapi.yaml` and
generated API client/Zod outputs. The filename is retained for existing
implementation references. Regenerate after future contract changes with:

```sh
pnpm --filter @workspace/api-spec run codegen
```

The backend already preserves the existing `/shops`, `/bays`, and
`/bookings` resources and existing auth. No new role is introduced.

The base development migration is additive and may already be applied. After
reviewing the live catalog, the incremental booking-history migration is:

```sh
pnpm --filter @workspace/scripts run migrate:partner-part6-bay-history
```

Do not run that command as part of the contract/codegen pass. It drops only
the old `job_id`-only uniqueness object and adds the partial live-booking
index; it never rewrites or deletes booking history.

## Booking status and availability

```ts
type BayBookingStatus =
  | "pending"    // owner approval requested; does not occupy availability
  | "rejected"   // owner declined; does not occupy availability
  | "reserved"   // owner-approved/confirmed; occupies availability
  | "active"
  | "completed"
  | "cancelled";

type BayAvailabilityConfig = {
  timezone: "UTC";
  weekly: Array<{
    dayOfWeek: number; // 0 Sunday through 6 Saturday
    open: string;      // HH:mm
    close: string;     // HH:mm
  }>;
};
```

An empty `weekly` array retains the legacy always-available behavior. Bay
create/update responses include `availabilityConfig`; owner bay mutations may
set it. Existing owner controls remain the source of truth for `autoApprove`,
`equipment`, `hourlyRate`, `status`, and availability.

## Schemas

### `Bay`

Retain every existing field and add:

```ts
availabilityConfig: BayAvailabilityConfig;
```

### `CreateBayBody` and `UpdateBayBody`

Retain all existing fields. Add:

```ts
availabilityConfig?: BayAvailabilityConfig;
```

`CreateBayBody` and `UpdateBayBody` must validate `dayOfWeek` (`0..6`),
`open`/`close` (`HH:mm`), and `timezone: "UTC"`. `hourlyRate` remains a
non-negative number. A window with `open` later than `close` is an overnight
window that continues into the following UTC day; equal times are rejected as
zero-length intervals. The server rejects malformed time intervals.

### `CreateBayBookingBody`

No new client-controlled identity fields:

```ts
{
  jobId: number;
  startTime: string;       // ISO date-time
  estimatedHours: number;  // > 0 and <= 24
}
```

The server derives mechanic, shop, rate snapshot, and status. A job must be
assigned to the active requesting mechanic and be `ACCEPTED`, `EN_ROUTE`, or
`IN_PROGRESS`. This applies to normal customer jobs and commercial/partner
jobs alike. A lift-required job retains the existing customer transport
approval gate.

### `BayBooking`

Retain every existing scalar field and use the extended `BayBookingStatus`.
Responses additionally include server-derived relationship links:

```ts
job: {
  id: number;
  status: string;
  vehicleId: number;
  mechanicId: number | null;
  customerId: number;
  jobType: "repair" | "diagnostic" | "maintenance" | "detailing";
  requiresGhostGarage: boolean;
  customerTransportApproved: boolean;
  postedByShopId: number | null;
  partnerKindSnapshot: string | null;
};
vehicle: {
  id: number; vin: string; make: string; model: string; year: number;
  trim: string | null; color: string | null;
};
bay: {
  id: number; shopId: number; name: string; hourlyRate: number;
  equipment: string[]; allowedJobCategories: string[];
  minMechanicTier: string; autoApprove: boolean;
  availabilityConfig: BayAvailabilityConfig; status: "active" | "inactive";
};
location: {
  id: number; ownerId: number; organizationId: number | null; name: string;
  address: string; city: string; region: string; zipCode: string;
  status: "active" | "inactive";
};
organization: {
  id: number; name: string;
  subtype: "shop" | "dealership" | "fleet" | "commercial_business";
  status: "active" | "inactive";
} | null;
```

The `location`, `organization`, `job`, `vehicle`, and `bay` links are read
models, not writable fields. They are joined from the actual bay/shop/job
relationships; clients cannot spoof them by supplying `shopId` or any nested
link.

### `BayAvailabilityQuery`

```ts
{
  jobCategory?: "repair" | "diagnostic" | "maintenance" | "detailing";
  minTier?: "detailer" | "technician" | "senior" | "advanced" | "master";
  jobId?: number;
  startsAt?: string;       // required together with durationHours
  durationHours?: number;  // > 0 and <= 24
}
```

## Endpoints and generated hook names

All paths are relative to `/api`. Auth is required. Ordinary customers cannot
browse or reserve bay inventory. Inventory reads are limited to active
mechanics/admins, with existing shop-owner management reads retained.

| Method/path | Operation ID | Expected generated hooks |
|---|---|---|
| `GET /shops/{shopId}` | `getShop` | `useGetShop` / `getShop` |
| `POST /shops/{shopId}/bays` | `createShopBay` | `useCreateShopBay` / `createShopBay` |
| `GET /shops/{shopId}/bays` | `listShopBays` | `useListShopBays` / `listShopBays` |
| `GET /bays/{bayId}` | `getBay` | `useGetBay` / `getBay` |
| `PATCH /bays/{bayId}` | `updateBay` | `useUpdateBay` / `updateBay` |
| `GET /bays/available` | `listAvailableBays` | `useListAvailableBays` / `listAvailableBays` |
| `POST /bays/{bayId}/bookings` | `createBayBooking` | `useCreateBayBooking` / `createBayBooking` |
| `GET /bookings/mine` | `listMyBookings` | `useListMyBookings` / `listMyBookings` |
| `GET /bookings/{bookingId}` | `getBayBooking` | `useGetBayBooking` / `getBayBooking` |
| `PATCH /bookings/{bookingId}/approve` | `approveBayBooking` | `useApproveBayBooking` / `approveBayBooking` |
| `PATCH /bookings/{bookingId}/reject` | `rejectBayBooking` | `useRejectBayBooking` / `rejectBayBooking` |
| `PATCH /bookings/{bookingId}/start` | `startBayBooking` | `useStartBayBooking` / `startBayBooking` |
| `PATCH /bookings/{bookingId}/complete` | `completeBayBooking` | `useCompleteBayBooking` / `completeBayBooking` |
| `PATCH /bookings/{bookingId}/cancel` | `cancelBayBooking` | `useCancelBayBooking` / `cancelBayBooking` |
| `GET /jobs/{jobId}/lift-requirement` | `getJobLiftRequirement` | `useGetJobLiftRequirement` / `getJobLiftRequirement` |
| `PATCH /jobs/{jobId}/lift-requirement` | `setJobLiftRequirement` | `useSetJobLiftRequirement` / `setJobLiftRequirement` |

The backend also accepts POST command aliases for approval/rejection and
lift-requirement mutation for compatibility; PATCH is the canonical contract
operation.

### Approval bodies

```ts
type ApproveBayBookingBody = Record<string, never>;
type RejectBayBookingBody = { reason?: string };
```

Only the owning shop owner (or admin) may approve/reject a `pending` booking.
Approval atomically locks the job, bay, and booking and checks overlap with
`reserved`/`active` rows. A conflict returns `409`; the losing pending request
remains pending for the owner to reject/cancel. `autoApprove: true` skips
`pending` and creates `reserved` after the same interval check. Pending and
rejected requests do not block discovery. A job can have historical terminal
rows, but only one `pending`/`reserved`/`active` booking at a time. Duplicate
live bay requests for one job return `409`.

### Lift requirement

```ts
type SetJobLiftRequirementBody = { requiresGhostGarage: boolean };
type JobLiftRequirementResponse = {
  jobId: number;
  requiresGhostGarage: boolean;
  customerTransportApproved: boolean;
  status: string;
};
```

Only the active assigned mechanic can mutate this field, and only while the
job is `ACCEPTED`, `EN_ROUTE`, or `IN_PROGRESS`. On a false-to-true
transition, `customerTransportApproved` is reset to `false`; otherwise
existing customer approval is preserved. The route does not create inventory,
vehicle records, charges, fees, or earnings.

### Work-log gate

`POST /worklogs` continues to use `bayBookingId` for lift-required jobs.
The supplied ID must be the job's current confirmed booking for the assigned
mechanic, with status `reserved` or `active`; an older terminal booking cannot
be selected after a later request/reservation. `pending`, `rejected`,
`cancelled`, and stale historical IDs return `409`. Existing inspection,
payment, and work-log rules remain unchanged.
