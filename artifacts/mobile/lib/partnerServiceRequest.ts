import type {
  ListPartnerServiceRequestsParams,
  PartnerServiceRequest,
  PartnerServiceRequestCategory,
  PartnerServiceRequestStatus,
  PartnerServiceRequestTransitionInput,
  PartnerServiceRequestUrgency,
  PartnerServiceRequestUpdateInput,
  SendPartnerServiceRequestToApsInputJobType,
} from "@workspace/api-client-react";

export const PARTNER_SERVICE_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "in_progress",
  "completed",
  "cancelled",
] as const satisfies readonly PartnerServiceRequestStatus[];

export const PARTNER_SERVICE_REQUEST_CATEGORIES = [
  "inspection",
  "diagnostics",
  "maintenance",
  "repair",
  "recall",
  "other",
] as const satisfies readonly PartnerServiceRequestCategory[];

export const PARTNER_SERVICE_REQUEST_URGENCIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly PartnerServiceRequestUrgency[];

export const REQUEST_CATEGORY_LABELS: Record<PartnerServiceRequestCategory, string> = {
  inspection: "Inspection",
  diagnostics: "Diagnostics",
  maintenance: "Maintenance",
  repair: "Repair",
  recall: "Recall",
  other: "Other",
};

export const REQUEST_STATUS_LABELS: Record<PartnerServiceRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const REQUEST_URGENCY_LABELS: Record<PartnerServiceRequestUrgency, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const APS_JOB_TYPE_LABELS: Record<
  Exclude<SendPartnerServiceRequestToApsInputJobType, null>,
  string
> = {
  repair: "Repair",
  diagnostic: "Diagnostic",
  maintenance: "Maintenance",
  detailing: "Detailing",
};

/**
 * Categories with a known APS equivalent can be sent without a catalog
 * selection. "Other" deliberately has no implicit mapping and must be
 * resolved by a catalog slug or an explicit fallback job type in the UI.
 */
export function apsJobTypeForRequestCategory(
  category: PartnerServiceRequestCategory,
): Exclude<SendPartnerServiceRequestToApsInputJobType, null> | null {
  switch (category) {
    case "inspection":
    case "diagnostics":
      return "diagnostic";
    case "maintenance":
      return "maintenance";
    case "repair":
    case "recall":
      return "repair";
    case "other":
      return null;
  }
}

const STATUS_TRANSITIONS: Record<PartnerServiceRequestStatus, readonly PartnerServiceRequestStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function requestCanEdit(status: PartnerServiceRequestStatus) {
  return status === "draft" || status === "submitted";
}

export function requestCanTransition(
  fromStatus: PartnerServiceRequestStatus,
  toStatus: PartnerServiceRequestStatus,
) {
  return STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export function requestTransitionOptions(status: PartnerServiceRequestStatus) {
  return STATUS_TRANSITIONS[status].map((toStatus) => ({
    toStatus,
    label:
      toStatus === "submitted"
        ? "Submit request"
        : toStatus === "in_progress"
          ? "Start tracking work"
          : toStatus === "completed"
            ? "Mark request completed"
            : "Cancel request",
  }));
}

export function requestStatusTone(status: PartnerServiceRequestStatus) {
  switch (status) {
    case "draft":
      return "#6B7280";
    case "submitted":
      return "#2563EB";
    case "in_progress":
      return "#D97706";
    case "completed":
      return "#15803D";
    case "cancelled":
      return "#991B1B";
  }
}

export function requestUrgencyTone(urgency: PartnerServiceRequestUrgency) {
  switch (urgency) {
    case "urgent":
      return "#DC2626";
    case "high":
      return "#D97706";
    case "normal":
      return "#2563EB";
    case "low":
      return "#6B7280";
  }
}

/**
 * Query state is kept serializable and passed to the generated list hook. In
 * particular, empty strings are omitted so the server's strict query parser
 * never receives an accidental empty enum or ID.
 */
export function buildServiceRequestListParams(filters: {
  search?: string;
  status?: PartnerServiceRequestStatus | "all";
  urgency?: PartnerServiceRequestUrgency | "all";
  vehicleId?: number | null;
  locationId?: number | null;
  limit?: number;
}): ListPartnerServiceRequestsParams {
  return {
    ...(filters.search?.trim() ? { q: filters.search.trim() } : {}),
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.urgency && filters.urgency !== "all" ? { urgency: filters.urgency } : {}),
    ...(filters.vehicleId != null ? { vehicleId: filters.vehicleId } : {}),
    ...(filters.locationId != null ? { locationId: filters.locationId } : {}),
    ...(filters.limit != null ? { limit: filters.limit } : {}),
  };
}

export function buildServiceRequestUpdatePayload(input: {
  request: Pick<PartnerServiceRequest, "version" | "status">;
  category?: PartnerServiceRequestCategory;
  urgency?: PartnerServiceRequestUrgency;
  requestedWork?: string;
  serviceNotes?: string | null;
  locationId?: number;
}): PartnerServiceRequestUpdateInput | null {
  if (!requestCanEdit(input.request.status)) return null;
  const payload: PartnerServiceRequestUpdateInput = {
    expectedVersion: input.request.version,
  };
  if (input.category !== undefined) payload.category = input.category;
  if (input.urgency !== undefined) payload.urgency = input.urgency;
  if (input.requestedWork !== undefined) payload.requestedWork = input.requestedWork.trim();
  if (input.serviceNotes !== undefined) payload.serviceNotes = input.serviceNotes?.trim() || null;
  if (input.locationId !== undefined) payload.locationId = input.locationId;
  return Object.keys(payload).length > 1 ? payload : null;
}

export function buildServiceRequestTransitionPayload(
  request: Pick<PartnerServiceRequest, "version" | "status">,
  toStatus: PartnerServiceRequestStatus,
  note?: string,
): PartnerServiceRequestTransitionInput | null {
  if (!requestCanTransition(request.status, toStatus)) return null;
  return {
    expectedVersion: request.version,
    toStatus,
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
}

export function getServiceRequestVehicleContext(request: PartnerServiceRequest) {
  return request.creationContext.vehicle;
}

export function serviceRequestContextKey(
  ownerId: number | null | undefined,
  organizationId: number | null | undefined,
) {
  return `${ownerId ?? "none"}:${organizationId ?? "none"}`;
}

export function createClientRequestId(
  organizationId: number,
  operationId: number,
  suffix = "new",
) {
  // Stable for the lifetime of a form and opaque to the API. The form stores
  // this value in state and reuses it when a network retry is requested.
  return `partner-${organizationId}-${operationId}-${suffix}-${Date.now()}`;
}