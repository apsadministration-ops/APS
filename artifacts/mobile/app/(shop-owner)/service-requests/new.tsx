import {
  getListPartnerOrganizationLocationsQueryKey,
  getListPartnerVehicleOperationsQueryKey,
  useCreatePartnerServiceRequest,
  useListPartnerOrganizationLocations,
  useListPartnerOrganizations,
  useListPartnerVehicleOperations,
} from "@workspace/api-client-react";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  PartnerServiceRequestForm,
  type PartnerServiceRequestDraft,
} from "@/components/partner/PartnerServiceRequestForm";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";
import { partnerOrganizationsQueryKey } from "@/lib/partnerOrganization";
import {
  createClientRequestId,
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

export default function NewServiceRequestScreen() {
  const colors = useColors();
  const pathname = usePathname();
  const router = useRouter();
  const routeActive = isPartnerRouteActive(pathname, "service-request-new");
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
  const routeFocused = routeActive && isFocused;
  routeFocusedRef.current = routeFocused;
  const { operationId: operationIdParam } = useLocalSearchParams<{ operationId?: string }>();
  const { user } = useAuth();
  const enabled = !!user && user.role === "shop_owner";
  const initialOperationId = operationIdParam ? Number(operationIdParam) : null;
  const [contextResetKey, setContextResetKey] = useState("");
  const [formError, setFormError] = useState("");
  const requestIds = useRef(new Map<number, string>());
  const mutationContextRef = useRef("");
  const originOrganizationIdRef = useRef<number | null>(null);
  const organizationsQuery = useListPartnerOrganizations({
    query: { enabled, queryKey: partnerOrganizationsQueryKey(user?.id) },
  });
  const { selectedId, selectedOrganization, isSelectionReady } = useSelectedPartnerOrganization(
    user?.id,
    organizationsQuery.data,
  );
  if (!routeActive) {
    originOrganizationIdRef.current = null;
  } else if (routeFocused && originOrganizationIdRef.current == null && isSelectionReady && selectedId != null) {
    originOrganizationIdRef.current = selectedId;
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
  const createMutation = useCreatePartnerServiceRequest();

  useEffect(() => {
    if (!routeFocused) {
      originOrganizationIdRef.current = null;
      requestIds.current.clear();
      mutationContextRef.current = "";
      return;
    }
    setFormError("");
    requestIds.current.clear();
    mutationContextRef.current = "";
    if (organizationChanged) {
      setContextResetKey("");
      router.dismissTo("/(shop-owner)/service-requests" as never);
      return;
    }
    setContextResetKey(contextKey);
  }, [contextKey, organizationChanged, routeFocused, router]);

  if (!routeFocused) {
    return (
      <View
        style={styles.container}
        {...partnerRouteAccessibilityProps(false)}
      />
    );
  }

  const submit = (draft: PartnerServiceRequestDraft) => {
    setFormError("");
    if (!routeFocused || !requestOrganizationId || !selectedOrganization || !supported || organizationChanged) {
      setFormError("Select a dealership or fleet organization before creating a request.");
      return;
    }
    if (selectedOrganization.status !== "active") {
      setFormError("This organization is inactive. Existing requests are readable, but writes are disabled.");
      return;
    }
    if (!draft.operationId) {
      setFormError("Select one registered vehicle operation.");
      return;
    }
    if (!draft.locationId) {
      setFormError("Select one active linked location.");
      return;
    }
    const location = (locationsQuery.data ?? []).find((candidate) => candidate.id === draft.locationId);
    if (!location || location.status === "inactive") {
      setFormError("Choose an active location linked to this organization.");
      return;
    }
    if (!draft.requestedWork.trim()) {
      setFormError("Describe the requested work.");
      return;
    }
    const clientRequestId =
      requestIds.current.get(draft.operationId) ??
      createClientRequestId(requestOrganizationId, draft.operationId);
    requestIds.current.set(draft.operationId, clientRequestId);
    const originalContextKey = contextKey;
    mutationContextRef.current = originalContextKey;
    createMutation.mutate(
      {
        organizationId: requestOrganizationId,
        data: {
          operationId: draft.operationId,
          locationId: draft.locationId,
          category: draft.category,
          urgency: draft.urgency,
          requestedWork: draft.requestedWork.trim(),
          serviceNotes: draft.serviceNotes.trim() || null,
          clientRequestId,
        },
      },
      {
        onSuccess: (request) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          router.replace(`/(shop-owner)/service-requests/${request.id}` as never);
        },
        onError: (error) => {
          if (
            !routeFocusedRef.current ||
            mutationContextRef.current !== originalContextKey ||
            contextKeyRef.current !== originalContextKey
          ) {
            return;
          }
          setFormError(
            `${errorMessage(error, "Unable to create the service request.")} Your retry keeps the same client request ID to prevent duplicates.`,
          );
        },
      },
    );
  };

  if (
    organizationsQuery.isLoading ||
    !isSelectionReady ||
    locationsQuery.isLoading ||
    operationsQuery.isLoading
  ) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading request context…</Text>
      </View>
    );
  }

  if (organizationChanged) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "New service request" }} />
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
        <Stack.Screen options={{ title: "New service request" }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Select an organization first</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          A request must belong to the active dealership or fleet organization.
        </Text>
      </View>
    );
  }

  if (!supported) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "New service request" }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Service requests unavailable</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} organizations do not have this workflow.
        </Text>
      </View>
    );
  }

  if (selectedOrganization.status !== "active") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Stack.Screen options={{ title: "New service request" }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Organization is inactive</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          Existing requests remain readable, but new requests require an active organization and active linked location.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "New service request" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!contextReady ? (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>Refreshing organization context…</Text>
          </View>
        ) : null}
        {contextReady ? (
          <PartnerServiceRequestForm
            key={contextKey}
            subtype={selectedOrganization.subtype as "dealership" | "fleet"}
            operations={operationsQuery.data ?? []}
            locations={locationsQuery.data ?? []}
            mode="create"
            initialOperationId={Number.isInteger(initialOperationId) ? initialOperationId : null}
            isSaving={createMutation.isPending && mutationContextRef.current === contextKey}
            error={formError}
          onCancel={() => router.dismissTo("/(shop-owner)/service-requests" as never)}
            onSubmit={submit}
          />
        ) : (
          <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>Refreshing organization context…</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 120 },
  center: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  muted: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  notice: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 6, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
});