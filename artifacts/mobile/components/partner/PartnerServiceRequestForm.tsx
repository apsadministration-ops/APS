import { Feather } from "@expo/vector-icons";
import type {
  PartnerServiceRequest,
  PartnerServiceRequestCategory,
  PartnerServiceRequestUrgency,
  PartnerVehicleOperation,
} from "@workspace/api-client-react";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  PARTNER_SERVICE_REQUEST_CATEGORIES,
  PARTNER_SERVICE_REQUEST_URGENCIES,
  REQUEST_CATEGORY_LABELS,
  REQUEST_URGENCY_LABELS,
} from "@/lib/partnerServiceRequest";

export type PartnerServiceRequestLocation = {
  id: number;
  name: string;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  status?: string | null;
};

export type PartnerServiceRequestDraft = {
  operationId: number | null;
  locationId: number | null;
  category: PartnerServiceRequestCategory;
  urgency: PartnerServiceRequestUrgency;
  requestedWork: string;
  serviceNotes: string;
};

type Props = {
  subtype: "dealership" | "fleet";
  operations: PartnerVehicleOperation[];
  locations: PartnerServiceRequestLocation[];
  mode: "create" | "edit";
  initialRequest?: PartnerServiceRequest | null;
  initialOperationId?: number | null;
  isSaving?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (draft: PartnerServiceRequestDraft) => void;
};

const EMPTY_DRAFT: PartnerServiceRequestDraft = {
  operationId: null,
  locationId: null,
  category: "maintenance",
  urgency: "normal",
  requestedWork: "",
  serviceNotes: "",
};

function contextForOperation(
  operation: PartnerVehicleOperation | undefined,
  subtype: "dealership" | "fleet",
) {
  if (!operation) return [];
  const vehicle = [
    `${operation.year} ${operation.make} ${operation.model}`,
    `VIN ${operation.vin}`,
    operation.plateNumber ? `Plate ${operation.plateNumber}` : null,
  ].filter(Boolean);
  if (subtype === "dealership") {
    return [
      ...vehicle,
      operation.stockNumber ? `Stock ${operation.stockNumber}` : null,
      operation.inventoryStatus ? `Inventory ${operation.inventoryStatus.replace("_", " ")}` : null,
      operation.serviceNeeded == null
        ? null
        : operation.serviceNeeded
          ? "Service needed"
          : "Service ready",
      operation.serviceNotes ? `Vehicle service note: ${operation.serviceNotes}` : null,
    ].filter((item): item is string => Boolean(item));
  }
  return [
    ...vehicle,
    operation.unitNumber ? `Unit ${operation.unitNumber}` : null,
    operation.groupName ? `Group ${operation.groupName}` : null,
    operation.operatingStatus
      ? `Operating status ${operation.operatingStatus.replace("_", " ")}`
      : null,
    operation.odometer == null ? null : `Odometer ${operation.odometer.toLocaleString()} mi`,
    operation.usageHours == null ? null : `Usage ${operation.usageHours.toLocaleString()} hr`,
    operation.maintenanceDueDate ? `Maintenance due ${operation.maintenanceDueDate}` : null,
    operation.maintenanceDueMileage == null
      ? null
      : `Maintenance due at ${operation.maintenanceDueMileage.toLocaleString()} mi`,
    operation.downtimeSince ? `Downtime since ${operation.downtimeSince}` : null,
    operation.notes ? `Vehicle operations note: ${operation.notes}` : null,
  ].filter((item): item is string => Boolean(item));
}

export function PartnerServiceRequestForm({
  subtype,
  operations,
  locations,
  mode,
  initialRequest,
  initialOperationId,
  isSaving = false,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const colors = useColors();
  const [draft, setDraft] = useState<PartnerServiceRequestDraft>(() => {
    if (!initialRequest) {
      return {
        ...EMPTY_DRAFT,
        operationId: initialOperationId ?? null,
      };
    }
    return {
      operationId: initialRequest.operationId,
      locationId: initialRequest.locationId,
      category: initialRequest.category,
      urgency: initialRequest.urgency,
      requestedWork: initialRequest.requestedWork,
      serviceNotes: initialRequest.serviceNotes ?? "",
    };
  });

  // A route can stay mounted while the organization or request changes. Do
  // not allow a previous form to leak into a new organization context.
  useEffect(() => {
    if (!initialRequest) {
      setDraft({ ...EMPTY_DRAFT, operationId: initialOperationId ?? null });
      return;
    }
    setDraft({
      operationId: initialRequest.operationId,
      locationId: initialRequest.locationId,
      category: initialRequest.category,
      urgency: initialRequest.urgency,
      requestedWork: initialRequest.requestedWork,
      serviceNotes: initialRequest.serviceNotes ?? "",
    });
  }, [initialOperationId, initialRequest]);

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === draft.operationId),
    [draft.operationId, operations],
  );
  const contextLines = useMemo(
    () => contextForOperation(selectedOperation, subtype),
    [selectedOperation, subtype],
  );
  const activeLocations = useMemo(
    () => locations.filter((location) => location.status !== "inactive"),
    [locations],
  );
  const selectedLocation = locations.find((location) => location.id === draft.locationId);

  const setField = <K extends keyof PartnerServiceRequestDraft>(
    field: K,
    value: PartnerServiceRequestDraft[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));

  const submit = () => {
    onSubmit({
      ...draft,
      requestedWork: draft.requestedWork.trim(),
      serviceNotes: draft.serviceNotes.trim(),
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {mode === "create" ? "New service request" : "Edit service request"}
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {mode === "create"
              ? "Choose a registered operation. Vehicle identity and operational context are captured by the server."
              : "Content can be edited while this request is Draft or Submitted. Vehicle identity and captured context are immutable."}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close service request form" onPress={onCancel}>
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Registered vehicle</Text>
      {mode === "create" ? (
        operations.length > 0 ? (
          <View style={styles.operationList}>
            {operations.map((operation) => {
              const selected = operation.id === draft.operationId;
              return (
                <Pressable
                  key={operation.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? "Selected" : "Select"} ${operation.year} ${operation.make} ${operation.model}`}
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      operationId: operation.id,
                      locationId: current.locationId ?? operation.linkedShopId,
                    }))
                  }
                  style={[
                    styles.operationOption,
                    {
                      backgroundColor: selected ? colors.primary + "14" : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Feather
                    name={selected ? "check-circle" : "circle"}
                    size={18}
                    color={selected ? colors.primary : colors.mutedForeground}
                  />
                  <View style={styles.operationCopy}>
                    <Text style={[styles.operationTitle, { color: selected ? colors.primary : colors.foreground }]}>
                      {operation.year} {operation.make} {operation.model}
                    </Text>
                    <Text style={[styles.operationMeta, { color: colors.mutedForeground }]}>
                      VIN {operation.vin}
                      {subtype === "dealership"
                        ? operation.stockNumber
                          ? ` · Stock ${operation.stockNumber}`
                          : ""
                        : operation.unitNumber
                          ? ` · Unit ${operation.unitNumber}`
                          : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No registered vehicles are available in this organization.
          </Text>
        )
      ) : (
        <View style={[styles.readonlyCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <View style={styles.operationCopy}>
            <Text style={[styles.operationTitle, { color: colors.foreground }]}>
              {selectedOperation
                ? `${selectedOperation.year} ${selectedOperation.make} ${selectedOperation.model}`
                : `Operation #${draft.operationId}`}
            </Text>
            <Text style={[styles.operationMeta, { color: colors.mutedForeground }]}>
              {selectedOperation ? `VIN ${selectedOperation.vin}` : "Registered operation context"}
            </Text>
          </View>
        </View>
      )}

      {selectedOperation ? (
        <View style={[styles.contextCard, { backgroundColor: colors.primary + "0D", borderColor: colors.primary + "55" }]}>
          <View style={styles.contextHeader}>
            <Feather name="database" size={14} color={colors.primary} />
            <Text style={[styles.contextTitle, { color: colors.primary }]}>
              {mode === "create" ? "Captured automatically on create" : "Creation snapshot"}
            </Text>
          </View>
          {contextLines.map((line) => (
            <Text key={line} style={[styles.contextLine, { color: colors.mutedForeground }]}>
              {line}
            </Text>
          ))}
          <Text style={[styles.contextFootnote, { color: colors.mutedForeground }]}>
            No VIN, stock/unit, or vehicle context re-entry is required.
          </Text>
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Service location</Text>
      <View style={styles.locationList}>
        {activeLocations.map((location) => {
          const selected = draft.locationId === location.id;
          return (
            <Pressable
              key={location.id}
              accessibilityRole="button"
              accessibilityLabel={`${selected ? "Selected" : "Select"} ${location.name}`}
              onPress={() => setField("locationId", location.id)}
              style={[
                styles.locationOption,
                {
                  backgroundColor: selected ? colors.primary + "14" : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name={selected ? "check-square" : "square"}
                size={17}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <View style={styles.locationCopy}>
                <Text style={[styles.locationName, { color: selected ? colors.primary : colors.foreground }]}>
                  {location.name}
                </Text>
                <Text style={[styles.locationAddress, { color: colors.mutedForeground }]}>
                  {[location.address, location.city, location.region].filter(Boolean).join(", ")}
                  {location.status === "inactive" ? " · inactive" : ""}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {selectedLocation?.status === "inactive" ? (
        <Text style={[styles.warning, { color: colors.destructive }]}>
          This location is inactive. Choose an active linked location before saving.
        </Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Request details</Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>CATEGORY *</Text>
      <View style={styles.chipRow}>
        {PARTNER_SERVICE_REQUEST_CATEGORIES.map((category) => {
          const selected = draft.category === category;
          return (
            <Pressable
              key={category}
              accessibilityRole="button"
              onPress={() => setField("category", category)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: "700" }}>
                {REQUEST_CATEGORY_LABELS[category]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>URGENCY *</Text>
      <View style={styles.chipRow}>
        {PARTNER_SERVICE_REQUEST_URGENCIES.map((urgency) => {
          const selected = draft.urgency === urgency;
          return (
            <Pressable
              key={urgency}
              accessibilityRole="button"
              onPress={() => setField("urgency", urgency)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: "700" }}>
                {REQUEST_URGENCY_LABELS[urgency]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>REQUESTED WORK *</Text>
      <TextInput
        accessibilityLabel="Requested work"
        style={[styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        placeholder="Describe the service needed…"
        placeholderTextColor={colors.mutedForeground}
        value={draft.requestedWork}
        onChangeText={(value) => setField("requestedWork", value)}
        multiline
        textAlignVertical="top"
      />

      <Text style={[styles.label, { color: colors.mutedForeground }]}>SERVICE NOTES</Text>
      <TextInput
        accessibilityLabel="Service notes"
        style={[styles.textarea, styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        placeholder="Optional internal note for this request…"
        placeholderTextColor={colors.mutedForeground}
        value={draft.serviceNotes}
        onChangeText={(value) => setField("serviceNotes", value)}
        multiline
        textAlignVertical="top"
      />

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={submit}
        disabled={isSaving}
        style={[styles.submitButton, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
            {mode === "create" ? "Create draft request" : "Save request changes"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, gap: 8, padding: 15, marginTop: 10 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  sectionTitle: { fontSize: 14, fontWeight: "800", marginTop: 10 },
  operationList: { gap: 7 },
  operationOption: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 9, padding: 10 },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitle: { fontSize: 13, fontWeight: "700" },
  operationMeta: { fontFamily: "monospace", fontSize: 10, marginTop: 3 },
  readonlyCard: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 9, padding: 10 },
  contextCard: { borderRadius: 10, borderWidth: 1, gap: 3, padding: 10 },
  contextHeader: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 2 },
  contextTitle: { fontSize: 12, fontWeight: "800" },
  contextLine: { fontSize: 11, lineHeight: 16 },
  contextFootnote: { fontSize: 10, fontStyle: "italic", lineHeight: 15, marginTop: 4 },
  locationList: { gap: 7 },
  locationOption: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 9, padding: 10 },
  locationCopy: { flex: 1, minWidth: 0 },
  locationName: { fontSize: 13, fontWeight: "700" },
  locationAddress: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  warning: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  textarea: { borderRadius: 10, borderWidth: 1, fontSize: 14, minHeight: 86, padding: 11 },
  notesInput: { minHeight: 70 },
  emptyText: { fontSize: 12, fontStyle: "italic", paddingVertical: 8 },
  error: { fontSize: 13, lineHeight: 18 },
  submitButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 46, marginTop: 5 },
  submitText: { fontSize: 14, fontWeight: "800" },
});