import { Feather } from "@expo/vector-icons";
import {
  getListPartnerOrganizationLocationsQueryKey,
  getListPartnerOrganizationsQueryKey,
  getListPartnerServiceRequestsQueryKey,
  getListPartnerVehicleOperationsQueryKey,
  useListPartnerOrganizationLocations,
  useListPartnerOrganizations,
  useListPartnerServiceRequests,
  useListPartnerVehicleOperations,
  type PartnerServiceRequestStatus,
  type PartnerServiceRequestUrgency,
} from "@workspace/api-client-react";
import { usePathname, useRouter, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";
import {
  buildServiceRequestListParams,
  PARTNER_SERVICE_REQUEST_STATUSES,
  PARTNER_SERVICE_REQUEST_URGENCIES,
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
  requestStatusTone,
  requestUrgencyTone,
  serviceRequestContextKey,
} from "@/lib/partnerServiceRequest";
import { partnerOrganizationSubtypeLabel } from "@/lib/partnerOrganization";
import {
  isPartnerRouteActive,
  partnerRouteAccessibilityProps,
} from "@/lib/partnerRouteAccessibility";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function ServiceRequestsListScreen() {
  const colors = useColors();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const enabled = !!user && user.role === "shop_owner";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PartnerServiceRequestStatus | "all">("all");
  const [urgency, setUrgency] = useState<PartnerServiceRequestUrgency | "all">("all");
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [contextResetKey, setContextResetKey] = useState("");

  const organizationsQuery = useListPartnerOrganizations({
    query: { enabled, queryKey: getListPartnerOrganizationsQueryKey() },
  });
  const { selectedId, selectedOrganization, isSelectionReady } = useSelectedPartnerOrganization(
    user?.id,
    organizationsQuery.data,
  );
  const supported = selectedOrganization?.subtype === "dealership" || selectedOrganization?.subtype === "fleet";
  const contextKey = serviceRequestContextKey(user?.id, selectedId);
  const contextReady = contextResetKey === contextKey;

  const locationsQuery = useListPartnerOrganizationLocations(selectedId ?? 0, {
    query: {
      enabled: enabled && isSelectionReady && selectedId != null && supported && contextReady,
      queryKey: getListPartnerOrganizationLocationsQueryKey(selectedId ?? 0),
    },
  });
  const operationsQuery = useListPartnerVehicleOperations(selectedId ?? 0, {
    query: {
      enabled: enabled && isSelectionReady && selectedId != null && supported && contextReady,
      queryKey: getListPartnerVehicleOperationsQueryKey(selectedId ?? 0),
    },
  });
  const listParams = useMemo(
    () =>
      buildServiceRequestListParams({
        search,
        status,
        urgency,
        vehicleId,
        locationId,
        limit: 100,
      }),
    [locationId, search, status, urgency, vehicleId],
  );
  const requestQueryKey = useMemo(
    () => [
      ...getListPartnerServiceRequestsQueryKey(selectedId ?? 0, listParams),
      "owner",
      user?.id ?? "signed-out",
    ] as const,
    [listParams, selectedId, user?.id],
  );
  const requestsQuery = useListPartnerServiceRequests(selectedId ?? 0, listParams, {
    query: {
      enabled: enabled && isSelectionReady && selectedId != null && supported && contextReady,
      queryKey: requestQueryKey,
    },
  });

  useEffect(() => {
    setSearch("");
    setStatus("all");
    setUrgency("all");
    setVehicleId(null);
    setLocationId(null);
    setContextResetKey(contextKey);
  }, [contextKey]);

  const refresh = () => {
    void organizationsQuery.refetch();
    if (selectedId != null && supported) {
      void locationsQuery.refetch();
      void operationsQuery.refetch();
      void requestsQuery.refetch();
    }
  };

  const locations = locationsQuery.data ?? [];
  const operations = operationsQuery.data ?? [];
  const operationById = useMemo(() => new Map(operations.map((operation) => [operation.id, operation])), [operations]);
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const queryError =
    organizationsQuery.error ?? locationsQuery.error ?? operationsQuery.error ?? requestsQuery.error;
  const isLoading =
    organizationsQuery.isLoading ||
    !isSelectionReady ||
    (supported && (locationsQuery.isLoading || operationsQuery.isLoading || requestsQuery.isLoading));

  const routeActive = isPartnerRouteActive(pathname, "service-requests");
  if (!routeActive) {
    return (
      <View
        style={styles.container}
        {...partnerRouteAccessibilityProps(false)}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading service requests…</Text>
      </View>
    );
  }

  if (!selectedOrganization) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Service requests" }} />
        <View style={styles.gate}>
          <Feather name="briefcase" size={42} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Select an organization</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Service requests are scoped to the selected dealership or fleet organization.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(shop-owner)/organizations" as never)}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Manage organizations</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!supported) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Service requests" }} />
        <View style={styles.gate}>
          <Feather name="lock" size={42} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Service requests unavailable</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} organizations use the shared
            organization and location foundation. Dealership and Fleet organizations manage service requests.
          </Text>
        </View>
      </View>
    );
  }

  if (!contextReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Service requests" }} />
        <View style={styles.contextGate}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Selected organization: ${selectedOrganization.name}`}
            style={[styles.heading, { color: colors.foreground }]}
          >
            {selectedOrganization.name}
          </Text>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            Refreshing organization context…
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Service requests" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={
              organizationsQuery.isRefetching ||
              locationsQuery.isRefetching ||
              operationsQuery.isRefetching ||
              requestsQuery.isRefetching
            }
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>SELECTED ORGANIZATION</Text>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`Selected organization: ${selectedOrganization.name}`}
              style={[styles.heading, { color: colors.foreground }]}
            >
              {selectedOrganization.name}
            </Text>
            <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
              {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} · owner-managed internal work tracking
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create service request"
            accessibilityState={{
              disabled:
                selectedOrganization.status !== "active" ||
                !contextReady ||
                locations.every((location) => location.status === "inactive"),
            }}
            onPress={() => router.push("/(shop-owner)/service-requests/new" as never)}
            disabled={selectedOrganization.status !== "active" || !contextReady || locations.every((location) => location.status === "inactive")}
            style={[
              styles.addButton,
              {
                backgroundColor: colors.primary,
                opacity:
                  selectedOrganization.status === "active" &&
                  contextReady &&
                  locations.some((location) => location.status !== "inactive")
                    ? 1
                    : 0.45,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.addButtonText, { color: colors.primaryForeground }]}>New</Text>
          </Pressable>
        </View>

        {selectedOrganization.status !== "active" ? (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="eye" size={16} color={colors.mutedForeground} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              This organization is inactive. Existing requests remain readable; create, edit, and status changes are disabled.
            </Text>
          </View>
        ) : null}
        {queryError ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {errorMessage(queryError, "Unable to load service requests. Pull to refresh and try again.")}
            </Text>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search service requests"
          style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="Search requested work or service notes…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <View style={styles.filterBlock}>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>STATUS</Text>
          <View style={styles.chipRow}>
            {(["all", ...PARTNER_SERVICE_REQUEST_STATUSES] as const).map((value) => {
              const selected = status === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Status filter: ${value === "all" ? "All" : REQUEST_STATUS_LABELS[value]}`}
                  accessibilityState={{ selected }}
                  onPress={() => setStatus(value)}
                  style={[styles.filterChip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>
                    {value === "all" ? "All" : REQUEST_STATUS_LABELS[value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>URGENCY</Text>
          <View style={styles.chipRow}>
            {(["all", ...PARTNER_SERVICE_REQUEST_URGENCIES] as const).map((value) => {
              const selected = urgency === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Urgency filter: ${value === "all" ? "All" : REQUEST_URGENCY_LABELS[value]}`}
                  accessibilityState={{ selected }}
                  onPress={() => setUrgency(value)}
                  style={[styles.filterChip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>
                    {value === "all" ? "All" : REQUEST_URGENCY_LABELS[value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>VEHICLE</Text>
          <View style={styles.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Vehicle filter: All vehicles"
              accessibilityState={{ selected: vehicleId == null }}
              onPress={() => setVehicleId(null)}
              style={[styles.filterChip, { backgroundColor: vehicleId == null ? colors.primary : colors.card, borderColor: vehicleId == null ? colors.primary : colors.border }]}
            >
              <Text style={{ color: vehicleId == null ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>All vehicles</Text>
            </Pressable>
            {operations.map((operation) => {
              const selected = vehicleId === operation.vehicleId;
              return (
                <Pressable
                  key={operation.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Vehicle filter: ${operation.year} ${operation.make} ${operation.model}`}
                  accessibilityState={{ selected }}
                  onPress={() => setVehicleId(selected ? null : operation.vehicleId)}
                  style={[styles.filterChip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                >
                  <Text numberOfLines={1} style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700", maxWidth: 150 }}>
                    {operation.year} {operation.make} {operation.model}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>LOCATION</Text>
          <View style={styles.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Location filter: All locations"
              accessibilityState={{ selected: locationId == null }}
              onPress={() => setLocationId(null)}
              style={[styles.filterChip, { backgroundColor: locationId == null ? colors.primary : colors.card, borderColor: locationId == null ? colors.primary : colors.border }]}
            >
              <Text style={{ color: locationId == null ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700" }}>All locations</Text>
            </Pressable>
            {locations.map((location) => {
              const selected = locationId === location.id;
              return (
                <Pressable
                  key={location.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Location filter: ${location.name}`}
                  accessibilityState={{ selected }}
                  onPress={() => setLocationId(selected ? null : location.id)}
                  style={[styles.filterChip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                >
                  <Text numberOfLines={1} style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: "700", maxWidth: 150 }}>
                    {location.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!contextReady ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Refreshing organization context…</Text>
          </View>
        ) : (requestsQuery.data ?? []).length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="clipboard" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {search || status !== "all" || urgency !== "all" || vehicleId != null || locationId != null
                ? "No matching requests"
                : "No service requests yet"}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Create a draft from a registered dealership or fleet vehicle. This workflow only tracks owner-managed internal work.
            </Text>
          </View>
        ) : (
          <View style={styles.requestList}>
            {(requestsQuery.data ?? []).map((request) => {
              const operation = operationById.get(request.operationId);
              const location = locationById.get(request.locationId);
              return (
                <Pressable
                  key={request.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open service request ${request.id}`}
                  onPress={() => router.push(`/(shop-owner)/service-requests/${request.id}` as never)}
                  style={[styles.requestCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.requestHeader}>
                    <View style={styles.requestCopy}>
                      <Text style={[styles.requestTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {operation
                          ? `${operation.year} ${operation.make} ${operation.model}`
                          : `Vehicle #${request.vehicleId}`}
                      </Text>
                      <Text style={[styles.requestMeta, { color: colors.mutedForeground }]}>
                        Request #{request.id} · {location?.name ?? `Location #${request.locationId}`}
                      </Text>
                    </View>
                    <View style={styles.pillColumn}>
                      <View style={[styles.statusPill, { backgroundColor: requestStatusTone(request.status) + "18" }]}>
                        <Text style={[styles.statusText, { color: requestStatusTone(request.status) }]}>
                          {REQUEST_STATUS_LABELS[request.status]}
                        </Text>
                      </View>
                      {request.linkedApsJobId != null ? (
                        <View style={[styles.linkedPill, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "55" }]}>
                          <Feather name="link" size={10} color={colors.primary} />
                          <Text style={[styles.linkedText, { color: colors.primary }]}>APS linked</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text style={[styles.requestWork, { color: colors.foreground }]} numberOfLines={2}>
                    {request.requestedWork}
                  </Text>
                  <View style={styles.requestFooter}>
                    <Text style={[styles.requestMeta, { color: requestUrgencyTone(request.urgency) }]}>
                      {REQUEST_URGENCY_LABELS[request.urgency]} urgency
                    </Text>
                    <Text style={[styles.requestMeta, { color: colors.mutedForeground }]}>
                      Updated {formatDate(request.updatedAt)}
                    </Text>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 12, padding: 16, paddingBottom: 120 },
  center: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center" },
  contextGate: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center", padding: 24 },
  muted: { fontSize: 13 },
  gate: { alignItems: "center", flex: 1, justifyContent: "center", padding: 25 },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginTop: 12, textAlign: "center" },
  emptyText: { fontSize: 13, lineHeight: 18, marginTop: 5, textAlign: "center" },
  primaryButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 44, marginTop: 15, paddingHorizontal: 16 },
  primaryButtonText: { fontSize: 13, fontWeight: "800" },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  heading: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  subheading: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  addButton: { alignItems: "center", borderRadius: 9, flexDirection: "row", gap: 5, paddingHorizontal: 11, paddingVertical: 9 },
  addButtonText: { fontSize: 12, fontWeight: "800" },
  notice: { alignItems: "flex-start", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  search: { borderRadius: 10, borderWidth: 1, fontSize: 14, height: 45, paddingHorizontal: 12 },
  filterBlock: { gap: 7 },
  filterLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginTop: 3 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  filterChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  emptyCard: { alignItems: "center", borderRadius: 14, borderStyle: "dashed", borderWidth: 1, padding: 26 },
  requestList: { gap: 9 },
  requestCard: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 13 },
  requestHeader: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  requestCopy: { flex: 1, minWidth: 0 },
  requestTitle: { fontSize: 15, fontWeight: "800" },
  requestMeta: { fontSize: 11, marginTop: 3 },
  pillColumn: { alignItems: "flex-end", gap: 4 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "800" },
  linkedPill: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  linkedText: { fontSize: 9, fontWeight: "800" },
  requestWork: { fontSize: 13, lineHeight: 18 },
  requestFooter: { alignItems: "center", flexDirection: "row", gap: 8 },
});