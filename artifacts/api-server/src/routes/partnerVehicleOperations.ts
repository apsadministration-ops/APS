import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  partnerOrganizationsTable,
  partnerVehicleOperationsTable,
  shopsTable,
  vehiclesTable,
  ownershipTable,
} from "@workspace/db";
import {
  CreatePartnerVehicleOperationBody,
  GetPartnerVehicleOperationParams,
  GetPartnerVehicleOperationResponse,
  LinkPartnerVehicleOperationBody,
  ListPartnerVehicleOperationsParams,
  ListPartnerVehicleOperationsResponse,
  UpdatePartnerVehicleOperationBody,
  UpdatePartnerVehicleOperationParams,
  UpdatePartnerVehicleOperationResponse,
} from "@workspace/api-zod";
import {
  authenticate,
  requireShopOwner,
  type AuthRequest,
} from "../middlewares/authenticate";

const router: IRouter = Router();

const CREATE_COMMON_FIELDS = new Set([
  "linkedShopId",
  "vin",
  "plateNumber",
  "make",
  "model",
  "year",
  "trim",
  "color",
  "mileage",
  "insuranceCarrier",
  "insurancePolicyNumber",
]);
const DEALERSHIP_FIELDS = new Set([
  "stockNumber",
  "inventoryStatus",
  "serviceNeeded",
  "serviceNotes",
]);
const FLEET_FIELDS = new Set([
  "unitNumber",
  "groupName",
  "operatingStatus",
  "odometer",
  "usageHours",
  "maintenanceDueDate",
  "maintenanceDueMileage",
  "downtimeSince",
  "notes",
]);
const LINK_FIELDS = new Set([
  "vehicleId",
  "linkedShopId",
  ...Array.from(DEALERSHIP_FIELDS),
  ...Array.from(FLEET_FIELDS),
]);
const UPDATE_FIELDS = new Set([
  "linkedShopId",
  ...Array.from(DEALERSHIP_FIELDS),
  ...Array.from(FLEET_FIELDS),
]);

type OperationSubtype = "dealership" | "fleet";
type OperationInput = Record<string, unknown>;

class OperationError extends Error {
  constructor(
    readonly code:
      | "ORGANIZATION_NOT_FOUND"
      | "ORGANIZATION_UNSUPPORTED"
      | "ORGANIZATION_INACTIVE"
      | "LOCATION_NOT_FOUND"
      | "LOCATION_INACTIVE"
      | "VEHICLE_NOT_FOUND"
      | "VIN_ALREADY_REGISTERED"
      | "VEHICLE_ALREADY_LINKED"
      | "LEGACY_PROOF_FAILED"
      | "SUBTYPE_CHANGED",
  ) {
    super(code);
  }
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

function hasUnknownFields(
  value: unknown,
  allowed: Set<string>,
): value is OperationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value).some((key) => !allowed.has(key));
}

function requireOrganizationId(
  value: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): number | null {
  const organizationId = positiveSafeInteger(value);
  if (organizationId === null) {
    res
      .status(400)
      .json({ error: "organizationId must be a positive safe integer" });
  }
  return organizationId;
}

function requireOperationId(
  value: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): number | null {
  const operationId = positiveSafeInteger(value);
  if (operationId === null) {
    res
      .status(400)
      .json({ error: "operationId must be a positive safe integer" });
  }
  return operationId;
}

function subtypeFields(subtype: OperationSubtype): Set<string> {
  return subtype === "dealership" ? DEALERSHIP_FIELDS : FLEET_FIELDS;
}

function validateSubtypeFields(
  value: OperationInput,
  subtype: OperationSubtype,
  mode: "create" | "link" | "update",
): string | null {
  const activeFields = subtypeFields(subtype);
  const irrelevantFields =
    subtype === "dealership" ? FLEET_FIELDS : DEALERSHIP_FIELDS;
  for (const field of irrelevantFields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      return `${field} is not valid for a ${subtype} organization`;
    }
  }

  if (mode === "update") {
    const mutableFields = Array.from(activeFields).filter((field) =>
      Object.prototype.hasOwnProperty.call(value, field),
    );
    if (
      !Object.prototype.hasOwnProperty.call(value, "linkedShopId") &&
      mutableFields.length === 0
    ) {
      return "At least one operation field is required";
    }
    if (subtype === "dealership") {
      if (value.stockNumber === null || value.inventoryStatus === null) {
        return "stockNumber and inventoryStatus cannot be cleared";
      }
      if (
        Object.prototype.hasOwnProperty.call(value, "serviceNeeded") &&
        typeof value.serviceNeeded !== "boolean"
      ) {
        return "serviceNeeded must be a boolean";
      }
    }
    if (subtype === "fleet") {
      if (value.unitNumber === null || value.groupName === null || value.operatingStatus === null) {
        return "unitNumber, groupName, and operatingStatus cannot be cleared";
      }
    }
    return null;
  }

  if (subtype === "dealership") {
    if (typeof value.stockNumber !== "string" || value.stockNumber.trim() === "") {
      return "stockNumber is required for a dealership operation";
    }
    if (
      !["in_stock", "preparing", "ready", "sold"].includes(
        String(value.inventoryStatus),
      )
    ) {
      return "inventoryStatus is required for a dealership operation";
    }
    if (typeof value.serviceNeeded !== "boolean") {
      return "serviceNeeded is required for a dealership operation";
    }
  } else {
    if (typeof value.unitNumber !== "string" || value.unitNumber.trim() === "") {
      return "unitNumber is required for a fleet operation";
    }
    if (typeof value.groupName !== "string" || value.groupName.trim() === "") {
      return "groupName is required for a fleet operation";
    }
    if (
      !["active", "maintenance", "out_of_service", "retired"].includes(
        String(value.operatingStatus),
      )
    ) {
      return "operatingStatus is required for a fleet operation";
    }
  }
  return null;
}

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_OPERATION_FIELDS = [
  "year",
  "mileage",
  "odometer",
  "maintenanceDueMileage",
] as const;

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function validateOperationScalarFields(value: OperationInput): string | null {
  for (const field of INTEGER_OPERATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const fieldValue = value[field];
    if (fieldValue === null && field !== "year" && field !== "mileage") continue;
    if (!Number.isSafeInteger(fieldValue)) {
      return `${field} must be an integer`;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "maintenanceDueDate") &&
    value.maintenanceDueDate !== null &&
    !isValidCalendarDate(value.maintenanceDueDate)
  ) {
    return "maintenanceDueDate must be a valid YYYY-MM-DD calendar date";
  }
  return null;
}

function asCalendarDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

function asTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatOperation(
  operation: typeof partnerVehicleOperationsTable.$inferSelect,
  vehicle: typeof vehiclesTable.$inferSelect,
) {
  return {
    id: operation.id,
    organizationId: operation.organizationId,
    vehicleId: operation.vehicleId,
    linkedShopId: operation.linkedShopId,
    vin: vehicle.vin,
    plateNumber: vehicle.plateNumber ?? null,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    trim: vehicle.trim ?? null,
    color: vehicle.color ?? null,
    mileage: vehicle.mileage,
    insuranceCarrier: vehicle.insuranceCarrier ?? null,
    insurancePolicyNumber: vehicle.insurancePolicyNumber ?? null,
    ownerShopId: vehicle.ownerShopId ?? null,
    stockNumber: operation.stockNumber ?? null,
    inventoryStatus: operation.inventoryStatus ?? null,
    serviceNeeded: operation.serviceNeeded ?? null,
    serviceNotes: operation.serviceNotes ?? null,
    unitNumber: operation.unitNumber ?? null,
    groupName: operation.groupName ?? null,
    operatingStatus: operation.operatingStatus ?? null,
    odometer: operation.odometer ?? null,
    usageHours: operation.usageHours ?? null,
    maintenanceDueDate: asCalendarDate(operation.maintenanceDueDate),
    maintenanceDueMileage: operation.maintenanceDueMileage ?? null,
    downtimeSince: operation.downtimeSince ?? null,
    notes: operation.notes ?? null,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

async function ownedOrganization(
  organizationId: number,
  ownerId: number,
  readOnly = false,
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
  if (!organization) throw new OperationError("ORGANIZATION_NOT_FOUND");
  if (organization.subtype !== "dealership" && organization.subtype !== "fleet") {
    throw new OperationError("ORGANIZATION_UNSUPPORTED");
  }
  if (!readOnly && organization.status !== "active") {
    throw new OperationError("ORGANIZATION_INACTIVE");
  }
  return organization;
}

async function loadOperation(
  organizationId: number,
  operationId: number,
) {
  const [row] = await db
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
  return row;
}

function errorResponse(error: unknown, res: { status(code: number): { json(body: unknown): unknown } }): boolean {
  if (!(error instanceof OperationError)) return false;
  switch (error.code) {
    case "ORGANIZATION_NOT_FOUND":
    case "LOCATION_NOT_FOUND":
    case "VEHICLE_NOT_FOUND":
      res.status(404).json({ error: "Partner resource not found" });
      return true;
    case "ORGANIZATION_UNSUPPORTED":
      res.status(403).json({ error: "Vehicle operations are not available for this organization subtype" });
      return true;
    case "ORGANIZATION_INACTIVE":
      res.status(409).json({ error: "Inactive organizations cannot write vehicle operations" });
      return true;
    case "LOCATION_INACTIVE":
      res.status(409).json({ error: "Vehicle operation location must be active" });
      return true;
    case "VIN_ALREADY_REGISTERED":
      res.status(409).json({ error: "VIN is already registered; use the explicit legacy link endpoint" });
      return true;
    case "VEHICLE_ALREADY_LINKED":
      res.status(409).json({ error: "Vehicle is already linked to a partner organization" });
      return true;
    case "LEGACY_PROOF_FAILED":
      res.status(409).json({ error: "Existing vehicle does not satisfy safe legacy-import proof" });
      return true;
    case "SUBTYPE_CHANGED":
      res.status(409).json({ error: "Organization subtype changed; retry the vehicle operation" });
      return true;
  }
}

async function loadWritableOrganization(
  organizationId: number,
  ownerId: number,
): Promise<typeof partnerOrganizationsTable.$inferSelect> {
  return ownedOrganization(organizationId, ownerId);
}

router.get(
  "/partner-organizations/:organizationId/vehicle-operations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const params = ListPartnerVehicleOperationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await ownedOrganization(organizationId, req.userId!, true);
      const rows = await db
        .select({
          operation: partnerVehicleOperationsTable,
          vehicle: vehiclesTable,
        })
        .from(partnerVehicleOperationsTable)
        .innerJoin(
          vehiclesTable,
          eq(partnerVehicleOperationsTable.vehicleId, vehiclesTable.id),
        )
        .where(eq(partnerVehicleOperationsTable.organizationId, organizationId));
      res.json(
        ListPartnerVehicleOperationsResponse.parse(
          rows.map((row) => formatOperation(row.operation, row.vehicle)),
        ),
      );
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/partner-organizations/:organizationId/vehicle-operations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const parsed = CreatePartnerVehicleOperationBody.safeParse(req.body);
    if (!parsed.success || hasUnknownFields(req.body, new Set([...CREATE_COMMON_FIELDS, ...DEALERSHIP_FIELDS, ...FLEET_FIELDS]))) {
      res.status(400).json({ error: parsed.success ? "Unknown vehicle operation field" : parsed.error.message });
      return;
    }
    const value = parsed.data as OperationInput;
    const scalarError = validateOperationScalarFields(value);
    if (scalarError) {
      res.status(400).json({ error: scalarError });
      return;
    }
    try {
      const organization = await loadWritableOrganization(organizationId, req.userId!);
      const subtype = organization.subtype as OperationSubtype;
      const subtypeError = validateSubtypeFields(value, subtype, "create");
      if (subtypeError) {
        res.status(400).json({ error: subtypeError });
        return;
      }
      const linkedShopId = positiveSafeInteger(value.linkedShopId);
      if (linkedShopId === null) {
        res.status(400).json({ error: "linkedShopId must be a positive safe integer" });
        return;
      }
      const vin = typeof value.vin === "string" ? value.vin.trim().toUpperCase() : "";
      if (vin.length !== 17) {
        res.status(400).json({ error: "VIN must be exactly 17 characters" });
        return;
      }

      const created = await db.transaction(async (tx) => {
        const lockedOrganizationRows = await tx.execute(sql`
          SELECT id, subtype, status
          FROM partner_organizations
          WHERE id = ${organizationId}
            AND primary_owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const lockedOrganization = lockedOrganizationRows.rows[0] as
          | { id: number; subtype: OperationSubtype; status: string }
          | undefined;
        if (!lockedOrganization) throw new OperationError("ORGANIZATION_NOT_FOUND");
        if (lockedOrganization.subtype !== "dealership" && lockedOrganization.subtype !== "fleet") {
          throw new OperationError("ORGANIZATION_UNSUPPORTED");
        }
        if (lockedOrganization.status !== "active") {
          throw new OperationError("ORGANIZATION_INACTIVE");
        }
        if (lockedOrganization.subtype !== subtype) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        if (validateSubtypeFields(value, lockedOrganization.subtype, "create")) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        const locationRows = await tx.execute(sql`
          SELECT id, status
          FROM shops
          WHERE id = ${linkedShopId}
            AND organization_id = ${organizationId}
            AND owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const location = locationRows.rows[0] as { id: number; status: string } | undefined;
        if (!location) throw new OperationError("LOCATION_NOT_FOUND");
        if (location.status !== "active") throw new OperationError("LOCATION_INACTIVE");

        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(lower(${vin}), 0)
          )
        `);
        const existingRows = await tx.execute(sql`
          SELECT id
          FROM vehicles
          WHERE lower(vin) = lower(${vin})
          FOR UPDATE
        `);
        if (existingRows.rows[0]) throw new OperationError("VIN_ALREADY_REGISTERED");

        const [vehicle] = await tx
          .insert(vehiclesTable)
          .values({
            vin,
            plateNumber: typeof value.plateNumber === "string" ? value.plateNumber.trim().toUpperCase() : null,
            make: String(value.make),
            model: String(value.model),
            year: Number(value.year),
            trim: typeof value.trim === "string" ? value.trim : null,
            color: typeof value.color === "string" ? value.color : null,
            mileage: Number(value.mileage),
            insuranceCarrier: typeof value.insuranceCarrier === "string" ? value.insuranceCarrier : null,
            insurancePolicyNumber: typeof value.insurancePolicyNumber === "string" ? value.insurancePolicyNumber : null,
            ownerShopId: linkedShopId,
          })
          .returning();
        if (!vehicle) throw new Error("Vehicle insert did not return a row");

        const [operation] = await tx
          .insert(partnerVehicleOperationsTable)
          .values(operationValues(value, organizationId, vehicle.id, linkedShopId, lockedOrganization.subtype))
          .returning();
        if (!operation) throw new Error("Operation insert did not return a row");
        return { operation, vehicle };
      });
      res
        .status(201)
        .json(GetPartnerVehicleOperationResponse.parse(formatOperation(created.operation, created.vehicle)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "VIN or vehicle operation is already registered" });
        return;
      }
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/partner-organizations/:organizationId/vehicle-operations/link",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const parsed = LinkPartnerVehicleOperationBody.safeParse(req.body);
    if (!parsed.success || hasUnknownFields(req.body, LINK_FIELDS)) {
      res.status(400).json({ error: parsed.success ? "Unknown vehicle operation field" : parsed.error.message });
      return;
    }
    const value = parsed.data as OperationInput;
    const scalarError = validateOperationScalarFields(value);
    if (scalarError) {
      res.status(400).json({ error: scalarError });
      return;
    }
    try {
      const organization = await loadWritableOrganization(organizationId, req.userId!);
      const subtype = organization.subtype as OperationSubtype;
      const subtypeError = validateSubtypeFields(value, subtype, "link");
      if (subtypeError) {
        res.status(400).json({ error: subtypeError });
        return;
      }
      const linkedShopId = positiveSafeInteger(value.linkedShopId);
      const vehicleId = positiveSafeInteger(value.vehicleId);
      if (linkedShopId === null || vehicleId === null) {
        res.status(400).json({ error: "vehicleId and linkedShopId must be positive safe integers" });
        return;
      }
      const linked = await db.transaction(async (tx) => {
        const organizationRows = await tx.execute(sql`
          SELECT id, subtype, status
          FROM partner_organizations
          WHERE id = ${organizationId}
            AND primary_owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const lockedOrganization = organizationRows.rows[0] as
          | { id: number; subtype: OperationSubtype; status: string }
          | undefined;
        if (!lockedOrganization) throw new OperationError("ORGANIZATION_NOT_FOUND");
        if (lockedOrganization.subtype !== "dealership" && lockedOrganization.subtype !== "fleet") {
          throw new OperationError("ORGANIZATION_UNSUPPORTED");
        }
        if (lockedOrganization.status !== "active") {
          throw new OperationError("ORGANIZATION_INACTIVE");
        }
        if (lockedOrganization.subtype !== subtype) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        if (validateSubtypeFields(value, lockedOrganization.subtype, "link")) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        const locationRows = await tx.execute(sql`
          SELECT id, status
          FROM shops
          WHERE id = ${linkedShopId}
            AND organization_id = ${organizationId}
            AND owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const location = locationRows.rows[0] as { id: number; status: string } | undefined;
        if (!location) throw new OperationError("LOCATION_NOT_FOUND");
        if (location.status !== "active") throw new OperationError("LOCATION_INACTIVE");

        const vehicleIdentityRows = await tx.execute(sql`
          SELECT vin
          FROM vehicles
          WHERE id = ${vehicleId}
        `);
        const vehicleIdentity = vehicleIdentityRows.rows[0] as { vin: string } | undefined;
        if (!vehicleIdentity) throw new OperationError("VEHICLE_NOT_FOUND");
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(lower(${vehicleIdentity.vin}), 0)
          )
        `);
        const vehicleRows = await tx.execute(sql`
          SELECT id
          FROM vehicles
          WHERE id = ${vehicleId}
          FOR UPDATE
        `);
        const vehicleKey = vehicleRows.rows[0] as { id: number } | undefined;
        const [vehicle] = vehicleKey
          ? await tx
              .select()
              .from(vehiclesTable)
              .where(eq(vehiclesTable.id, vehicleKey.id))
          : [];
        if (!vehicle) throw new OperationError("VEHICLE_NOT_FOUND");
        if (vehicle.ownerShopId !== linkedShopId) {
          throw new OperationError("LEGACY_PROOF_FAILED");
        }
        const activeOwnerships = await tx
          .select()
          .from(ownershipTable)
          .where(
            and(
              eq(ownershipTable.vehicleId, vehicleId),
              isNull(ownershipTable.endDate),
            ),
          );
        // Legacy POST /vehicles for a shop_owner may have created an
        // ownership_history row for this same authenticated owner. That row
        // is safe proof only when the ownerShopId/location proof above also
        // matches. Never import a vehicle with an active foreign owner.
        if (activeOwnerships.some((ownership) => ownership.userId !== req.userId)) {
          throw new OperationError("LEGACY_PROOF_FAILED");
        }
        const [existingOperation] = await tx
          .select()
          .from(partnerVehicleOperationsTable)
          .where(eq(partnerVehicleOperationsTable.vehicleId, vehicleId));
        if (existingOperation) throw new OperationError("VEHICLE_ALREADY_LINKED");
        const [operation] = await tx
          .insert(partnerVehicleOperationsTable)
          .values(operationValues(value, organizationId, vehicleId, linkedShopId, lockedOrganization.subtype))
          .returning();
        if (!operation) throw new Error("Operation insert did not return a row");
        return { operation, vehicle };
      });
      res
        .status(201)
        .json(GetPartnerVehicleOperationResponse.parse(formatOperation(linked.operation, linked.vehicle)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Vehicle is already linked to a partner organization" });
        return;
      }
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/partner-organizations/:organizationId/vehicle-operations/:operationId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    const operationId = requireOperationId(req.params.operationId, res);
    if (organizationId === null || operationId === null) return;
    const params = GetPartnerVehicleOperationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await ownedOrganization(organizationId, req.userId!, true);
      const row = await loadOperation(organizationId, operationId);
      if (!row) {
        res.status(404).json({ error: "Vehicle operation not found" });
        return;
      }
      res.json(GetPartnerVehicleOperationResponse.parse(formatOperation(row.operation, row.vehicle)));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/partner-organizations/:organizationId/vehicle-operations/:operationId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    const operationId = requireOperationId(req.params.operationId, res);
    if (organizationId === null || operationId === null) return;
    const params = UpdatePartnerVehicleOperationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdatePartnerVehicleOperationBody.safeParse(req.body);
    if (!parsed.success || hasUnknownFields(req.body, UPDATE_FIELDS)) {
      res.status(400).json({ error: parsed.success ? "Unknown vehicle operation field" : parsed.error.message });
      return;
    }
    const value = parsed.data as OperationInput;
    const scalarError = validateOperationScalarFields(value);
    if (scalarError) {
      res.status(400).json({ error: scalarError });
      return;
    }
    try {
      const organization = await loadWritableOrganization(organizationId, req.userId!);
      const subtype = organization.subtype as OperationSubtype;
      const subtypeError = validateSubtypeFields(value, subtype, "update");
      if (subtypeError) {
        res.status(400).json({ error: subtypeError });
        return;
      }
      const updated = await db.transaction(async (tx) => {
        const organizationRows = await tx.execute(sql`
          SELECT id, subtype, status
          FROM partner_organizations
          WHERE id = ${organizationId}
            AND primary_owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const lockedOrganization = organizationRows.rows[0] as
          | { id: number; subtype: OperationSubtype; status: string }
          | undefined;
        if (!lockedOrganization) throw new OperationError("ORGANIZATION_NOT_FOUND");
        if (lockedOrganization.subtype !== "dealership" && lockedOrganization.subtype !== "fleet") {
          throw new OperationError("ORGANIZATION_UNSUPPORTED");
        }
        if (lockedOrganization.status !== "active") {
          throw new OperationError("ORGANIZATION_INACTIVE");
        }
        if (lockedOrganization.subtype !== subtype) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        if (validateSubtypeFields(value, lockedOrganization.subtype, "update")) {
          throw new OperationError("SUBTYPE_CHANGED");
        }
        await tx.execute(sql`
          SELECT id
          FROM partner_vehicle_operations
          WHERE id = ${operationId}
            AND organization_id = ${organizationId}
          FOR UPDATE
        `);
        const [operation] = await tx
          .select()
          .from(partnerVehicleOperationsTable)
          .where(
            and(
              eq(partnerVehicleOperationsTable.id, operationId),
              eq(partnerVehicleOperationsTable.organizationId, organizationId),
            ),
          );
        if (!operation) throw new OperationError("VEHICLE_NOT_FOUND");
        const [vehicle] = await tx
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.id, operation.vehicleId));
        if (!vehicle) throw new OperationError("VEHICLE_NOT_FOUND");

        const nextShopId = Object.prototype.hasOwnProperty.call(value, "linkedShopId")
          ? positiveSafeInteger(value.linkedShopId)
          : operation.linkedShopId;
        if (nextShopId === null) {
          throw new OperationError("LOCATION_NOT_FOUND");
        }
        const locationRows = await tx.execute(sql`
          SELECT id, status
          FROM shops
          WHERE id = ${nextShopId}
            AND organization_id = ${organizationId}
            AND owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const location = locationRows.rows[0] as { id: number; status: string } | undefined;
        if (!location) throw new OperationError("LOCATION_NOT_FOUND");
        if (location.status !== "active") throw new OperationError("LOCATION_INACTIVE");

        const updates = operationValues(
          value,
          organizationId,
          operation.vehicleId,
          nextShopId,
          lockedOrganization.subtype,
          true,
        );
        const [nextOperation] = await tx
          .update(partnerVehicleOperationsTable)
          .set(updates)
          .where(
            and(
              eq(partnerVehicleOperationsTable.id, operationId),
              eq(partnerVehicleOperationsTable.organizationId, organizationId),
            ),
          )
          .returning();
        if (!nextOperation) throw new OperationError("VEHICLE_NOT_FOUND");

        // New registry vehicles and safe legacy imports start with ownerShopId
        // equal to their operation location. Synchronize that safe denormalized
        // value on a move; preserve any inconsistent legacy value and use the
        // operation location as the authoritative source instead.
        if (vehicle.ownerShopId === operation.linkedShopId) {
          await tx
            .update(vehiclesTable)
            .set({ ownerShopId: nextShopId })
            .where(eq(vehiclesTable.id, vehicle.id));
          vehicle.ownerShopId = nextShopId;
        }
        return { operation: nextOperation, vehicle };
      });
      res.json(UpdatePartnerVehicleOperationResponse.parse(formatOperation(updated.operation, updated.vehicle)));
    } catch (error) {
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

function operationValues(
  value: OperationInput,
  organizationId: number,
  vehicleId: number,
  linkedShopId: number,
  subtype: OperationSubtype,
  patch = false,
) {
  const fields: Record<string, unknown> = {
    organizationId,
    vehicleId,
    linkedShopId,
  };
  const activeFields = subtypeFields(subtype);
  for (const field of activeFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      if (!patch) fields[field] = null;
      continue;
    }
    const fieldValue = value[field];
    if (field === "maintenanceDueDate") {
      fields[field] = asCalendarDate(fieldValue);
    } else if (field === "downtimeSince") {
      fields[field] = asTimestamp(fieldValue);
    } else {
      fields[field] = fieldValue;
    }
  }
  if (subtype === "dealership" && !patch && fields.serviceNotes === undefined) {
    fields.serviceNotes = null;
  }
  return fields as typeof partnerVehicleOperationsTable.$inferInsert;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export default router;