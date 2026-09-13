import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  jobsTable,
  partnerOrganizationsTable,
  partnerServiceRequestsTable,
  partnerVehicleOperationsTable,
  shopsTable,
  vehiclesTable,
  usersTable,
} from "@workspace/db";
import { findServiceBySlug, type ServiceCategory } from "@workspace/tier-catalog";
import { authenticate, requireShopOwner, type AuthRequest } from "../middlewares/authenticate";
import { notifyMechanics } from "../lib/notifications";
import { formatJob } from "./jobs";
import { resolvePartnerJobPolicy } from "./partnerJobs";

const router: IRouter = Router();

const SEND_FIELDS = new Set(["expectedVersion", "serviceSlug", "jobType"]);
const SERVICE_CATEGORIES = new Set<ServiceCategory>([
  "repair",
  "diagnostic",
  "maintenance",
  "detailing",
]);

type SendBody = {
  expectedVersion?: unknown;
  serviceSlug?: unknown;
  jobType?: unknown;
};

class CommercialBridgeError extends Error {
  constructor(
    readonly code:
      | "ORGANIZATION_NOT_FOUND"
      | "ORGANIZATION_UNSUPPORTED"
      | "ORGANIZATION_INACTIVE"
      | "REQUEST_NOT_FOUND"
      | "REQUEST_NOT_SUBMITTED"
      | "STALE_VERSION"
      | "INVALID_SERVICE"
      | "OPERATION_INACTIVE"
      | "LOCATION_INVALID"
      | "IDEMPOTENCY_CONFLICT",
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

function nonnegativeSafeInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function hasUnknownFields(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value).some((key) => !SEND_FIELDS.has(key));
}

function requestFingerprint(input: {
  requestId: number;
  expectedVersion: number;
  serviceSlug: string | null;
  jobType: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function errorResponse(
  error: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): boolean {
  if (!(error instanceof CommercialBridgeError)) return false;
  switch (error.code) {
    case "ORGANIZATION_NOT_FOUND":
    case "REQUEST_NOT_FOUND":
      res.status(404).json({ error: "Commercial service request resource not found" });
      return true;
    case "ORGANIZATION_UNSUPPORTED":
      res.status(403).json({
        error: "Send to APS is available only to dealership and fleet organizations",
      });
      return true;
    case "ORGANIZATION_INACTIVE":
      res.status(409).json({ error: "Inactive organizations cannot send requests to APS" });
      return true;
    case "REQUEST_NOT_SUBMITTED":
      res.status(409).json({ error: "Only submitted service requests can be sent to APS" });
      return true;
    case "STALE_VERSION":
      res.status(409).json({ error: "Service request version is stale; reload and retry" });
      return true;
    case "INVALID_SERVICE":
      res.status(400).json({ error: "Choose a valid catalog service or job type" });
      return true;
    case "OPERATION_INACTIVE":
      res.status(409).json({ error: "The registered vehicle operation is not active" });
      return true;
    case "LOCATION_INVALID":
      res.status(409).json({ error: "The linked APS location must be active and owner-linked" });
      return true;
    case "IDEMPOTENCY_CONFLICT":
      res.status(409).json({ error: "This service request was already sent with different APS options" });
      return true;
  }
}

function formatRequestLink(
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
    linkedApsJobId: request.linkedApsJobId ?? null,
    linkedAt: request.linkedAt ?? null,
  };
}

function fallbackJobType(category: string, requested: unknown): ServiceCategory | null {
  if (typeof requested === "string" && SERVICE_CATEGORIES.has(requested as ServiceCategory)) {
    return requested as ServiceCategory;
  }
  switch (category) {
    case "inspection":
      return "diagnostic";
    case "diagnostics":
      return "diagnostic";
    case "maintenance":
      return "maintenance";
    case "repair":
      return "repair";
    case "recall":
      return "repair";
    default:
      return null;
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

router.post(
  "/partner-organizations/:organizationId/service-requests/:requestId/send-to-aps",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = positiveSafeInteger(req.params.organizationId);
    const requestId = positiveSafeInteger(req.params.requestId);
    if (organizationId === null || requestId === null) {
      res.status(400).json({ error: "organizationId and requestId must be positive safe integers" });
      return;
    }
    if (hasUnknownFields(req.body)) {
      res.status(400).json({ error: "Unknown Send to APS field" });
      return;
    }
    const body = (req.body ?? {}) as SendBody;
    const expectedVersion = nonnegativeSafeInteger(body.expectedVersion);
    if (expectedVersion === null) {
      res.status(400).json({ error: "expectedVersion must be a non-negative safe integer" });
      return;
    }
    const serviceSlug =
      body.serviceSlug === undefined || body.serviceSlug === null
        ? null
        : typeof body.serviceSlug === "string" && body.serviceSlug.trim().length > 0
          ? body.serviceSlug.trim()
          : null;
    if (body.serviceSlug !== undefined && body.serviceSlug !== null && serviceSlug === null) {
      res.status(400).json({ error: "serviceSlug must be a non-empty string when supplied" });
      return;
    }
    const requestedJobType = body.jobType === undefined || body.jobType === null
      ? null
      : typeof body.jobType === "string"
        ? body.jobType
        : null;
    if (body.jobType !== undefined && body.jobType !== null && requestedJobType === null) {
      res.status(400).json({ error: "jobType must be a string when supplied" });
      return;
    }
    if (requestedJobType !== null && !SERVICE_CATEGORIES.has(requestedJobType as ServiceCategory)) {
      res.status(400).json({ error: "jobType must be one of repair, diagnostic, maintenance, or detailing" });
      return;
    }
    const fingerprint = requestFingerprint({
      requestId,
      expectedVersion,
      serviceSlug,
      jobType: requestedJobType,
    });

    try {
      const result = await db.transaction(async (tx) => {
        const organizationRows = await tx.execute(sql`
          SELECT id, subtype, status, primary_owner_id
          FROM partner_organizations
          WHERE id = ${organizationId}
            AND primary_owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const organization = organizationRows.rows[0] as
          | { id: number; subtype: string; status: string; primary_owner_id: number }
          | undefined;
        if (!organization) throw new CommercialBridgeError("ORGANIZATION_NOT_FOUND");
        if (organization.subtype !== "dealership" && organization.subtype !== "fleet") {
          throw new CommercialBridgeError("ORGANIZATION_UNSUPPORTED");
        }
        if (organization.status !== "active") {
          throw new CommercialBridgeError("ORGANIZATION_INACTIVE");
        }

        await tx.execute(sql`
          SELECT id
          FROM partner_service_requests
          WHERE id = ${requestId}
            AND organization_id = ${organizationId}
          FOR UPDATE
        `);
        const [request] = await tx
          .select()
          .from(partnerServiceRequestsTable)
          .where(
            and(
              eq(partnerServiceRequestsTable.id, requestId),
              eq(partnerServiceRequestsTable.organizationId, organizationId),
            ),
          );
        if (!request) throw new CommercialBridgeError("REQUEST_NOT_FOUND");
        if (request.linkedApsJobId != null) {
          if (request.sendToApsFingerprint !== fingerprint) {
            throw new CommercialBridgeError("IDEMPOTENCY_CONFLICT");
          }
          const [job] = await tx
            .select()
            .from(jobsTable)
            .where(eq(jobsTable.id, request.linkedApsJobId));
          if (!job) throw new CommercialBridgeError("REQUEST_NOT_FOUND");
          return { request, job, replay: true as const };
        }
        if (request.version !== expectedVersion) {
          throw new CommercialBridgeError("STALE_VERSION");
        }
        if (request.status !== "submitted") {
          throw new CommercialBridgeError("REQUEST_NOT_SUBMITTED");
        }

        const operationRows = await tx.execute(sql`
          SELECT id, vehicle_id, linked_shop_id, inventory_status, operating_status
          FROM partner_vehicle_operations
          WHERE id = ${request.operationId}
            AND organization_id = ${organizationId}
          FOR UPDATE
        `);
        const operation = operationRows.rows[0] as
          | {
              id: number;
              vehicle_id: number;
              linked_shop_id: number;
              inventory_status: string | null;
              operating_status: string | null;
            }
          | undefined;
        if (!operation) throw new CommercialBridgeError("REQUEST_NOT_FOUND");
        if (
          (request.sourceSubtype === "dealership" && operation.inventory_status === "sold") ||
          (request.sourceSubtype === "fleet" && operation.operating_status === "retired")
        ) {
          throw new CommercialBridgeError("OPERATION_INACTIVE");
        }
        await tx.execute(sql`
          SELECT id
          FROM vehicles
          WHERE id = ${operation.vehicle_id}
          FOR UPDATE
        `);
        const [vehicle] = await tx
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.id, operation.vehicle_id));
        if (!vehicle || vehicle.id !== request.vehicleId) {
          throw new CommercialBridgeError("REQUEST_NOT_FOUND");
        }

        await tx.execute(sql`
          SELECT id
          FROM shops
          WHERE id = ${request.locationId}
            AND organization_id = ${organizationId}
            AND owner_id = ${req.userId!}
            AND status = 'active'
          FOR UPDATE
        `);
        const [location] = await tx
          .select()
          .from(shopsTable)
          .where(
            and(
              eq(shopsTable.id, request.locationId),
              eq(shopsTable.organizationId, organizationId),
              eq(shopsTable.ownerId, req.userId!),
              eq(shopsTable.status, "active"),
            ),
          );
        if (!location) throw new CommercialBridgeError("LOCATION_INVALID");
        if (operation.linked_shop_id !== location.id) {
          throw new CommercialBridgeError("LOCATION_INVALID");
        }

        const fallbackType = fallbackJobType(request.category, requestedJobType);
        if (fallbackType === null) {
          throw new CommercialBridgeError("INVALID_SERVICE");
        }
        const policy = resolvePartnerJobPolicy({
          vehicle: { vin: vehicle.vin, make: vehicle.make },
          serviceSlug,
          jobType: fallbackType,
          description: request.requestedWork,
          urgency: request.urgency,
        });
        if ("error" in policy) {
          throw new CommercialBridgeError("INVALID_SERVICE");
        }
        const rawPct = location.commissionOverridePct ?? 15;
        const commissionPctOverride = Math.max(0, Math.min(100, Math.round(rawPct)));
        const [job] = await tx
          .insert(jobsTable)
          .values({
            vehicleId: vehicle.id,
            vin: vehicle.vin,
            customerId: organization.primary_owner_id,
            jobType: policy.finalJobType,
            serviceSlug: policy.catalogEntry?.slug ?? null,
            requiredTier: policy.finalRequiredTier,
            // Only requestedWork is public to mechanics. Organization notes,
            // creation snapshots, and operational codes stay owner-scoped.
            description: request.requestedWork,
            locationLat: location.lat ?? null,
            locationLng: location.lng ?? null,
            locationAddress: `${location.address}, ${location.city}, ${location.region} ${location.zipCode}`,
            estimatedPrice: policy.derivedPrice,
            status: "REQUESTED",
            requiresGhostGarage: policy.ghostGarage,
            customerTransportApproved: !policy.ghostGarage,
            postedByShopId: location.id,
            partnerKindSnapshot: organization.subtype as "dealership" | "fleet",
            urgency: policy.urgency,
            commissionPctOverride,
            juniorVisibleAt: policy.juniorVisibleAt,
            sourceOrganizationId: organizationId,
            sourceServiceRequestId: request.id,
          })
          .returning();
        if (!job) throw new Error("APS job insert did not return a row");
        const [updatedRequest] = await tx
          .update(partnerServiceRequestsTable)
          .set({
            linkedApsJobId: job.id,
            linkedAt: new Date(),
            sendToApsFingerprint: fingerprint,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(partnerServiceRequestsTable.id, request.id),
              eq(partnerServiceRequestsTable.organizationId, organizationId),
              eq(partnerServiceRequestsTable.version, expectedVersion),
              isNull(partnerServiceRequestsTable.linkedApsJobId),
            ),
          )
          .returning();
        if (!updatedRequest) throw new CommercialBridgeError("STALE_VERSION");
        return { request: updatedRequest, job, replay: false as const };
      });

      if (!result.replay) {
        db.select({ pushToken: usersTable.pushToken })
          .from(usersTable)
          .where(eq(usersTable.role, "mechanic"))
          .then((mechanics) => {
            const tokens = mechanics.map((m) => m.pushToken).filter(Boolean) as string[];
            if (tokens.length > 0) {
              notifyMechanics(tokens, result.job.jobType, result.job.description, result.job.id).catch(() => {});
            }
          })
          .catch(() => {});
      }

      res.status(result.replay ? 200 : 201).json({
        request: formatRequestLink(result.request),
        job: await formatJob(result.job),
        replay: result.replay,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Service request APS link already exists; retry the same request" });
        return;
      }
      if (errorResponse(error, res)) return;
      throw error;
    }
  },
);

export default router;