import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  partnerOrganizationsTable,
  partnerServiceRequestStatusHistoryTable,
  partnerServiceRequestsTable,
  partnerVehicleOperationsTable,
  shopsTable,
  vehiclesTable,
} from "@workspace/db";
import {
  CreatePartnerServiceRequestBody,
  CreatePartnerServiceRequestResponse,
  GetPartnerServiceRequestParams,
  GetPartnerServiceRequestResponse,
  ListPartnerServiceRequestsParams,
  ListPartnerServiceRequestsQueryParams,
  ListPartnerServiceRequestsResponse,
  TransitionPartnerServiceRequestBody,
  TransitionPartnerServiceRequestParams,
  TransitionPartnerServiceRequestResponse,
  UpdatePartnerServiceRequestBody,
  UpdatePartnerServiceRequestParams,
  UpdatePartnerServiceRequestResponse,
} from "@workspace/api-zod";
import {
  authenticate,
  requireShopOwner,
  type AuthRequest,
} from "../middlewares/authenticate";

const router: IRouter = Router();

const CREATE_FIELDS = new Set([
  "operationId",
  "locationId",
  "category",
  "urgency",
  "requestedWork",
  "serviceNotes",
  "clientRequestId",
]);
const UPDATE_FIELDS = new Set([
  "expectedVersion",
  "category",
  "urgency",
  "requestedWork",
  "serviceNotes",
  "locationId",
]);
const TRANSITION_FIELDS = new Set(["expectedVersion", "toStatus", "note"]);
const QUERY_FIELDS = new Set([
  "status",
  "urgency",
  "vehicleId",
  "locationId",
  "q",
  "limit",
]);

type ServiceRequestStatus =
  | "draft"
  | "submitted"
  | "in_progress"
  | "completed"
  | "cancelled";
type ServiceRequestSubtype = "dealership" | "fleet";
type RequestBody = Record<string, unknown>;

class ServiceRequestError extends Error {
  constructor(
    readonly code:
      | "ORGANIZATION_NOT_FOUND"
      | "ORGANIZATION_UNSUPPORTED"
      | "ORGANIZATION_INACTIVE"
      | "OPERATION_NOT_FOUND"
      | "LOCATION_NOT_FOUND"
      | "LOCATION_INACTIVE"
      | "REQUEST_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "STALE_VERSION"
      | "INVALID_TRANSITION"
      | "TERMINAL_REQUEST",
  ) {
    super(code);
  }
}

function hasUnknownFields(value: unknown, allowed: Set<string>): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value).some((key) => !allowed.has(key));
}

function positiveSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function requiredId(
  value: unknown,
  name: string,
  res: { status(code: number): { json(body: unknown): unknown } },
): number | null {
  const id = positiveSafeInteger(value);
  if (id === null) {
    res.status(400).json({ error: `${name} must be a positive safe integer` });
  }
  return id;
}

function requestPath(
  req: AuthRequest,
  res: { status(code: number): { json(body: unknown): unknown } },
): { organizationId: number; requestId: number } | null {
  const organizationId = requiredId(req.params.organizationId, "organizationId", res);
  const requestId = requiredId(req.params.requestId, "requestId", res);
  return organizationId === null || requestId === null
    ? null
    : { organizationId, requestId };
}

function isServiceRequestStatus(value: unknown): value is ServiceRequestStatus {
  return (
    value === "draft" ||
    value === "submitted" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isServiceRequestSubtype(value: unknown): value is ServiceRequestSubtype {
  return value === "dealership" || value === "fleet";
}

function formatVehicleContext(vehicle: typeof vehiclesTable.$inferSelect) {
  return {
    vin: vehicle.vin,
    plateNumber: vehicle.plateNumber ?? null,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    trim: vehicle.trim ?? null,
    color: vehicle.color ?? null,
    mileage: vehicle.mileage,
  };
}

function formatCreationContext(
  subtype: ServiceRequestSubtype,
  vehicle: typeof vehiclesTable.$inferSelect,
  operation: typeof partnerVehicleOperationsTable.$inferSelect,
  capturedAt: Date,
) {
  const vehicleContext = formatVehicleContext(vehicle);
  if (subtype === "dealership") {
    return {
      capturedAt,
      vehicle: vehicleContext,
      operation: {
        stockNumber: operation.stockNumber ?? null,
        inventoryStatus: operation.inventoryStatus ?? null,
        serviceNeeded: operation.serviceNeeded ?? null,
        serviceNotes: operation.serviceNotes ?? null,
      },
    };
  }
  return {
    capturedAt,
    vehicle: vehicleContext,
    operation: {
      unitNumber: operation.unitNumber ?? null,
      groupName: operation.groupName ?? null,
      operatingStatus: operation.operatingStatus ?? null,
      odometer: operation.odometer ?? null,
      usageHours: operation.usageHours ?? null,
      maintenanceDueDate: operation.maintenanceDueDate ?? null,
      maintenanceDueMileage: operation.maintenanceDueMileage ?? null,
      downtimeSince: operation.downtimeSince ?? null,
      notes: operation.notes ?? null,
    },
  };
}

function normalizeClientValue(value: unknown): unknown {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value.trim()
      : value;
}

function createFingerprint(value: {
  operationId: number;
  locationId: number;
  category: string;
  urgency: string;
  requestedWork: string;
  serviceNotes: string | null;
}): string {
  const canonical = JSON.stringify({
    operationId: value.operationId,
    locationId: value.locationId,
    category: value.category,
    urgency: value.urgency,
    requestedWork: value.requestedWork,
    serviceNotes: value.serviceNotes,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function formatRequest(
  request: typeof partnerServiceRequestsTable.$inferSelect,
) {
  return {
    id: request.id,
    organizationId: request.organizationId,
    operationId: request.operationId,
    vehicleId: request.vehicleId,
    sourceSubtype: request.sourceSubtype,
    locationId: request.locationId,
    status: request.status,
    category: request.category,
    urgency: request.urgency,
    requestedWork: request.requestedWork,
    serviceNotes: request.serviceNotes ?? null,
    creationContext: request.creationContext,
    version: request.version,
    clientRequestId: request.clientRequestId,
    createdAt: request.createdAt,
    submittedAt: request.submittedAt ?? null,
    startedAt: request.startedAt ?? null,
    completedAt: request.completedAt ?? null,
    cancelledAt: request.cancelledAt ?? null,
    updatedAt: request.updatedAt,
  };
}

function formatHistory(
  history: typeof partnerServiceRequestStatusHistoryTable.$inferSelect,
) {
  return {
    id: history.id,
    requestId: history.requestId,
    actorUserId: history.actorUserId,
    fromStatus: history.fromStatus ?? null,
    toStatus: history.toStatus,
    note: history.note ?? null,
    createdAt: history.createdAt,
  };
}

async function ownedOrganization(
  organizationId: number,
  ownerId: number,
  readOnly: boolean,
) {
  const [organization] = await db
    .select()
    .from(partnerOrganizationsTable)
    .where(
      and(
        eq(partnerOrganizationsTable.id, organizationId),
        eq(partnerOrganizationsTable.primaryOwnerId, ownerId),
      ),
    );
  if (!organization) throw new ServiceRequestError("ORGANIZATION_NOT_FOUND");
  if (!isServiceRequestSubtype(organization.subtype)) {
    throw new ServiceRequestError("ORGANIZATION_UNSUPPORTED");
  }
  if (!readOnly && organization.status !== "active") {
    throw new ServiceRequestError("ORGANIZATION_INACTIVE");
  }
  return organization;
}

function errorResponse(
  error: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): boolean {
  if (!(error instanceof ServiceRequestError)) return false;
  switch (error.code) {
    case "ORGANIZATION_NOT_FOUND":
    case "OPERATION_NOT_FOUND":
    case "LOCATION_NOT_FOUND":
    case "REQUEST_NOT_FOUND":
      res.status(404).json({ error: "Partner service request resource not found" });
      return true;
    case "ORGANIZATION_UNSUPPORTED":
      res.status(403).json({
        error: "Service requests are available only to dealership and fleet organizations",
      });
      return true;
    case "ORGANIZATION_INACTIVE":
      res.status(409).json({ error: "Inactive organizations cannot write service requests" });
      return true;
    case "LOCATION_INACTIVE":
      res.status(409).json({ error: "Service request location must be active" });
      return true;
    case "IDEMPOTENCY_CONFLICT":
      res.status(409).json({ error: "clientRequestId was already used for different request content" });
      return true;
    case "STALE_VERSION":
      res.status(409).json({ error: "Service request version is stale; reload and retry" });
      return true;
    case "INVALID_TRANSITION":
      res.status(409).json({ error: "Invalid service request status transition" });
      return true;
    case "TERMINAL_REQUEST":
      res.status(409).json({ error: "Completed and cancelled service requests are immutable" });
      return true;
  }
}

async function lockOrganization(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  ownerId: number,
): Promise<{ id: number; subtype: ServiceRequestSubtype; status: string }> {
  const rows = await tx.execute(sql`
    SELECT id, subtype, status
    FROM partner_organizations
    WHERE id = ${organizationId}
      AND primary_owner_id = ${ownerId}
    FOR UPDATE
  `);
  const organization = rows.rows[0] as
    | { id: number; subtype: ServiceRequestSubtype; status: string }
    | undefined;
  if (!organization) throw new ServiceRequestError("ORGANIZATION_NOT_FOUND");
  if (!isServiceRequestSubtype(organization.subtype)) {
    throw new ServiceRequestError("ORGANIZATION_UNSUPPORTED");
  }
  return organization;
}

async function lockOperationAndVehicle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  operationId: number,
) {
  const operationRows = await tx.execute(sql`
    SELECT id, vehicle_id
    FROM partner_vehicle_operations
    WHERE id = ${operationId}
      AND organization_id = ${organizationId}
    FOR UPDATE
  `);
  const operationKey = operationRows.rows[0] as
    | { id: number; vehicle_id: number }
    | undefined;
  if (!operationKey) throw new ServiceRequestError("OPERATION_NOT_FOUND");

  await tx.execute(sql`
    SELECT id
    FROM vehicles
    WHERE id = ${operationKey.vehicle_id}
    FOR UPDATE
  `);
  const [row] = await tx
    .select({
      operation: partnerVehicleOperationsTable,
      vehicle: vehiclesTable,
    })
    .from(partnerVehicleOperationsTable)
    .innerJoin(
      vehiclesTable,
      eq(partnerVehicleOperationsTable.vehicleId, vehiclesTable.id),
    )
    .where(
      and(
        eq(partnerVehicleOperationsTable.organizationId, organizationId),
        eq(partnerVehicleOperationsTable.id, operationId),
      ),
    );
  if (!row) throw new ServiceRequestError("OPERATION_NOT_FOUND");
  return row;
}

async function lockLocation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  ownerId: number,
  locationId: number,
) {
  const locationRows = await tx.execute(sql`
    SELECT id, status
    FROM shops
    WHERE id = ${locationId}
      AND organization_id = ${organizationId}
      AND owner_id = ${ownerId}
    FOR UPDATE
  `);
  const location = locationRows.rows[0] as
    | { id: number; status: string }
    | undefined;
  if (!location) throw new ServiceRequestError("LOCATION_NOT_FOUND");
  if (location.status !== "active") {
    throw new ServiceRequestError("LOCATION_INACTIVE");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function escapedSearch(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function assertQueryKeys(query: unknown): boolean {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }
  const record = query as Record<string, unknown>;
  return Object.keys(record).every((key) => {
    if (!QUERY_FIELDS.has(key)) return false;
    const value = record[key];
    return !Array.isArray(value);
  });
}

function assertStrictIntegerQuery(
  query: Record<string, unknown>,
  key: string,
  allowZero = false,
): boolean {
  const value = query[key];
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const pattern = allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  const parsed = Number(value);
  return (
    pattern.test(value) &&
    Number.isSafeInteger(parsed) &&
    (allowZero ? parsed >= 0 : parsed > 0)
  );
}

router.get(
  "/partner-organizations/:organizationId/service-requests",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requiredId(req.params.organizationId, "organizationId", res);
    if (organizationId === null) return;
    const path = ListPartnerServiceRequestsParams.safeParse(req.params);
    if (
      !path.success ||
      !assertQueryKeys(req.query) ||
      !assertStrictIntegerQuery(req.query as Record<string, unknown>, "vehicleId") ||
      !assertStrictIntegerQuery(req.query as Record<string, unknown>, "locationId") ||
      !assertStrictIntegerQuery(req.query as Record<string, unknown>, "limit")
    ) {
      res.status(400).json({ error: path.success ? "Unknown service request query field" : path.error.message });
      return;
    }
    const query = ListPartnerServiceRequestsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    try {
      await ownedOrganization(organizationId, req.userId!, true);
      const filters = [eq(partnerServiceRequestsTable.organizationId, organizationId)];
      if (query.data.status !== undefined) {
        filters.push(eq(partnerServiceRequestsTable.status, query.data.status));
      }
      if (query.data.urgency !== undefined) {
        filters.push(eq(partnerServiceRequestsTable.urgency, query.data.urgency));
      }
      if (query.data.vehicleId !== undefined) {
        filters.push(eq(partnerServiceRequestsTable.vehicleId, query.data.vehicleId));
      }
      if (query.data.locationId !== undefined) {
        filters.push(eq(partnerServiceRequestsTable.locationId, query.data.locationId));
      }
      if (query.data.q !== undefined) {
        const search = escapedSearch(query.data.q);
        filters.push(
          or(
            ilike(partnerServiceRequestsTable.requestedWork, search),
            ilike(partnerServiceRequestsTable.serviceNotes, search),
          )!,
        );
      }
      const requests = await db
        .select()
        .from(partnerServiceRequestsTable)
        .where(and(...filters))
        .orderBy(desc(partnerServiceRequestsTable.createdAt))
        .limit(query.data.limit ?? 50);
      res.json(ListPartnerServiceRequestsResponse.parse(requests.map(formatRequest)));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/partner-organizations/:organizationId/service-requests",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requiredId(req.params.organizationId, "organizationId", res);
    if (organizationId === null) return;
    if (hasUnknownFields(req.body, CREATE_FIELDS)) {
      res.status(400).json({ error: "Unknown service request field" });
      return;
    }
    const parsed = CreatePartnerServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const value = parsed.data;
    const operationId = positiveSafeInteger(value.operationId);
    const locationId = positiveSafeInteger(value.locationId);
    const requestedWork = value.requestedWork.trim();
    const clientRequestId = value.clientRequestId.trim();
    if (operationId === null || locationId === null || requestedWork.length === 0 || clientRequestId.length === 0) {
      res.status(400).json({ error: "operationId, locationId, requestedWork, and clientRequestId are valid non-empty values" });
      return;
    }
    const serviceNotes =
      value.serviceNotes === null || value.serviceNotes === undefined
        ? null
        : value.serviceNotes;
    const fingerprint = createFingerprint({
      operationId,
      locationId,
      category: value.category,
      urgency: value.urgency,
      requestedWork,
      serviceNotes,
    });
    try {
      const result = await db.transaction(async (tx) => {
        const organization = await lockOrganization(tx, organizationId, req.userId!);
        if (organization.status !== "active") {
          throw new ServiceRequestError("ORGANIZATION_INACTIVE");
        }

        const existingRows = await tx
          .select()
          .from(partnerServiceRequestsTable)
          .where(
            and(
              eq(partnerServiceRequestsTable.organizationId, organizationId),
              eq(partnerServiceRequestsTable.clientRequestId, clientRequestId),
            ),
          );
        const existing = existingRows[0];
        if (existing) {
          if (existing.creationFingerprint !== fingerprint) {
            throw new ServiceRequestError("IDEMPOTENCY_CONFLICT");
          }
          return { request: existing, replay: true };
        }

        const { operation, vehicle } = await lockOperationAndVehicle(
          tx,
          organizationId,
          operationId,
        );
        await lockLocation(tx, organizationId, req.userId!, locationId);
        const capturedAt = new Date();
        const creationContext = formatCreationContext(
          organization.subtype,
          vehicle,
          operation,
          capturedAt,
        );
        const [request] = await tx
          .insert(partnerServiceRequestsTable)
          .values({
            organizationId,
            operationId,
            vehicleId: operation.vehicleId,
            sourceSubtype: organization.subtype,
            locationId,
            status: "draft",
            category: value.category,
            urgency: value.urgency,
            requestedWork,
            serviceNotes,
            creationContext,
            clientRequestId,
            creationFingerprint: fingerprint,
            version: 0,
          })
          .returning();
        if (!request) throw new Error("Service request insert did not return a row");
        await tx.insert(partnerServiceRequestStatusHistoryTable).values({
          requestId: request.id,
          actorUserId: req.userId!,
          fromStatus: null,
          toStatus: "draft",
          note: null,
        });
        return { request, replay: false };
      });
      const response = CreatePartnerServiceRequestResponse.parse(formatRequest(result.request));
      res.status(result.replay ? 200 : 201).json(response);
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Service request idempotency key is already in use" });
        return;
      }
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/partner-organizations/:organizationId/service-requests/:requestId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const path = requestPath(req, res);
    if (!path) return;
    const parsed = GetPartnerServiceRequestParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const detail = await db.transaction(
        async (tx) => {
          const [organization] = await tx
            .select()
            .from(partnerOrganizationsTable)
            .where(
              and(
                eq(partnerOrganizationsTable.id, path.organizationId),
                eq(partnerOrganizationsTable.primaryOwnerId, req.userId!),
              ),
            );
          if (!organization) throw new ServiceRequestError("ORGANIZATION_NOT_FOUND");
          if (!isServiceRequestSubtype(organization.subtype)) {
            throw new ServiceRequestError("ORGANIZATION_UNSUPPORTED");
          }

          const [request] = await tx
            .select()
            .from(partnerServiceRequestsTable)
            .where(
              and(
                eq(partnerServiceRequestsTable.organizationId, path.organizationId),
                eq(partnerServiceRequestsTable.id, path.requestId),
              ),
            );
          if (!request) throw new ServiceRequestError("REQUEST_NOT_FOUND");
          const history = await tx
            .select()
            .from(partnerServiceRequestStatusHistoryTable)
            .where(eq(partnerServiceRequestStatusHistoryTable.requestId, request.id))
            .orderBy(
              asc(partnerServiceRequestStatusHistoryTable.createdAt),
              asc(partnerServiceRequestStatusHistoryTable.id),
            );
          return {
            request: formatRequest(request),
            statusHistory: history.map(formatHistory),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      res.json(GetPartnerServiceRequestResponse.parse(detail));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/partner-organizations/:organizationId/service-requests/:requestId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const path = requestPath(req, res);
    if (!path) return;
    const params = UpdatePartnerServiceRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (hasUnknownFields(req.body, UPDATE_FIELDS)) {
      res.status(400).json({ error: "Unknown or immutable service request field" });
      return;
    }
    const parsed = UpdatePartnerServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const value = parsed.data;
    const expectedVersion = nonnegativeSafeInteger(value.expectedVersion);
    if (expectedVersion === null) {
      res.status(400).json({ error: "expectedVersion must be a non-negative safe integer" });
      return;
    }
    if (Object.keys(req.body as object).length <= 1) {
      res.status(400).json({ error: "At least one content field is required" });
      return;
    }
    if (
      value.requestedWork !== undefined &&
      value.requestedWork.trim().length === 0
    ) {
      res.status(400).json({ error: "requestedWork cannot be blank" });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const organization = await lockOrganization(tx, path.organizationId, req.userId!);
        if (organization.status !== "active") {
          throw new ServiceRequestError("ORGANIZATION_INACTIVE");
        }
        await tx.execute(sql`
          SELECT id
          FROM partner_service_requests
          WHERE id = ${path.requestId}
            AND organization_id = ${path.organizationId}
          FOR UPDATE
        `);
        const [current] = await tx
          .select()
          .from(partnerServiceRequestsTable)
          .where(
            and(
              eq(partnerServiceRequestsTable.id, path.requestId),
              eq(partnerServiceRequestsTable.organizationId, path.organizationId),
            ),
          );
        if (!current) throw new ServiceRequestError("REQUEST_NOT_FOUND");
        if (current.version !== expectedVersion) {
          throw new ServiceRequestError("STALE_VERSION");
        }
        if (current.status === "completed" || current.status === "cancelled") {
          throw new ServiceRequestError("TERMINAL_REQUEST");
        }
        if (current.status !== "draft" && current.status !== "submitted") {
          throw new ServiceRequestError("INVALID_TRANSITION");
        }
        const association = await lockOperationAndVehicle(
          tx,
          path.organizationId,
          current.operationId,
        );
        if (association.operation.vehicleId !== current.vehicleId) {
          throw new ServiceRequestError("REQUEST_NOT_FOUND");
        }
        if (value.locationId !== undefined) {
          const locationId = positiveSafeInteger(value.locationId);
          if (locationId === null) {
            throw new ServiceRequestError("LOCATION_NOT_FOUND");
          }
          await lockLocation(tx, path.organizationId, req.userId!, locationId);
        } else {
          await lockLocation(
            tx,
            path.organizationId,
            req.userId!,
            current.locationId,
          );
        }
        const updates: Partial<typeof partnerServiceRequestsTable.$inferInsert> = {
          version: current.version + 1,
          updatedAt: new Date(),
        };
        if (value.category !== undefined) updates.category = value.category;
        if (value.urgency !== undefined) updates.urgency = value.urgency;
        if (value.requestedWork !== undefined) updates.requestedWork = value.requestedWork.trim();
        if (value.serviceNotes !== undefined) updates.serviceNotes = value.serviceNotes;
        if (value.locationId !== undefined) updates.locationId = value.locationId;
        const [next] = await tx
          .update(partnerServiceRequestsTable)
          .set(updates)
          .where(
            and(
              eq(partnerServiceRequestsTable.id, path.requestId),
              eq(partnerServiceRequestsTable.organizationId, path.organizationId),
              eq(partnerServiceRequestsTable.version, expectedVersion),
            ),
          )
          .returning();
        if (!next) throw new ServiceRequestError("STALE_VERSION");
        return next;
      });
      res.json(UpdatePartnerServiceRequestResponse.parse(formatRequest(updated)));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/partner-organizations/:organizationId/service-requests/:requestId/transition",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const path = requestPath(req, res);
    if (!path) return;
    const params = TransitionPartnerServiceRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (hasUnknownFields(req.body, TRANSITION_FIELDS)) {
      res.status(400).json({ error: "Unknown service request transition field" });
      return;
    }
    const parsed = TransitionPartnerServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const expectedVersion = nonnegativeSafeInteger(parsed.data.expectedVersion);
    if (expectedVersion === null) {
      res.status(400).json({ error: "expectedVersion must be a non-negative safe integer" });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const organization = await lockOrganization(tx, path.organizationId, req.userId!);
        if (organization.status !== "active") {
          throw new ServiceRequestError("ORGANIZATION_INACTIVE");
        }
        await tx.execute(sql`
          SELECT id
          FROM partner_service_requests
          WHERE id = ${path.requestId}
            AND organization_id = ${path.organizationId}
          FOR UPDATE
        `);
        const [current] = await tx
          .select()
          .from(partnerServiceRequestsTable)
          .where(
            and(
              eq(partnerServiceRequestsTable.id, path.requestId),
              eq(partnerServiceRequestsTable.organizationId, path.organizationId),
            ),
          );
        if (!current) throw new ServiceRequestError("REQUEST_NOT_FOUND");
        if (current.version !== expectedVersion) {
          throw new ServiceRequestError("STALE_VERSION");
        }
        if (current.status === "completed" || current.status === "cancelled") {
          throw new ServiceRequestError("TERMINAL_REQUEST");
        }
        const association = await lockOperationAndVehicle(
          tx,
          path.organizationId,
          current.operationId,
        );
        if (association.operation.vehicleId !== current.vehicleId) {
          throw new ServiceRequestError("REQUEST_NOT_FOUND");
        }
        await lockLocation(
          tx,
          path.organizationId,
          req.userId!,
          current.locationId,
        );
        const nextStatus = parsed.data.toStatus as ServiceRequestStatus;
        const allowed =
          (current.status === "draft" && (nextStatus === "submitted" || nextStatus === "cancelled")) ||
          (current.status === "submitted" && (nextStatus === "in_progress" || nextStatus === "cancelled")) ||
          (current.status === "in_progress" && (nextStatus === "completed" || nextStatus === "cancelled"));
        if (!allowed) throw new ServiceRequestError("INVALID_TRANSITION");
        const now = new Date();
        const updates: Partial<typeof partnerServiceRequestsTable.$inferInsert> = {
          status: nextStatus,
          version: current.version + 1,
          updatedAt: now,
        };
        if (nextStatus === "submitted") updates.submittedAt = now;
        if (nextStatus === "in_progress") updates.startedAt = now;
        if (nextStatus === "completed") updates.completedAt = now;
        if (nextStatus === "cancelled") updates.cancelledAt = now;
        const [next] = await tx
          .update(partnerServiceRequestsTable)
          .set(updates)
          .where(
            and(
              eq(partnerServiceRequestsTable.id, path.requestId),
              eq(partnerServiceRequestsTable.organizationId, path.organizationId),
              eq(partnerServiceRequestsTable.version, expectedVersion),
            ),
          )
          .returning();
        if (!next) throw new ServiceRequestError("STALE_VERSION");
        await tx.insert(partnerServiceRequestStatusHistoryTable).values({
          requestId: next.id,
          actorUserId: req.userId!,
          fromStatus: current.status,
          toStatus: nextStatus,
          note: parsed.data.note ?? null,
        });
        return next;
      });
      res.json(TransitionPartnerServiceRequestResponse.parse(formatRequest(updated)));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

export default router;