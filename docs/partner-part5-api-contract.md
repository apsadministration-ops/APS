# Partner service requests API contract (Part 5)

Part 5 adds an owner-managed, organization-scoped operational request intake
resource for dealership and fleet organizations. It is deliberately **not** an
APS job, dispatch record, mechanic assignment, completion/earnings record, or
customer workflow. It does not add contracts, recurrence, staff membership,
provider acceptance, or provider scheduling.

The existing active `shop_owner` account and organization ownership rules remain
the only access control. There is no new administrator, mechanic, or customer
access path.

## Resource and invariants

The resource is `partner_service_requests`. Each request is associated with:

- the owning `organizationId`;
- one existing `operationId` in `partner_vehicle_operations`;
- the operation's `vehicleId`;
- the immutable operation `sourceSubtype` (`dealership` or `fleet`);
- one `locationId` (an existing `shops` row linked to the same organization);
- a server-created immutable `creationContext` snapshot.

The operation is looked up by ID. Clients never supply VIN, stock number, unit
number, subtype, or arbitrary context payload. The server derives the snapshot
from the selected operation and its canonical vehicle at creation time. A
dealership snapshot contains only canonical vehicle identity fields and
dealership operation fields; a fleet snapshot contains only canonical vehicle
identity fields and fleet operation fields. It is explicitly a creation-time
snapshot and is not rewritten when the vehicle or operation is later edited.

Only dealership and fleet organizations are eligible. `shop` and
`commercial_business` organizations receive `403`. Every read and write is
owner-scoped; another owner's organization, operation, vehicle, or location is
not disclosed. Inactive organizations may be read, but all writes require an
active organization. Locations must be active and already linked to the same
organization at write time. No request endpoint changes vehicle ownership,
ownership history, operation identity, or organization links.

The status lifecycle is:

```text
draft -> submitted -> in_progress -> completed
  |          |             |
  +----------+-------------+--> cancelled
```

Only the explicit transition endpoint changes status. Valid transitions are
`draft -> submitted`, `submitted -> in_progress`, `in_progress -> completed`,
and `draft|submitted|in_progress -> cancelled`. Terminal statuses
`completed` and `cancelled` are immutable. There are no `accepted`, `rejected`,
or `scheduled` states. Status transitions and content edits use an integer
`expectedVersion` optimistic-lock token. A stale token returns `409` without a
write.

## Common values

```ts
type PartnerServiceRequestStatus =
  | "draft" | "submitted" | "in_progress" | "completed" | "cancelled";

type PartnerServiceRequestCategory =
  | "inspection" | "diagnostics" | "maintenance" | "repair"
  | "recall" | "other";

type PartnerServiceRequestUrgency = "low" | "normal" | "high" | "urgent";

type PartnerServiceRequest = {
  id: number;
  organizationId: number;
  operationId: number;
  vehicleId: number;
  sourceSubtype: "dealership" | "fleet";
  locationId: number;
  status: PartnerServiceRequestStatus;
  category: PartnerServiceRequestCategory;
  urgency: PartnerServiceRequestUrgency;
  requestedWork: string;
  serviceNotes: string | null;
  creationContext: DealershipRequestCreationContext
    | FleetRequestCreationContext;
  version: number;
  clientRequestId: string;
  createdAt: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
};

type RequestVehicleContext = {
  vin: string;
  plateNumber: string | null;
  make: string;
  model: string;
  year: number;
  trim: string | null;
  color: string | null;
  mileage: number;
};

type DealershipRequestCreationContext = {
  capturedAt: string;
  vehicle: RequestVehicleContext;
  operation: {
    stockNumber: string | null;
    inventoryStatus: "in_stock" | "preparing" | "ready" | "sold" | null;
    serviceNeeded: boolean | null;
    serviceNotes: string | null;
  };
};

type FleetRequestCreationContext = {
  capturedAt: string;
  vehicle: RequestVehicleContext;
  operation: {
    unitNumber: string | null;
    groupName: string | null;
    operatingStatus: "active" | "maintenance" | "out_of_service" | "retired" | null;
    odometer: number | null;
    usageHours: number | null;
    maintenanceDueDate: string | null;
    maintenanceDueMileage: number | null;
    downtimeSince: string | null;
    notes: string | null;
  };
};

type PartnerServiceRequestStatusHistory = {
  id: number;
  requestId: number;
  actorUserId: number;
  fromStatus: PartnerServiceRequestStatus | null;
  toStatus: PartnerServiceRequestStatus;
  note: string | null;
  createdAt: string;
};
```

`createdAt`, `submittedAt`, `startedAt`, `completedAt`, `cancelledAt`, and
`updatedAt` are server timestamps. The first history row records
`fromStatus: null`, `toStatus: "draft"`. History is append-only and returned in
chronological order by the detail endpoint.

## Endpoints

All paths below are relative to `/api` and require a bearer token plus the
active `shop_owner` role.

### `GET /partner-organizations/{organizationId}/service-requests`

Lists the owner's requests for the organization. Inactive organizations remain
readable. Query parameters are optional and strictly validated:

| Query | Type | Meaning |
| --- | --- | --- |
| `status` | status | exact status filter |
| `urgency` | urgency | exact urgency filter |
| `vehicleId` | positive integer | associated vehicle |
| `locationId` | positive integer | associated location |
| `q` | string | case-insensitive search in requested work and service notes |
| `limit` | integer `1..100` | maximum rows; default `50` |

Unknown query keys, unknown enum values, malformed IDs, and malformed limits
return `400`. Results are organization/owner scoped and ordered newest first.

### `POST /partner-organizations/{organizationId}/service-requests`

Creates a request in `draft` status. The organization, operation, vehicle,
subtype, and location are checked in one transaction with the organization row
locked first, then the operation, vehicle, and location in that order.

Request:

```json
{
  "operationId": 456,
  "locationId": 123,
  "category": "maintenance",
  "urgency": "normal",
  "requestedWork": "Replace the scheduled engine oil and filter",
  "serviceNotes": "Use the fleet-approved lubricant",
  "clientRequestId": "fleet-maintenance-2026-00042"
}
```

`requestedWork` is required and non-blank. `serviceNotes` is optional.
`clientRequestId` is required, scoped to the organization, and must be stable
for retries. The database has a unique `(organizationId, clientRequestId)`
constraint. A retry with the same ID and the same normalized create
fingerprint returns the existing request (`200`, not a second row). Reuse with
a different fingerprint returns `409`.

Clients cannot provide `vehicleId`, `sourceSubtype`, VIN, stock/unit fields,
`creationContext`, status, timestamps, or version. The server obtains all
immutable associations and creation context from `operationId`.

Response: `201` with `PartnerServiceRequest`; an idempotent matching retry is
`200` with the same response.

### `GET /partner-organizations/{organizationId}/service-requests/{requestId}`

Returns the owner-scoped request and append-only `statusHistory`. Inactive
organizations are readable. A request under another organization is returned
as `404`.

Response:

```json
{
  "request": { "...": "PartnerServiceRequest" },
  "statusHistory": [
    {
      "id": 9,
      "requestId": 1,
      "actorUserId": 7,
      "fromStatus": null,
      "toStatus": "draft",
      "note": null,
      "createdAt": "2026-05-20T12:00:00.000Z"
    }
  ]
}
```

### `PATCH /partner-organizations/{organizationId}/service-requests/{requestId}`

Edits content only while the request is `draft` or `submitted`. The body must
contain `expectedVersion` and at least one of `category`, `urgency`,
`requestedWork`, `serviceNotes`, or `locationId`:

```json
{
  "expectedVersion": 0,
  "urgency": "high",
  "serviceNotes": "Vehicle is needed for tomorrow's route",
  "locationId": 124
}
```

The endpoint rejects status, operation, vehicle, organization, subtype,
client-request ID, context, and timestamp changes. The destination location
must be active, owner-linked, and linked to the same organization. A successful
edit increments `version` and updates `updatedAt`.

### `POST /partner-organizations/{organizationId}/service-requests/{requestId}/transition`

Changes status using the strict lifecycle and the request's current
`expectedVersion`:

```json
{
  "toStatus": "submitted",
  "expectedVersion": 1,
  "note": "Ready for the service department"
}
```

`note` is optional and is stored only on the newly appended history row.
Successful transitions increment `version`, set only the matching server
timestamp, update `updatedAt`, and append history with the authenticated
owner as actor. Invalid transitions, terminal requests, and stale versions
return `409`.

## Database and migration

The additive migration is
`scripts/src/migrate_partner_part5_service_requests.mjs`. It is idempotent,
transactional, and does not backfill any request. Run the read-only baseline
report first:

```bash
node scripts/src/report_partner_part5_service_requests.mjs
node scripts/src/migrate_partner_part5_service_requests.mjs
```

The report records baseline counts for organizations, locations, vehicles,
ownership history, vehicle operations, service requests, and status history, plus any existing
duplicate request idempotency keys. The migration creates
`partner_service_requests`, `partner_service_request_status_history`, their
organization/request indexes, immutable-association constraints, and the
organization-scoped idempotency unique key.

OpenAPI is the source of truth for this contract. Generated helpers are pinned
to Orval `8.5.3` and Zod 3 compatibility:

```bash
pnpm --filter @workspace/api-spec run codegen
```