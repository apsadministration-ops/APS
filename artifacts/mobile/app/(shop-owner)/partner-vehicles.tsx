import { Feather } from "@expo/vector-icons";
import {
  getListPartnerOrganizationLocationsQueryKey,
  getListPartnerOrganizationsQueryKey,
  getListPartnerVehicleOperationsQueryKey,
  getListVehiclesQueryKey,
  useCreatePartnerVehicleOperation,
  useLinkPartnerVehicleOperation,
  useListPartnerVehicleOperations,
  useListVehicles,
  useUpdatePartnerVehicleOperation,
  type PartnerVehicleOperationInput,
  type PartnerVehicleOperationLink,
  type PartnerVehicleOperationUpdate,
  useListPartnerOrganizationLocations,
  useListPartnerOrganizations,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PartnerVehicleCard, type PartnerVehicleRecord } from "@/components/partner/PartnerVehicleCard";
import {
  PartnerVehicleFilters,
  type FleetStatusFilter,
  type VehicleServiceFilter,
} from "@/components/partner/PartnerVehicleFilters";
import {
  EMPTY_PARTNER_VEHICLE_DRAFT,
  PartnerVehicleForm,
  type PartnerVehicleDraft,
} from "@/components/partner/PartnerVehicleForm";
import { PartnerLegacyVehiclePicker } from "@/components/partner/PartnerLegacyVehiclePicker";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { buildPartnerVehicleIdentityPayload } from "@/lib/partnerVehicleOperationPayload";
import {
  partnerOrganizationSubtypeLabel,
} from "@/lib/partnerOrganization";
import {
  partnerSubtypeCapability,
  type PartnerSubtypeCapability,
} from "@/lib/partnerSubtypeCapabilities";
import { useSelectedPartnerOrganization } from "@/hooks/useSelectedPartnerOrganization";

type FormMode = "create" | "edit" | "import";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function capabilityIcon(capability: PartnerSubtypeCapability): keyof typeof Feather.glyphMap {
  return capability.icon;
}

export default function PartnerVehiclesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user && user.role === "shop_owner";
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingOperationId, setEditingOperationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PartnerVehicleDraft>({ ...EMPTY_PARTNER_VEHICLE_DRAFT });
  const [formError, setFormError] = useState("");
  const [serviceFilter, setServiceFilter] = useState<VehicleServiceFilter>("all");
  const [fleetStatusFilter, setFleetStatusFilter] = useState<FleetStatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const [screenNotice, setScreenNotice] = useState("");
  const [legacyVehicleId, setLegacyVehicleId] = useState<number | null>(null);
  const [showLegacyPicker, setShowLegacyPicker] = useState(false);
  const [contextResetKey, setContextResetKey] = useState("");
  const [pendingMutationToken, setPendingMutationToken] = useState<string | null>(null);
  const mutationSequenceRef = useRef(0);
  const pendingMutationRef = useRef<string | null>(null);

  const {
    data: organizations,
    error: organizationsError,
    isLoading: organizationsLoading,
    refetch: refetchOrganizations,
    isRefetching: organizationsRefetching,
  } = useListPartnerOrganizations({
    query: {
      enabled,
      queryKey: getListPartnerOrganizationsQueryKey(),
    },
  });
  const {
    data: legacyVehicles,
    error: legacyVehiclesError,
    isLoading: legacyVehiclesLoading,
  } = useListVehicles({
    query: { enabled, staleTime: 30_000, queryKey: getListVehiclesQueryKey() },
  });
  const { selectedId, selectedOrganization } = useSelectedPartnerOrganization(user?.id, organizations);
  const {
    data: linkedLocations,
    error: linkedLocationsError,
    isLoading: linkedLocationsLoading,
    refetch: refetchLinkedLocations,
    isRefetching: linkedLocationsRefetching,
  } = useListPartnerOrganizationLocations(selectedId ?? 0, {
    query: {
      enabled: enabled && selectedId != null,
      queryKey: getListPartnerOrganizationLocationsQueryKey(selectedId ?? 0),
    },
  });

  const capability = partnerSubtypeCapability(selectedOrganization?.subtype);
  const ownerId = user?.id ?? null;
  const selectedSubtype = selectedOrganization?.subtype ?? null;
  const contextKey = `${ownerId ?? "none"}:${selectedId ?? "none"}:${selectedSubtype ?? "none"}`;
  const currentContextKeyRef = useRef(contextKey);
  currentContextKeyRef.current = contextKey;
  const contextReady = contextResetKey === contextKey;
  const {
    data: operations,
    error: operationsError,
    isLoading: operationsLoading,
    isRefetching: operationsRefetching,
    refetch: refetchOperations,
  } = useListPartnerVehicleOperations(selectedId ?? 0, {
    query: {
      enabled: enabled && capability?.primaryArea.endsWith("-vehicles") === true,
      queryKey: getListPartnerVehicleOperationsQueryKey(selectedId ?? 0),
    },
  });
  const createMutation = useCreatePartnerVehicleOperation();
  const linkMutation = useLinkPartnerVehicleOperation();
  const updateMutation = useUpdatePartnerVehicleOperation();

  const vehicles = useMemo<PartnerVehicleRecord[]>(
    () => (operations ?? []) as PartnerVehicleRecord[],
    [operations],
  );

  const visibleVehicles = useMemo(() => {
    if (!contextReady) return [];
    const normalizedSearch = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (
        normalizedSearch &&
        ![
          vehicle.vin,
          vehicle.make,
          vehicle.model,
          vehicle.plateNumber,
          vehicle.unitNumber,
          vehicle.groupName,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch))
      ) {
        return false;
      }
      if (capability?.subtype === "dealership" && serviceFilter !== "all") {
        const needed = vehicle.serviceNeeded;
        if (needed == null) return false;
        if (serviceFilter === "needed" && !needed) return false;
        if (serviceFilter === "ready" && needed) return false;
      }
      if (capability?.subtype === "fleet") {
        if (
          groupFilter.trim() &&
          !(vehicle.groupName ?? "").toLowerCase().includes(groupFilter.trim().toLowerCase())
        ) {
          return false;
        }
        if (fleetStatusFilter !== "all" && vehicle.operatingStatus !== fleetStatusFilter) return false;
      }
      return true;
    });
  }, [capability?.subtype, contextReady, fleetStatusFilter, groupFilter, search, serviceFilter, vehicles]);

  const locationNameById = useMemo(
    () => new Map((linkedLocations ?? []).map((location) => [location.id, location.name])),
    [linkedLocations],
  );
  const isLoading = organizationsLoading || linkedLocationsLoading || operationsLoading;
  const queryError =
    organizationsError ?? linkedLocationsError ?? operationsError ?? legacyVehiclesError;
  const hasVehicleOperations = capability?.primaryArea.endsWith("-vehicles") === true;

  useEffect(() => {
    setShowForm(false);
    setFormMode("create");
    setEditingOperationId(null);
    setDraft({ ...EMPTY_PARTNER_VEHICLE_DRAFT });
    setFormError("");
    setServiceFilter("all");
    setFleetStatusFilter("all");
    setGroupFilter("");
    setSearch("");
    setScreenNotice("");
    setLegacyVehicleId(null);
    setShowLegacyPicker(false);
    pendingMutationRef.current = null;
    setPendingMutationToken(null);
    setContextResetKey(contextKey);
  }, [contextKey, ownerId, selectedId, selectedSubtype]);

  const beginMutation = () => {
    const token = `${contextKey}:${++mutationSequenceRef.current}`;
    pendingMutationRef.current = token;
    setPendingMutationToken(token);
    return token;
  };

  const canApplyMutation = (token: string, originalContextKey: string) =>
    pendingMutationRef.current === token &&
    currentContextKeyRef.current === originalContextKey;

  const setDraftField = <K extends keyof PartnerVehicleDraft>(
    field: K,
    value: PartnerVehicleDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const openCreate = () => {
    setScreenNotice("");
    setFormError("");
    setFormMode("create");
    setEditingOperationId(null);
    setLegacyVehicleId(null);
    setDraft({ ...EMPTY_PARTNER_VEHICLE_DRAFT });
    setShowForm(true);
  };

  const openEdit = (vehicle: PartnerVehicleRecord) => {
    setScreenNotice("");
    setFormError("");
    setFormMode("edit");
    setEditingOperationId(vehicle.id);
    setLegacyVehicleId(null);
    setDraft({
      ...EMPTY_PARTNER_VEHICLE_DRAFT,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: String(vehicle.year),
      plate: vehicle.plateNumber ?? "",
      mileage: String(vehicle.mileage),
      locationId: vehicle.linkedShopId,
      serviceNeeded: vehicle.serviceNeeded ?? false,
      stockNumber: vehicle.stockNumber ?? "",
      inventoryStatus: vehicle.inventoryStatus ?? "in_stock",
      serviceNotes: vehicle.serviceNotes ?? "",
      group: vehicle.groupName ?? "",
      unitNumber: vehicle.unitNumber ?? "",
      operatingStatus: vehicle.operatingStatus ?? "active",
      odometer: vehicle.odometer == null ? "" : String(vehicle.odometer),
      usageHours: vehicle.usageHours == null ? "" : String(vehicle.usageHours),
      maintenanceDueDate: vehicle.maintenanceDueDate ?? "",
      maintenanceDueMileage:
        vehicle.maintenanceDueMileage == null ? "" : String(vehicle.maintenanceDueMileage),
      downtimeSince: vehicle.downtimeSince ?? "",
      notes: vehicle.notes ?? "",
    });
    setShowForm(true);
  };

  const saveVehicle = () => {
    setFormError("");
    if (draft.vin.trim().length !== 17) {
      setFormError("VIN must be exactly 17 characters.");
      return;
    }
    if (!draft.make.trim() || !draft.model.trim()) {
      setFormError("Make and model are required.");
      return;
    }
    const year = Number(draft.year);
    if (!Number.isInteger(year) || year < 1886 || year > 2200) {
      setFormError("Enter a valid model year.");
      return;
    }
    if (draft.locationId == null) {
      setFormError("Select one active linked location.");
      return;
    }

    if (!selectedId || !capability || !hasVehicleOperations) {
      setFormError("Vehicle operations are not authorized for this organization subtype.");
      return;
    }

    const mileage = Number(draft.mileage);
    if (!Number.isInteger(mileage) || mileage < 0) {
      setFormError("Current mileage must be a non-negative whole number.");
      return;
    }
    if (capability.subtype === "fleet") {
      const optionalError = validateFleetFields();
      if (optionalError) {
        setFormError(optionalError);
        return;
      }
    }

    const originalOrganizationId = selectedId;
    const originalContextKey = contextKey;
    const common = buildPartnerVehicleIdentityPayload({
      linkedShopId: draft.locationId,
      vin: draft.vin,
      make: draft.make,
      model: draft.model,
      year,
      mileage,
      plate: draft.plate,
    });

    if (formMode === "import") {
      if (!legacyVehicleId) {
        setFormError("Choose one eligible legacy vehicle before importing.");
        return;
      }
      const linkData: PartnerVehicleOperationLink = {
        vehicleId: legacyVehicleId,
        linkedShopId: draft.locationId,
      };
      if (capability.subtype === "dealership") {
        if (!draft.stockNumber.trim() || !["in_stock", "preparing", "ready", "sold"].includes(draft.inventoryStatus)) {
          setFormError("Stock number and a valid inventory status are required.");
          return;
        }
        linkData.stockNumber = draft.stockNumber.trim();
        linkData.inventoryStatus = draft.inventoryStatus as PartnerVehicleOperationLink["inventoryStatus"];
        linkData.serviceNeeded = draft.serviceNeeded;
        linkData.serviceNotes = draft.serviceNotes.trim() || null;
      } else {
        if (
          !draft.unitNumber.trim() ||
          !draft.group.trim() ||
          !["active", "maintenance", "out_of_service", "retired"].includes(draft.operatingStatus)
        ) {
          setFormError("Unit number, group, and a valid operating status are required.");
          return;
        }
        linkData.unitNumber = draft.unitNumber.trim();
        linkData.groupName = draft.group.trim();
        linkData.operatingStatus = draft.operatingStatus as PartnerVehicleOperationLink["operatingStatus"];
        const fleetOptional = fleetOperationFields();
        Object.assign(linkData, fleetOptional);
      }
      const mutationToken = beginMutation();
      linkMutation.mutate(
        { organizationId: originalOrganizationId, data: linkData },
        {
          onSuccess: () => {
            if (!canApplyMutation(mutationToken, originalContextKey)) return;
            finishForm(
              "Legacy vehicle linked",
              "The server verified the legacy-import proof before linking this VIN.",
              originalOrganizationId,
              mutationToken,
              originalContextKey,
            );
          },
          onError: (error) => {
            if (!canApplyMutation(mutationToken, originalContextKey)) return;
            setPendingMutationToken(null);
            pendingMutationRef.current = null;
            setFormError(errorMessage(error, "Unable to safely link this legacy vehicle."));
          },
        },
      );
      return;
    }

    if (formMode === "edit") {
      if (!editingOperationId) {
        setFormError("Choose an operation to edit.");
        return;
      }
      const updateData: PartnerVehicleOperationUpdate = {
        linkedShopId: draft.locationId,
      };
      if (capability.subtype === "dealership") {
        if (!draft.stockNumber.trim() || !["in_stock", "preparing", "ready", "sold"].includes(draft.inventoryStatus)) {
          setFormError("Stock number and a valid inventory status are required.");
          return;
        }
        updateData.stockNumber = draft.stockNumber.trim();
        updateData.inventoryStatus = draft.inventoryStatus as PartnerVehicleOperationUpdate["inventoryStatus"];
        updateData.serviceNeeded = draft.serviceNeeded;
        updateData.serviceNotes = draft.serviceNotes.trim() || null;
      } else {
        if (
          !draft.unitNumber.trim() ||
          !draft.group.trim() ||
          !["active", "maintenance", "out_of_service", "retired"].includes(draft.operatingStatus)
        ) {
          setFormError("Unit number, group, and a valid operating status are required.");
          return;
        }
        updateData.unitNumber = draft.unitNumber.trim();
        updateData.groupName = draft.group.trim();
        updateData.operatingStatus = draft.operatingStatus as PartnerVehicleOperationUpdate["operatingStatus"];
        Object.assign(updateData, fleetOperationFields("update"));
      }
      const mutationToken = beginMutation();
      updateMutation.mutate(
        { organizationId: originalOrganizationId, operationId: editingOperationId, data: updateData },
        {
          onSuccess: () => {
            if (!canApplyMutation(mutationToken, originalContextKey)) return;
            finishForm(
              "Vehicle operations updated",
              "Only operational fields were changed.",
              originalOrganizationId,
              mutationToken,
              originalContextKey,
            );
          },
          onError: (error) => {
            if (!canApplyMutation(mutationToken, originalContextKey)) return;
            setPendingMutationToken(null);
            pendingMutationRef.current = null;
            setFormError(errorMessage(error, "Unable to update vehicle operations."));
          },
        },
      );
      return;
    }

    const createData: PartnerVehicleOperationInput = common;
    if (capability.subtype === "dealership") {
      if (!draft.stockNumber.trim() || !["in_stock", "preparing", "ready", "sold"].includes(draft.inventoryStatus)) {
        setFormError("Stock number and a valid inventory status are required.");
        return;
      }
      createData.stockNumber = draft.stockNumber.trim();
      createData.inventoryStatus = draft.inventoryStatus as PartnerVehicleOperationInput["inventoryStatus"];
      createData.serviceNeeded = draft.serviceNeeded;
      createData.serviceNotes = draft.serviceNotes.trim() || null;
    } else {
      if (
        !draft.unitNumber.trim() ||
        !draft.group.trim() ||
        !["active", "maintenance", "out_of_service", "retired"].includes(draft.operatingStatus)
      ) {
        setFormError("Unit number, group, and a valid operating status are required.");
        return;
      }
      createData.unitNumber = draft.unitNumber.trim();
      createData.groupName = draft.group.trim();
      createData.operatingStatus = draft.operatingStatus as PartnerVehicleOperationInput["operatingStatus"];
      Object.assign(createData, fleetOperationFields());
    }
    const mutationToken = beginMutation();
    createMutation.mutate(
      { organizationId: originalOrganizationId, data: createData },
      {
        onSuccess: () => {
          if (!canApplyMutation(mutationToken, originalContextKey)) return;
          finishForm(
            "Vehicle operation created",
            "The canonical vehicle and operational record were created atomically.",
            originalOrganizationId,
            mutationToken,
            originalContextKey,
          );
        },
        onError: (error) => {
          if (!canApplyMutation(mutationToken, originalContextKey)) return;
          setPendingMutationToken(null);
          pendingMutationRef.current = null;
          setFormError(errorMessage(error, "Unable to create vehicle operations."));
        },
      },
    );
  };

  function validateFleetFields() {
    const numericFields: Array<[string, string, "whole" | "decimal"]> = [
      ["Odometer", draft.odometer, "whole"],
      ["Usage hours", draft.usageHours, "decimal"],
      ["Maintenance due mileage", draft.maintenanceDueMileage, "whole"],
    ];
    for (const [label, value, kind] of numericFields) {
      if (!value.trim()) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || (kind === "whole" && !Number.isInteger(parsed))) {
        return `${label} must be a non-negative ${kind === "whole" ? "whole number" : "number"}.`;
      }
    }
    return "";
  }

  function fleetOperationFields(mode: "create" | "update" = "create") {
    const optional: Partial<PartnerVehicleOperationInput> = {};
    const odometer = Number(draft.odometer);
    const usageHours = Number(draft.usageHours);
    const maintenanceDueMileage = Number(draft.maintenanceDueMileage);
    if (mode === "update") {
      const updateFields: Partial<PartnerVehicleOperationUpdate> = {
        odometer: draft.odometer.trim() ? odometer : null,
        usageHours: draft.usageHours.trim() ? usageHours : null,
        maintenanceDueDate: draft.maintenanceDueDate.trim() || null,
        maintenanceDueMileage: draft.maintenanceDueMileage.trim() ? maintenanceDueMileage : null,
        downtimeSince: draft.downtimeSince.trim() || null,
        notes: draft.notes.trim() || null,
      };
      return updateFields;
    }
    if (draft.odometer.trim()) optional.odometer = odometer;
    if (draft.usageHours.trim()) optional.usageHours = usageHours;
    if (draft.maintenanceDueDate.trim()) optional.maintenanceDueDate = draft.maintenanceDueDate.trim();
    if (draft.maintenanceDueMileage.trim()) optional.maintenanceDueMileage = maintenanceDueMileage;
    if (draft.downtimeSince.trim()) optional.downtimeSince = draft.downtimeSince.trim();
    if (draft.notes.trim()) optional.notes = draft.notes.trim();
    return optional;
  }

  function finishForm(
    title: string,
    detail: string,
    originalOrganizationId: number,
    mutationToken: string,
    originalContextKey: string,
  ) {
    if (!canApplyMutation(mutationToken, originalContextKey)) return;
    setShowForm(false);
    setShowLegacyPicker(false);
    setFormError("");
    setScreenNotice(`${title}: ${detail}`);
    setFormMode("create");
    setEditingOperationId(null);
    setLegacyVehicleId(null);
    setPendingMutationToken(null);
    pendingMutationRef.current = null;
    queryClient.invalidateQueries({
      queryKey: getListPartnerVehicleOperationsQueryKey(originalOrganizationId),
    });
  }

  const importLegacyVehicle = () => {
    setFormError("");
    setScreenNotice("");
    setShowLegacyPicker(true);
  };

  const chooseLegacyVehicle = (vehicle: NonNullable<typeof legacyVehicles>[number]) => {
    if (vehicle.ownerShopId == null) return;
    setLegacyVehicleId(vehicle.id);
    setFormMode("import");
    setDraft((current) => ({
      ...current,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: String(vehicle.year),
      plate: vehicle.plateNumber ?? "",
      mileage: String(vehicle.mileage),
      locationId: vehicle.ownerShopId ?? null,
    }));
    setShowLegacyPicker(false);
    setFormError("");
  };

  const refresh = () => {
    void refetchOrganizations();
    if (selectedId != null) void refetchLinkedLocations();
    if (hasVehicleOperations) void refetchOperations();
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
          Loading partner operations…
        </Text>
      </View>
    );
  }

  if (!selectedOrganization || !capability) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Partner operations" }} />
        <ScrollView contentContainerStyle={styles.content}>
          {queryError ? (
            <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text style={[styles.noticeText, { color: colors.destructive }]}>
                {errorMessage(queryError, "Unable to load organizations. Pull to refresh and try again.")}
              </Text>
            </View>
          ) : null}
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="briefcase" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Select an organization</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Partner operational views are scoped to the selected organization. Existing locations
              and legacy vehicle workflows remain available without an organization.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(shop-owner)/organizations" as never)}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                Manage organizations
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(shop-owner)/vehicles" as never)}
              style={[styles.linkButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.linkButtonText, { color: colors.primary }]}>Open legacy vehicles</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: capability.label }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={
              organizationsRefetching ||
              linkedLocationsRefetching ||
              operationsRefetching ||
              legacyVehiclesLoading
            }
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>SELECTED ORGANIZATION</Text>
            <Text style={[styles.heading, { color: colors.foreground }]}>{selectedOrganization.name}</Text>
            <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
              {partnerOrganizationSubtypeLabel(selectedOrganization.subtype)} · scoped partner operations
            </Text>
          </View>
          <View style={[styles.iconBadge, { backgroundColor: colors.primary + "18" }]}>
            <Feather name={capabilityIcon(capability)} size={20} color={colors.primary} />
          </View>
        </View>

        {queryError ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {errorMessage(queryError, "Unable to load partner operations. Pull to refresh and try again.")}
            </Text>
          </View>
        ) : null}
        {screenNotice ? (
          <View style={[styles.notice, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "55" }]}>
            <Feather name="info" size={16} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>{screenNotice}</Text>
          </View>
        ) : null}

        <View style={[styles.capabilityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.capabilityTitle, { color: colors.foreground }]}>{capability.label}</Text>
          <Text style={[styles.capabilityText, { color: colors.mutedForeground }]}>{capability.description}</Text>
          <Text style={[styles.capabilityText, { color: colors.mutedForeground }]}>
            {linkedLocations?.length ?? 0} explicitly linked physical location
            {(linkedLocations?.length ?? 0) === 1 ? "" : "s"}.
          </Text>
        </View>

        {capability.subtype === "shop" ? (
          <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Shop / Ghost Garage management</Text>
            <Text style={[styles.capabilityText, { color: colors.mutedForeground }]}>
              Continue using existing location, bay, availability, and booking management. This
              subtype intentionally has no dealership or fleet vehicle controls.
            </Text>
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(shop-owner)" as never)}
                style={[styles.outlineButton, { borderColor: colors.primary }]}
              >
                <Feather name="map-pin" size={15} color={colors.primary} />
                <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Locations & bays</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(shop-owner)/bookings" as never)}
                style={[styles.outlineButton, { borderColor: colors.primary }]}
              >
                <Feather name="calendar" size={15} color={colors.primary} />
                <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Bookings</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {capability.subtype === "commercial_business" ? (
          <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Organization and locations</Text>
            <Text style={[styles.capabilityText, { color: colors.mutedForeground }]}>
              Commercial businesses use the shared organization profile and explicit physical
              location linking. No subtype-specific vehicle workflow is enabled here.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(shop-owner)/organizations" as never)}
              style={[styles.outlineButton, { borderColor: colors.primary }]}
            >
              <Feather name="briefcase" size={15} color={colors.primary} />
              <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Manage organization</Text>
            </Pressable>
          </View>
        ) : null}

        {hasVehicleOperations ? (
          <>
            <View style={styles.sectionHeader}>
              <View style={styles.headingCopy}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  {capability.subtype === "dealership" ? "Inventory & service readiness" : "Fleet vehicles"}
                </Text>
                <Text style={[styles.capabilityText, { color: colors.mutedForeground }]}>
                  Canonical VIN identity is shown with only this organization’s authorized operational records.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={openCreate}
                style={[styles.addButton, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={15} color={colors.primaryForeground} />
                <Text style={[styles.addButtonText, { color: colors.primaryForeground }]}>Add vehicle</Text>
              </Pressable>
            </View>

            <PartnerVehicleFilters
              capability={capability}
              search={search}
              onSearchChange={setSearch}
              serviceFilter={serviceFilter}
              onServiceFilterChange={setServiceFilter}
              fleetStatusFilter={fleetStatusFilter}
              onFleetStatusFilterChange={setFleetStatusFilter}
              groupFilter={groupFilter}
              onGroupFilterChange={setGroupFilter}
            />

            {contextReady && showForm ? (
              <PartnerVehicleForm
                capability={capability}
                locations={linkedLocations ?? []}
                draft={draft}
                mode={formMode}
                error={formError}
                isSaving={
                  pendingMutationToken?.startsWith(`${contextKey}:`) === true &&
                  (createMutation.isPending || linkMutation.isPending || updateMutation.isPending)
                }
                onChange={setDraftField}
                onCancel={() => {
                  setShowForm(false);
                  setShowLegacyPicker(false);
                  setFormError("");
                }}
                onSubmit={saveVehicle}
                onImportLegacy={formMode === "edit" ? undefined : importLegacyVehicle}
              />
            ) : null}

            {contextReady && showLegacyPicker ? (
              <PartnerLegacyVehiclePicker
                vehicles={legacyVehicles ?? []}
                locations={linkedLocations ?? []}
                isLoading={legacyVehiclesLoading}
                locationNameById={locationNameById}
                onChoose={chooseLegacyVehicle}
                onClose={() => setShowLegacyPicker(false)}
              />
            ) : null}

            {visibleVehicles.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="truck" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {vehicles.length === 0 ? "No operational vehicle records" : "No matching vehicles"}
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {vehicles.length === 0
                    ? "Add an authorized vehicle operation for this organization and one of its linked locations."
                    : "Adjust the search or filter to see another record."}
                </Text>
              </View>
            ) : (
              <View style={styles.vehicleList}>
                {visibleVehicles.map((vehicle) => (
                  <PartnerVehicleCard
                    key={vehicle.id}
                    capability={capability}
                    vehicle={vehicle}
                    locationNames={
                      locationNameById.get(vehicle.linkedShopId)
                        ? [locationNameById.get(vehicle.linkedShopId) as string]
                        : []
                    }
                    onEdit={() => openEdit(vehicle)}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(shop-owner)/organizations" as never)}
          style={styles.backLink}
        >
          <Feather name="briefcase" size={15} color={colors.primary} />
          <Text style={[styles.backLinkText, { color: colors.primary }]}>Change selected organization</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(shop-owner)/vehicles" as never)}
          style={styles.backLink}
        >
          <Feather name="truck" size={15} color={colors.primary} />
          <Text style={[styles.backLinkText, { color: colors.primary }]}>Open legacy vehicles</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 12, padding: 16, paddingBottom: 120 },
  center: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center" },
  loadingText: { fontSize: 13 },
  headingRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  headingCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  heading: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  subheading: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  iconBadge: { alignItems: "center", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  notice: { alignItems: "flex-start", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  capabilityCard: { borderRadius: 13, borderWidth: 1, gap: 4, padding: 13 },
  capabilityTitle: { fontSize: 15, fontWeight: "800" },
  capabilityText: { fontSize: 12, lineHeight: 17 },
  actionCard: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 14 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  addButton: { alignItems: "center", borderRadius: 9, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 8 },
  addButtonText: { fontSize: 12, fontWeight: "800" },
  vehicleList: { gap: 9 },
  emptyCard: { alignItems: "center", borderRadius: 14, borderStyle: "dashed", borderWidth: 1, padding: 27 },
  emptyTitle: { fontSize: 16, fontWeight: "800", marginTop: 10, textAlign: "center" },
  emptyText: { fontSize: 12, lineHeight: 18, marginTop: 4, textAlign: "center" },
  primaryButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 44, marginTop: 14, paddingHorizontal: 16 },
  primaryButtonText: { fontSize: 13, fontWeight: "800" },
  linkButton: { alignItems: "center", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 42, marginTop: 8, paddingHorizontal: 16 },
  linkButtonText: { fontSize: 13, fontWeight: "700" },
  outlineButton: { alignItems: "center", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 39, paddingHorizontal: 11 },
  outlineButtonText: { fontSize: 12, fontWeight: "700" },
  backLink: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 7 },
  backLinkText: { fontSize: 12, fontWeight: "700" },
});