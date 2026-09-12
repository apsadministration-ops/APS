import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { PartnerSubtypeCapability } from "@/lib/partnerSubtypeCapabilities";
import { useColors } from "@/hooks/useColors";

export type PartnerVehicleDraft = {
  vin: string;
  make: string;
  model: string;
  year: string;
  plate: string;
  mileage: string;
  locationId: number | null;
  serviceNeeded: boolean;
  stockNumber: string;
  inventoryStatus: string;
  serviceNotes: string;
  group: string;
  unitNumber: string;
  operatingStatus: string;
  odometer: string;
  usageHours: string;
  maintenanceDueDate: string;
  maintenanceDueMileage: string;
  downtimeSince: string;
  notes: string;
};

export const EMPTY_PARTNER_VEHICLE_DRAFT: PartnerVehicleDraft = {
  vin: "",
  make: "",
  model: "",
  year: "",
  plate: "",
  mileage: "",
  locationId: null,
  serviceNeeded: false,
  stockNumber: "",
  inventoryStatus: "in_stock",
  serviceNotes: "",
  group: "",
  unitNumber: "",
  operatingStatus: "active",
  odometer: "",
  usageHours: "",
  maintenanceDueDate: "",
  maintenanceDueMileage: "",
  downtimeSince: "",
  notes: "",
};

type PartnerLocation = {
  id: number;
  name: string;
  city?: string | null;
  region?: string | null;
  status?: "active" | "inactive";
};

type Props = {
  capability: PartnerSubtypeCapability;
  locations: PartnerLocation[];
  draft: PartnerVehicleDraft;
  error?: string;
  isSaving?: boolean;
  mode?: "create" | "edit" | "import";
  onChange: <K extends keyof PartnerVehicleDraft>(
    field: K,
    value: PartnerVehicleDraft[K],
  ) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onImportLegacy?: () => void;
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
  autoCapitalize?: "none" | "characters" | "words";
  editable?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label.replace(" *", "")}
        style={[
          styles.input,
          { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
      />
    </View>
  );
}

export function PartnerVehicleForm({
  capability,
  locations,
  draft,
  error,
  isSaving = false,
  mode = "create",
  onChange,
  onCancel,
  onSubmit,
  onImportLegacy,
}: Props) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={
              mode === "edit"
                ? "Edit vehicle operations"
                : mode === "import"
                  ? "Import legacy vehicle"
                  : capability.subtype === "dealership"
                    ? "Add dealership vehicle"
                    : "Add fleet vehicle"
            }
            style={[styles.title, { color: colors.foreground }]}
          >
            {mode === "edit"
              ? "Edit vehicle operations"
              : mode === "import"
                ? "Import legacy vehicle"
                : capability.subtype === "dealership"
                  ? "Add dealership vehicle"
                  : "Add fleet vehicle"}
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {mode === "edit"
              ? "Canonical VIN identity is immutable. Update operational fields only."
              : "Canonical VIN identity is kept separate from customer ownership history."}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close vehicle form" onPress={onCancel}>
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Vehicle identity</Text>
      <Field
        label="VIN *"
        value={draft.vin}
        onChangeText={(value) => onChange("vin", value.toUpperCase())}
        placeholder="17-character VIN"
        autoCapitalize="characters"
        editable={mode === "create"}
      />
      <View style={styles.inputRow}>
        <View style={styles.yearField}>
          <Field
            label="YEAR *"
            value={draft.year}
            onChangeText={(value) => onChange("year", value)}
            placeholder="2024"
            keyboardType="number-pad"
            editable={mode === "create"}
          />
        </View>
        <View style={styles.wideField}>
          <Field
            label="MAKE *"
            value={draft.make}
            onChangeText={(value) => onChange("make", value)}
            placeholder="Ford"
            editable={mode === "create"}
          />
        </View>
        <View style={styles.wideField}>
          <Field
            label="MODEL *"
            value={draft.model}
            onChangeText={(value) => onChange("model", value)}
            placeholder="Transit"
            editable={mode === "create"}
          />
        </View>
      </View>
      <Field
        label="PLATE"
        value={draft.plate}
        onChangeText={(value) => onChange("plate", value.toUpperCase())}
        placeholder="ABC-1234"
        autoCapitalize="characters"
        editable={mode === "create"}
      />
      <Field
        label="CURRENT MILEAGE *"
        value={draft.mileage}
        onChangeText={(value) => onChange("mileage", value)}
        placeholder="125000"
        keyboardType="number-pad"
        editable={mode === "create"}
      />

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Linked locations</Text>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Select one active physical location for this operation. The organization may have multiple
        explicitly linked locations; the operation can be moved between them later.
      </Text>
      {locations.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No active linked locations are available for this write.
        </Text>
      ) : (
        <View style={styles.locationList}>
          {locations.map((location) => {
            const selected = draft.locationId === location.id;
            const writeEligible = location.status !== "inactive";
            return (
              <Pressable
                key={location.id}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? "Selected" : "Select"} ${location.name}${writeEligible ? "" : " (inactive)"}`}
                accessibilityState={{ disabled: !writeEligible, selected }}
                disabled={!writeEligible}
                onPress={() => onChange("locationId", selected ? null : location.id)}
                style={[
                  styles.locationOption,
                  {
                    backgroundColor: selected ? colors.primary + "14" : colors.background,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: writeEligible ? 1 : 0.55,
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
                    {[location.city, location.region].filter(Boolean).join(", ")}
                    {!writeEligible ? " · inactive (choose an active destination)" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {capability.subtype === "dealership" ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Dealership operations</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Service needed${draft.serviceNeeded ? ", selected" : ""}`}
            accessibilityState={{ selected: draft.serviceNeeded }}
            onPress={() => onChange("serviceNeeded", !draft.serviceNeeded)}
            style={[styles.toggleRow, { backgroundColor: colors.background, borderColor: colors.border }]}
          >
            <Feather
              name={draft.serviceNeeded ? "check-square" : "square"}
              size={19}
              color={draft.serviceNeeded ? colors.primary : colors.mutedForeground}
            />
            <Text style={[styles.toggleText, { color: colors.foreground }]}>Service needed</Text>
          </Pressable>
          <Field
            label="STOCK NUMBER *"
            value={draft.stockNumber}
            onChangeText={(value) => onChange("stockNumber", value)}
            placeholder="D-1001"
          />
          <Text style={[styles.label, { color: colors.mutedForeground }]}>INVENTORY STATUS *</Text>
          <View style={styles.chipRow}>
            {["in_stock", "preparing", "ready", "sold"].map((status) => {
              const selected = draft.inventoryStatus === status;
              return (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                accessibilityLabel={`Inventory status: ${status.replace("_", " ")}`}
                accessibilityState={{ selected }}
                  onPress={() => onChange("inventoryStatus", status)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: "700" }}>
                    {status.replace("_", " ")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Field
            label="SERVICE NOTES"
            value={draft.serviceNotes}
            onChangeText={(value) => onChange("serviceNotes", value)}
            placeholder="Optional dealer preparation note"
          />
        </>
      ) : (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Fleet operations</Text>
          <View style={styles.inputRow}>
            <View style={styles.wideField}>
              <Field
                label="GROUP *"
                value={draft.group}
                onChangeText={(value) => onChange("group", value)}
                placeholder="Regional service"
              />
            </View>
            <View style={styles.wideField}>
              <Field
                label="UNIT NUMBER *"
                value={draft.unitNumber}
                onChangeText={(value) => onChange("unitNumber", value)}
                placeholder="Unit 104"
              />
            </View>
          </View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>OPERATING STATUS *</Text>
          <View style={styles.chipRow}>
            {["active", "maintenance", "out_of_service", "retired"].map((status) => {
              const selected = draft.operatingStatus === status;
              return (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                  accessibilityLabel={`Operating status: ${status.replace(/_/g, " ")}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChange("operatingStatus", status)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: "700" }}>
                    {status.replace(/_/g, " ")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.inputRow}>
            <View style={styles.wideField}>
              <Field
                label="ODOMETER"
                value={draft.odometer}
                onChangeText={(value) => onChange("odometer", value)}
                placeholder="125000"
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.wideField}>
              <Field
                label="USAGE HOURS"
                value={draft.usageHours}
                onChangeText={(value) => onChange("usageHours", value)}
                placeholder="3200"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <View style={styles.inputRow}>
            <View style={styles.wideField}>
              <Field
                label="MAINTENANCE DUE DATE"
                value={draft.maintenanceDueDate}
                onChangeText={(value) => onChange("maintenanceDueDate", value)}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <View style={styles.wideField}>
              <Field
                label="MAINTENANCE DUE MILEAGE"
                value={draft.maintenanceDueMileage}
                onChangeText={(value) => onChange("maintenanceDueMileage", value)}
                placeholder="130000"
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Field
            label="DOWNTIME SINCE"
            value={draft.downtimeSince}
            onChangeText={(value) => onChange("downtimeSince", value)}
            placeholder="ISO date-time"
          />
          <Field
            label="NOTES"
            value={draft.notes}
            onChangeText={(value) => onChange("notes", value)}
            placeholder="Optional fleet note"
          />
        </>
      )}

      <View style={[styles.safetyNotice, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "40" }]}>
        <Feather name="shield" size={15} color={colors.primary} />
        <Text style={[styles.safetyText, { color: colors.mutedForeground }]}>
          This form never claims customer VIN ownership. Legacy import is allowed only through the
          explicit, authorized vehicle-link endpoint.
        </Text>
      </View>
      {onImportLegacy ? (
        <Pressable
          accessibilityRole="button"
          onPress={onImportLegacy}
          style={[styles.outlineButton, { borderColor: colors.primary }]}
        >
          <Feather name="download" size={15} color={colors.primary} />
          <Text style={[styles.outlineButtonText, { color: colors.primary }]}>Choose legacy vehicle</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={isSaving}
        style={[styles.submitButton, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Save vehicle</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, gap: 8, padding: 16, marginTop: 12 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17 },
  sectionTitle: { fontSize: 14, fontWeight: "800", marginTop: 10 },
  field: { flex: 1, gap: 4 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7 },
  input: { borderRadius: 9, borderWidth: 1, fontSize: 14, height: 43, paddingHorizontal: 11 },
  inputRow: { flexDirection: "row", gap: 9 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  yearField: { flex: 1 },
  wideField: { flex: 2 },
  locationList: { gap: 7 },
  locationOption: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 9, padding: 10 },
  locationCopy: { flex: 1 },
  locationName: { fontSize: 13, fontWeight: "700" },
  locationAddress: { fontSize: 11, marginTop: 2 },
  emptyText: { fontSize: 12, fontStyle: "italic", paddingVertical: 8 },
  toggleRow: { alignItems: "center", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  toggleText: { fontSize: 13, fontWeight: "600" },
  safetyNotice: { alignItems: "flex-start", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 8, padding: 10 },
  safetyText: { flex: 1, fontSize: 11, lineHeight: 16 },
  outlineButton: { alignItems: "center", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
  outlineButtonText: { fontSize: 12, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  submitButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 46, marginTop: 4 },
  submitText: { fontSize: 14, fontWeight: "800" },
});