import { Feather } from "@expo/vector-icons";
import {
  getGetPartnerServiceRequestQueryKey,
  getGetJobQueryKey,
  getGetTierCatalogQueryKey,
  getListPartnerOrganizationLocationsQueryKey,
  getListPartnerOrganizationsQueryKey,
  getListPartnerServiceRequestsQueryKey,
  getListPartnerVehicleOperationsQueryKey,
  getListJobsQueryKey,
  useGetPartnerServiceRequest,
  useGetTierCatalog,
  useListPartnerOrganizationLocations,
  useListPartnerOrganizations,
  useListPartnerVehicleOperations,
  useSendPartnerServiceRequestToAps,
  useTransitionPartnerServiceRequest,
  useUpdatePartnerServiceRequest,
  type SendPartnerServiceRequestToApsInputJobType,
  type PartnerServiceRequestCategory,
  type PartnerServiceRequestDealershipContext,
  type PartnerServiceRequestFleetContext,
  type PartnerServiceRequest,
  type PartnerServiceRequestStatus,
  type PartnerServiceRequestUrgency,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import {
  PartnerServiceRequestForm,
  type PartnerServiceRequestDraft,
} from "@/components/partner/PartnerServiceRequestForm";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";
import {
  CommercialJobContext,
} from "@/components/partner/CommercialJobIntegration";
import {
  APS_JOB_TYPE_LABELS,
  apsJobTypeForRequestCategory,
  buildServiceRequestTransitionPayload,
  buildServiceRequestUpdatePayload,
  REQUEST_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
  requestCanEdit,
  requestStatusTone,
  requestTransitionOptions,
  requestUrgencyTone,
  serviceRequestContextKey,
} from "@/lib/partnerServiceRequest";
import { partnerOrganizationSubtypeLabel } from "@/lib/partnerOrganization";
import {
  isPartnerServiceRequestDetailActive,
  partnerRouteAccessibilityProps,
} from "@/lib/partnerRouteAccessibility";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function isVersionConflict(error: unknown) {
  const message = errorMessage(error, "").toLowerCase();
  return message.includes("409") || message.includes("conflict") || message.includes("version") || message.includes("stale");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function requestSnapshotLines(request: PartnerServiceRequest) {
  const context = request.creationContext;
  const vehicle = context.vehicle;
  const lines = [
    `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    `VIN ${vehicle.vin}`,
    vehicle.plateNumber ? `Plate ${vehicle.plateNumber}` : null,
    `Mileage ${vehicle.mileage.toLocaleString()} mi`,
  ];
  if (request.sourceSubtype === "dealership") {
    const operation = (context as PartnerServiceRequestDealershipContext).operation;
    lines.push(
      operation.stockNumber ? `Stock ${operation.stockNumber}` : null,
      operation.inventoryStatus ? `Inventory ${operation.inventoryStatus.replace("_", " ")}` : null,
      operation.serviceNeeded == null ? null : operation.serviceNeeded ? "Service needed" : "Service ready",
      operation.serviceNotes ? `Vehicle service note: ${operation.serviceNotes}` : null,
    );
  } else {
    const operation = (context as PartnerServiceRequestFleetContext).operation;
    lines.push(
      operation.unitNumber ? `Unit ${operation.unitNumber}` : null,
      operation.groupName ? `Group ${operation.groupName}` : null,
      operation.operatingStatus ? `Operating status ${operation.operatingStatus.replace("_", " ")}` : null,
      operation.odometer == null ? null : `Odometer ${operation.odometer.toLocaleString()} mi`,
      operation.usageHours == null ? null : `Usage ${operation.usageHours.toLocaleString()} hr`,
      operation.maintenanceDueDate ? `Maintenance due ${operation.maintenanceDueDate}` : null,
      operation.maintenanceDueMileage == null
        ? null
        : `Maintenance due at ${operation.maintenanceDueMileage.toLocaleString()} mi`,
      operation.downtimeSince ? `Downtime since ${operation.downtimeSince}` : null,
      operation.notes ? `Vehicle operations note: ${operation.notes}` : null,
    );
  }
  return lines.filter((line): line is string => Boolean(line));
}

export default function ServiceRequestDetailScreen() {
  const colors = useColors();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const requestId = Number(idParam);
  const routeFocusedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      routeFocusedRef.current = true;
      setIsFocused(true);
      return () => {
        routeFocusedRef.current = false;
        setIsFocused(false);
      };
    }, []),
  );
  const routeActive = isPartnerServiceRequestDetailActive(pathname, requestId);
  const routeFocused = routeActive && isFocused;
  routeFocusedRef.current = routeFocused;
  const { user } = useAuth();
  const enabled = !!user && user.role === "shop_owner" && Number.isInteger(requestId) && requestId > 0;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [screenNotice, setScreenNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [showSendPanel, setShowSendPanel] = useState(false);
  const [serviceSlug, setServiceSlug] = useState<string | null>(null);
  const [fallbackJobType, setFallbackJobType] =
    useState<Exclude<SendPartnerServiceRequestToApsInputJobType, null> | null>(null);
  const [contextResetKey, setContextResetKey] = useState("");
  const mutationContextRef = useRef("");
  const originRequestIdRef = useRef<number | null>(null);
  const originOrganizationIdRef = useRef<number | null>(null);

  const organizationsQuery = useListPartnerOrganizations({
    query: { enabled, queryKey: getListPartnerOrganizationsQueryKey() },
  });
  const { selectedId, selectedOrganization, isSelectionReady } = useSelectedPartnerOrganization(
    user?.id,
    organizationsQuery.data,
  );
  // A detail screen is bound to the organization that opened it. Capture it
  // once so switching organizations cannot reuse the same request id against
  // the new organization.
  if (routeFocused && isSelectionReady && selectedId != null) {
    if (originRequestIdRef.current !== requestId) {
      originRequestIdRef.current = requestId;
      originOrganizationIdRef.current = selectedId;
    } else if (originOrganizationIdRef.current == null) {
      originOrganizationIdRef.current = selectedId;
    }
  }
  const originOrganizationId = originOrganizationIdRef.current ?? selectedId ?? null;
  const organizationChanged =
    originOrganizationId != null && selectedId != null && selectedId !== originOrganizationId;
  const requestOrganizationId = originOrganizationId ?? 0;
  const supported = selectedOrganization?.subtype === "dealership" || selectedOrganization?.subtype === "fleet";
  const contextKey = serviceRequestContextKey(user?.id, selectedId);
  const contextReady = contextResetKey === contextKey;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const detailQuery = useGetPartnerServiceRequest(requestOrganizationId, requestId, {
    query: {
      enabled:
        enabled &&
        isSelectionReady &&
        routeFocused &&
        requestOrganizationId > 0 &&
        !organizationChanged &&
        supported &&
        contextReady,
      queryKey: [
        ...getGetPartnerServiceRequestQueryKey(requestOrganizationId, requestId),
        "owner",
        user?.id ?? "signed-out",
      ],
      refetchInterval: (query) =>
        query.state.data?.request.linkedApsJobId != null ? 8000 : false,
      refetchOnMount: true,
    },
  });
  const locationsQuery = useListPartnerOrganizationLocations(requestOrganizationId, {
    query: {
      enabled:
        enabled &&
        isSelectionReady &&
        routeFocused &&
        requestOrganizationId > 0 &&
        !organizationChanged &&
        supported &&
        contextReady,
      queryKey: getListPartnerOrganizationLocationsQueryKey(requestOrganizationId),
    },
  });
  const operationsQuery = useListPartnerVehicleOperations(requestOrganizationId, {
    query: {
      enabled:
        enabled &&
        isSelectionReady &&
        routeFocused &&
        requestOrganizationId > 0 &&
        !organizationChanged &&
        supported &&
        contextReady,
      queryKey: getListPartnerVehicleOperationsQueryKey(requestOrganizationId),
    },
  });
  const tierCatalogQuery = useGetTierCatalog({
    query: {
      enabled:
        enabled &&
        isSelectionReady &&
        routeFocused &&
        requestOrganizationId > 0 &&
        !organizationChanged &&
        supported &&
        contextReady,
      queryKey: getGetTierCatalogQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });
  const updateMutation = useUpdatePartnerServiceRequest();
  const transitionMutation = useTransitionPartnerServiceRequest();
  const sendMutation = useSendPartnerServiceRequestToAps();

  useEffect(() => {
    if (!routeFocused) {
      mutationContextRef.current = "";
      return;
    }
    if (organizationChanged) {
      setEditing(false);
      setNote("");
      setScreenNotice("");
      setActionError("");
      setShowSendPanel(false);
      setServiceSlug(null);
      setFallbackJobType(null);
      mutationContextRef.current = "";
      setContextResetKey("");
      router.dismissTo("/(shop-owner)/service-requests" as never);
      return;
    }
    setEditing(false);
    setNote("");
    setScreenNotice("");
    setActionError("");
    setShowSendPanel(false);
    setServiceSlug(null);
    setFallbackJobType(null);
    mutationContextRef.current = "";
    setContextResetKey(contextKey);
  }, [contextKey, organizationChanged, requestId, routeFocused, router]);

  if (!routeFocused) {
    return (
      <View
        style={styles.container}
        {...partnerRouteAccessibilityProps(false)}
      />
    );
  }

  const detail = detailQuery.data;
  const request = detail?.request;
  const locations = locationsQuery.data ?? [];
  const operations = operationsQuery.data ?? [];
  const selectedLocation = locations.find((location) => location.id === request?.locationId);
  const operation = operations.find((candidate) => candidate.id === request?.operationId);
  const linkedProgress = detail?.linkedProgress ?? null;
  const requestHasLinkedJob = request?.linkedApsJobId != null;
  const transitionOptions =
    request && !requestHasLinkedJob ? requestTransitionOptions(request.status) : [];
  const hasActiveLinkedLocation =
    selectedLocation?.status === "active";
  const canSendToAps =
    !!request &&
    request.status === "submitted" &&
    !requestHasLinkedJob &&
    selectedOrganization?.status === "active" &&
    supported &&
    contextReady &&
    hasActiveLinkedLocation;
  const inferredJobType = request ? apsJobTypeForRequestCategory(request.category) : null;
  const sendJobType = serviceSlug ? null : fallbackJobType ?? inferredJobType;
  const queryError =
    organizationsQuery.error ??
    detailQuery.error ??
    locationsQuery.error ??
    operationsQuery.error;

  const invalidate = () => {
    if (requestOrganizationId <= 0) return;
    void queryClient.invalidateQueries({
      queryKey: getGetPartnerServiceRequestQueryKey(requestOrganizationId, requestId),
    });
    void queryClient.invalidateQueries({ queryKey: getListPartnerServiceRequestsQueryKey(requestOrganizationId) });
  };

  const handleUpdate = (draft: PartnerServiceRequestDraft) => {
    if (!request || requestOrganizationId <= 0 || !selectedOrganization) return;
    setActionError("");
    const payload = buildServiceRequestUpdatePayload({
      request,
      category: draft.category,
      urgency: draft.urgency,
      requestedWork: draft.requestedWork,
      serviceNotes: draft.serviceNotes,
      // Do not resend an existing inactive location during a content-only
      // edit. The API only validates a destination location when it is
      // changed; a user can still edit category/notes on a readable record.
      locationId: draft.locationId !== request.locationId ? draft.locationId ?? undefined : undefined,
    });
    if (!payload) {
      setActionError("This request cannot be edited in its current status.");
      return;
    }
    if (selectedOrganization.status !== "active") {
      setActionError("This organization is inactive. Existing requests are read-only.");
      return;
    }
    const originalContextKey = contextKey;
    mutationContextRef.current = originalContextKey;
    updateMutation.mutate(
      { organizationId: requestOrganizationId, requestId: request.id, data: payload },
      {
        onSuccess: () => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          setEditing(false);
          setScreenNotice("Request changes saved.");
          invalidate();
        },
        onError: (error) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          if (isVersionConflict(error)) {
            setActionError("This request changed elsewhere. The latest version was fetched; review it before saving again.");
            void detailQuery.refetch();
          } else {
            setActionError(errorMessage(error, "Unable to save request changes."));
          }
        },
      },
    );
  };

  const handleTransition = (toStatus: PartnerServiceRequestStatus) => {
    if (!request || requestOrganizationId <= 0 || !selectedOrganization) return;
    setActionError("");
    const payload = buildServiceRequestTransitionPayload(request, toStatus, note);
    if (!payload) {
      setActionError(`The server lifecycle does not allow ${REQUEST_STATUS_LABELS[toStatus]} from ${REQUEST_STATUS_LABELS[request.status]}.`);
      return;
    }
    if (selectedOrganization.status !== "active") {
      setActionError("This organization is inactive. Existing requests are read-only.");
      return;
    }
    const originalContextKey = contextKey;
    mutationContextRef.current = originalContextKey;
    transitionMutation.mutate(
      { organizationId: requestOrganizationId, requestId: request.id, data: payload },
      {
        onSuccess: () => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          setNote("");
          setScreenNotice(
            toStatus === "in_progress"
              ? "Work tracking started for this internal service request."
              : toStatus === "completed"
                ? "Request marked completed."
                : toStatus === "cancelled"
                  ? "Request cancelled."
                  : "Request submitted.",
          );
          invalidate();
        },
        onError: (error) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          if (isVersionConflict(error)) {
            setActionError("This request changed elsewhere. The latest version was fetched; review it before trying the action again.");
            void detailQuery.refetch();
          } else {
            setActionError(errorMessage(error, "Unable to change request status."));
          }
        },
      },
    );
  };

  const handleSendToAps = () => {
    if (!request || requestOrganizationId <= 0 || !selectedOrganization) return;
    setActionError("");
    if (!canSendToAps) {
      setActionError(
        requestHasLinkedJob
          ? "This request is already linked to an APS job."
          : !hasActiveLinkedLocation
            ? "Choose an active linked location before sending this request to APS."
            : "Only submitted requests from an active organization can be sent to APS.",
      );
      return;
    }
    if (!serviceSlug && !sendJobType) {
      setActionError("Choose a catalog service or an explicit APS job type for this request.");
      return;
    }

    const originalContextKey = contextKey;
    mutationContextRef.current = originalContextKey;
    sendMutation.mutate(
      {
        organizationId: requestOrganizationId,
        requestId: request.id,
        data: {
          expectedVersion: request.version,
          ...(serviceSlug ? { serviceSlug } : { jobType: sendJobType }),
        },
      },
      {
        onSuccess: (response) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          setShowSendPanel(false);
          setServiceSlug(null);
          setFallbackJobType(null);
          setScreenNotice(
            response.replay
              ? `APS job #${response.job.id} is already linked to this request.`
              : `Request sent to APS as job #${response.job.id}.`,
          );
          void queryClient.invalidateQueries({
            queryKey: getGetPartnerServiceRequestQueryKey(requestOrganizationId, request.id),
          });
          void queryClient.invalidateQueries({
            queryKey: getListPartnerServiceRequestsQueryKey(requestOrganizationId),
          });
          void queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(response.job.id) });
          void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        },
        onError: (error) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          if (isVersionConflict(error)) {
            setActionError(
              "This request changed elsewhere. The latest version was fetched; review it before sending again.",
            );
            void detailQuery.refetch();
          } else {
            setActionError(errorMessage(error, "Unable to send this request to APS."));
          }
        },
      },
    );
  };

  if (
    organizationsQuery.isLoading ||
    !isSelectionReady ||
    detailQuery.isLoading ||
    locationsQuery.isLoading ||
    operationsQuery.isLoading
  ) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading service request…</Text>
      </View>
    );
  }

  if (organizationChanged) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "Service request" }} />
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          Organization changed. Returning to service requests…
        </Text>
      </View>
    );
  }

  if (!selectedOrganization) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "Service request" }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Select an organization first</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          Request details are scoped to the selected organization.
        </Text>
      </View>
    );
  }

  if (!supported) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "Service request" }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Service requests unavailable</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} organizations do not have this workflow.
        </Text>
      </View>
    );
  }

  if (!contextReady) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Service request" }} />
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          Refreshing organization context…
        </Text>
      </View>
    );
  }

  if (!request) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "Service request" }} />
        <Feather name="alert-circle" size={38} color={colors.destructive} />
        <Text style={[styles.title, { color: colors.foreground }]}>Request unavailable</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          {errorMessage(queryError, "This request could not be loaded for the selected organization.")}
        </Text>
        <Pressable
          onPress={() => router.dismissTo("/(shop-owner)/service-requests" as never)}
          style={[styles.outlineButton, { borderColor: colors.primary }]}
        >
          <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Back to requests</Text>
        </Pressable>
      </View>
    );
  }

  const canWrite = selectedOrganization.status === "active" && contextReady;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: `Request #${request.id}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>INTERNAL SERVICE REQUEST</Text>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`Service request ${request.id}`}
              style={[styles.heading, { color: colors.foreground }]}
            >
              Request #{request.id}
            </Text>
            <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
              Version {request.version} · {partnerOrganizationSubtypeLabel(request.sourceSubtype)}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: requestStatusTone(request.status) + "18" }]}>
            <Text style={[styles.statusText, { color: requestStatusTone(request.status) }]}>
              {REQUEST_STATUS_LABELS[request.status]}
            </Text>
          </View>
        </View>

        {selectedOrganization.status !== "active" ? (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="eye" size={16} color={colors.mutedForeground} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              Inactive organization: this request is readable, but editing and status changes are disabled.
            </Text>
          </View>
        ) : null}
        {!contextReady ? (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>Refreshing organization context…</Text>
          </View>
        ) : null}
        {screenNotice ? (
          <View style={[styles.notice, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "55" }]}>
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>{screenNotice}</Text>
          </View>
        ) : null}
        {queryError ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {errorMessage(queryError, "Unable to load request context.")}
            </Text>
          </View>
        ) : null}
        {actionError ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="alert-triangle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>{actionError}</Text>
          </View>
        ) : null}

        {editing && requestCanEdit(request.status) && !requestHasLinkedJob ? (
          <PartnerServiceRequestForm
            key={`${contextKey}:${request.id}:${request.version}`}
            subtype={request.sourceSubtype}
            operations={operations}
            locations={locations}
            mode="edit"
            initialRequest={request}
            isSaving={updateMutation.isPending && mutationContextRef.current === contextKey}
            error={actionError}
            onCancel={() => {
              setEditing(false);
              setActionError("");
            }}
            onSubmit={handleUpdate}
          />
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.detailRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>VEHICLE</Text>
                <Text style={[styles.value, { color: colors.foreground }]}>
                  {operation
                    ? `${operation.year} ${operation.make} ${operation.model}`
                    : `Vehicle #${request.vehicleId}`}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  VIN {request.creationContext.vehicle.vin}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>LOCATION</Text>
                <Text style={[styles.value, { color: colors.foreground }]}>
                  {selectedLocation?.name ?? `Location #${request.locationId}`}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {selectedLocation ? [selectedLocation.city, selectedLocation.region].filter(Boolean).join(", ") : "Organization-linked location"}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>CATEGORY · URGENCY</Text>
                <Text style={[styles.value, { color: colors.foreground }]}>
                  {REQUEST_CATEGORY_LABELS[request.category]} ·{" "}
                  <Text style={{ color: requestUrgencyTone(request.urgency) }}>
                    {REQUEST_URGENCY_LABELS[request.urgency]}
                  </Text>
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>REQUESTED WORK</Text>
                <Text style={[styles.value, { color: colors.foreground }]}>{request.requestedWork}</Text>
              </View>
              {request.serviceNotes ? (
                <View style={styles.detailRow}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>SERVICE NOTES</Text>
                  <Text style={[styles.value, { color: colors.foreground }]}>{request.serviceNotes}</Text>
                </View>
              ) : null}
              <View style={[styles.snapshotCard, { backgroundColor: colors.primary + "0D", borderColor: colors.primary + "55" }]}>
                <Text style={[styles.snapshotTitle, { color: colors.primary }]}>Creation-time vehicle context</Text>
                {requestSnapshotLines(request).map((line) => (
                  <Text key={line} style={[styles.meta, { color: colors.mutedForeground }]}>{line}</Text>
                ))}
                <Text style={[styles.snapshotFootnote, { color: colors.mutedForeground }]}>
                  Captured {formatDate(request.creationContext.capturedAt)} · immutable snapshot
                </Text>
              </View>
            </View>
            {requestCanEdit(request.status) && !requestHasLinkedJob && canWrite ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit service request"
                onPress={() => {
                  setActionError("");
                  setEditing(true);
                }}
                style={[styles.outlineButton, { borderColor: colors.primary }]}
              >
                <Feather name="edit-2" size={15} color={colors.primary} />
                <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Edit request</Text>
              </Pressable>
            ) : null}
          </>
        )}

        {requestHasLinkedJob ? (
          <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.linkedHeader}>
              <View style={styles.headerCopy}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>APS job progress</Text>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  This request remains the submitted source record. Progress below is read from the linked APS job and its real work logs.
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  Linked {formatDate(request.linkedAt)}
                </Text>
              </View>
              <View style={[styles.linkedPill, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "55" }]}>
                <Feather name="link" size={11} color={colors.primary} />
                <Text style={[styles.linkedText, { color: colors.primary }]}>Linked</Text>
              </View>
            </View>
            {linkedProgress?.apsJob ? (
              <>
                <View style={styles.linkedJobRow}>
                  <View style={styles.headerCopy}>
                    <Text style={[styles.value, { color: colors.foreground }]}>
                      APS job #{linkedProgress.apsJob.id}
                    </Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      {linkedProgress.apsJob.status.replace(/_/g, " ")}
                      {linkedProgress.completion ? " · Completed" : " · In progress"}
                    </Text>
                  </View>
                  <CommercialJobContext job={linkedProgress.apsJob} compact />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open linked APS job ${linkedProgress.apsJob.id}`}
                  onPress={() => router.push(`/job/${linkedProgress.apsJob!.id}` as never)}
                  style={[styles.outlineButton, { borderColor: colors.primary }]}
                >
                  <Feather name="external-link" size={15} color={colors.primary} />
                  <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Open APS job</Text>
                </Pressable>
                <View style={[styles.progressSummary, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>COMPLETION</Text>
                  <Text style={[styles.value, { color: linkedProgress.completion ? colors.primary : colors.foreground }]}>
                    {linkedProgress.completion ? "Completed with work log" : "Awaiting APS completion"}
                  </Text>
                </View>
                {linkedProgress.worklogs.length > 0 ? (
                  <View style={styles.worklogList}>
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                      {request.sourceSubtype === "fleet" ? "Fleet maintenance history" : "APS work logs"}
                    </Text>
                    {linkedProgress.worklogs.map((worklog) => (
                      <View key={worklog.id} style={[styles.worklogCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <View style={styles.worklogHeader}>
                          <Text style={[styles.value, { color: colors.foreground }]}>{worklog.serviceCategory}</Text>
                          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{formatDate(worklog.createdAt)}</Text>
                        </View>
                        <Text style={[styles.meta, { color: colors.foreground }]}>{worklog.serviceDescription}</Text>
                        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                          Mileage {worklog.mileageAtService.toLocaleString()} mi · Total ${worklog.totalCost.toFixed(2)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                    No APS work log has been recorded yet.
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.inlineLoading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>Refreshing linked APS progress…</Text>
              </View>
            )}
          </View>
        ) : null}

        {request.status === "submitted" && !requestHasLinkedJob && !hasActiveLinkedLocation ? (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="map-pin" size={16} color={colors.mutedForeground} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              An active linked location is required before this request can be sent to APS. Choose one with Edit request, then return here.
            </Text>
          </View>
        ) : null}

        {canSendToAps ? (
          <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Send to APS</Text>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              Send this submitted request as one ordinary APS job. Mechanics will use the existing accept, approval, work-log, completion, and earnings workflow.
            </Text>
            {showSendPanel ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>OPTIONAL SERVICE CATALOG</Text>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  A catalog service lets APS derive the service type, tier, and quote. Leave it unselected to use the request category mapping.
                </Text>
                {tierCatalogQuery.error ? (
                  <Text style={[styles.meta, { color: colors.destructive }]}>
                    The service catalog is unavailable. You can still use the request category mapping or choose an explicit APS job type.
                  </Text>
                ) : null}
                <View style={styles.chipRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Use request category mapping"
                    accessibilityState={{ selected: serviceSlug == null }}
                    onPress={() => setServiceSlug(null)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: serviceSlug == null ? colors.primary : colors.background,
                        borderColor: serviceSlug == null ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: serviceSlug == null ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>
                      Use category
                    </Text>
                  </Pressable>
                  {(tierCatalogQuery.data?.services ?? []).map((service) => {
                    const selected = serviceSlug === service.slug;
                    return (
                      <Pressable
                        key={service.slug}
                        accessibilityRole="button"
                        accessibilityLabel={`Catalog service: ${service.name}`}
                        accessibilityState={{ selected }}
                        onPress={() => {
                          setServiceSlug(selected ? null : service.slug);
                          setFallbackJobType(null);
                        }}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: selected ? colors.primary : colors.background,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text numberOfLines={1} style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700", maxWidth: 180 }}>
                          {service.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!serviceSlug && inferredJobType ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    Request category maps to {APS_JOB_TYPE_LABELS[inferredJobType]}.
                  </Text>
                ) : null}
                {!serviceSlug && !inferredJobType ? (
                  <>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>APS JOB TYPE REQUIRED FOR OTHER</Text>
                    <View style={styles.chipRow}>
                      {(Object.keys(APS_JOB_TYPE_LABELS) as Array<Exclude<SendPartnerServiceRequestToApsInputJobType, null>>).map((jobType) => {
                        const selected = fallbackJobType === jobType;
                        return (
                          <Pressable
                            key={jobType}
                            accessibilityRole="button"
                            accessibilityLabel={`APS job type: ${APS_JOB_TYPE_LABELS[jobType]}`}
                            accessibilityState={{ selected }}
                            onPress={() => setFallbackJobType(selected ? null : jobType)}
                            style={[
                              styles.filterChip,
                              {
                                backgroundColor: selected ? colors.primary : colors.background,
                                borderColor: selected ? colors.primary : colors.border,
                              },
                            ]}
                          >
                            <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>
                              {APS_JOB_TYPE_LABELS[jobType]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                <View style={styles.sendActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel Send to APS"
                    onPress={() => {
                      setShowSendPanel(false);
                      setActionError("");
                    }}
                    style={[styles.outlineButton, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.outlineButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send service request to APS"
                    accessibilityState={{ disabled: sendMutation.isPending || (!serviceSlug && !sendJobType) }}
                    onPress={handleSendToAps}
                    disabled={sendMutation.isPending || (!serviceSlug && !sendJobType)}
                    style={[styles.primaryActionButton, { backgroundColor: colors.primary, opacity: sendMutation.isPending || (!serviceSlug && !sendJobType) ? 0.5 : 1 }]}
                  >
                    {sendMutation.isPending ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <>
                        <Feather name="send" size={15} color={colors.primaryForeground} />
                        <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>Send to APS</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Configure Send to APS"
                onPress={() => {
                  setActionError("");
                  setShowSendPanel(true);
                }}
                style={[styles.primaryActionButton, { backgroundColor: colors.primary }]}
              >
                <Feather name="send" size={15} color={colors.primaryForeground} />
                <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>Configure send</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {transitionOptions.length > 0 ? (
          <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Owner status actions</Text>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              Status is managed here by the organization owner. This does not create an APS job, dispatch work, or claim provider acceptance.
            </Text>
            <TextInput
              accessibilityLabel="Status transition note"
              style={[styles.noteInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Optional history note…"
              placeholderTextColor={colors.mutedForeground}
              value={note}
              onChangeText={setNote}
              multiline
            />
            {transitionOptions.map((option) => (
              <Pressable
                key={option.toStatus}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ disabled: !canWrite || transitionMutation.isPending }}
                onPress={() => handleTransition(option.toStatus)}
                disabled={!canWrite || transitionMutation.isPending}
                style={[
                  styles.actionButton,
                  {
                    borderColor: option.toStatus === "cancelled" ? colors.destructive : colors.primary,
                    opacity: canWrite && !transitionMutation.isPending ? 1 : 0.45,
                  },
                ]}
              >
                <Feather
                  name={option.toStatus === "cancelled" ? "x-circle" : option.toStatus === "completed" ? "check-circle" : "play-circle"}
                  size={16}
                  color={option.toStatus === "cancelled" ? colors.destructive : colors.primary}
                />
                <Text style={[styles.actionButtonText, { color: option.toStatus === "cancelled" ? colors.destructive : colors.primary }]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Status history</Text>
          {detail?.statusHistory?.length ? (
            <View style={styles.historyList}>
              {detail.statusHistory.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={[styles.historyDot, { backgroundColor: requestStatusTone(entry.toStatus) }]} />
                  <View style={styles.historyCopy}>
                    <Text style={[styles.value, { color: colors.foreground }]}>
                      {entry.fromStatus ? `${REQUEST_STATUS_LABELS[entry.fromStatus]} → ` : ""}
                      {REQUEST_STATUS_LABELS[entry.toStatus]}
                    </Text>
                    {entry.note ? <Text style={[styles.meta, { color: colors.foreground }]}>{entry.note}</Text> : null}
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      {formatDate(entry.createdAt)} · Owner action
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>No status history available.</Text>
          )}
        </View>

        <View style={styles.timestampGrid}>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Created {formatDate(request.createdAt)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Submitted {formatDate(request.submittedAt)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Started {formatDate(request.startedAt)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Completed {formatDate(request.completedAt)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Cancelled {formatDate(request.cancelledAt)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Updated {formatDate(request.updatedAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to service requests"
          onPress={() => router.dismissTo("/(shop-owner)/service-requests" as never)}
          style={styles.backLink}
        >
          <Feather name="arrow-left" size={15} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Back to requests</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 11, padding: 16, paddingBottom: 120 },
  center: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  muted: { fontSize: 12, lineHeight: 17 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  heading: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  subheading: { fontSize: 12, marginTop: 3 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  statusText: { fontSize: 10, fontWeight: "800" },
  notice: { alignItems: "flex-start", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  card: { borderRadius: 13, borderWidth: 1, gap: 11, padding: 14 },
  detailRow: { gap: 3 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  value: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  meta: { fontSize: 11, lineHeight: 16 },
  snapshotCard: { borderRadius: 10, borderWidth: 1, gap: 2, padding: 10 },
  snapshotTitle: { fontSize: 12, fontWeight: "800", marginBottom: 2 },
  snapshotFootnote: { fontSize: 10, fontStyle: "italic", lineHeight: 15, marginTop: 4 },
  outlineButton: { alignItems: "center", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
  outlineButtonText: { fontSize: 13, fontWeight: "800" },
  actionCard: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 14 },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  linkedHeader: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  linkedJobRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  linkedPill: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  linkedText: { fontSize: 9, fontWeight: "800" },
  progressSummary: { borderRadius: 9, borderWidth: 1, gap: 3, padding: 10 },
  worklogList: { gap: 7, marginTop: 2 },
  worklogCard: { borderRadius: 9, borderWidth: 1, gap: 3, padding: 10 },
  worklogHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 8 },
  inlineLoading: { alignItems: "center", flexDirection: "row", gap: 8 },
  sendActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  primaryActionButton: { alignItems: "center", borderRadius: 9, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
  primaryActionText: { fontSize: 13, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  noteInput: { borderRadius: 9, borderWidth: 1, fontSize: 13, minHeight: 56, padding: 10 },
  actionButton: { alignItems: "center", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
  actionButtonText: { fontSize: 12, fontWeight: "800" },
  historyList: { gap: 11 },
  historyRow: { alignItems: "flex-start", flexDirection: "row", gap: 9 },
  historyDot: { borderRadius: 5, height: 10, marginTop: 4, width: 10 },
  historyCopy: { flex: 1, gap: 2 },
  timestampGrid: { gap: 3, paddingHorizontal: 3 },
  backLink: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 7 },
  backText: { fontSize: 13, fontWeight: "800" },
});