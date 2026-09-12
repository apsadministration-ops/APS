import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { PartnerSubtypeCapability } from "@/lib/partnerSubtypeCapabilities";

export type PartnerVehicleRecord = {
  id: number;
  vin: string;
  make: string;
  model: string;
  year: number;
  plateNumber?: string | null;
  mileage?: number | null;
  serviceCount?: number;
  serviceNeeded?: boolean;
  stockNumber?: string | null;
  inventoryStatus?: string | null;
  serviceNotes?: string | null;
  groupName?: string | null;
  unitNumber?: string | null;
  operatingStatus?: string | null;
  odometer?: number | null;
  usageHours?: number | null;
  maintenanceDueDate?: string | null;
  maintenanceDueMileage?: number | null;
  downtimeSince?: string | null;
  notes?: string | null;
  linkedShopId: number;
};

type Props = {
  capability: PartnerSubtypeCapability;
  vehicle: PartnerVehicleRecord;
  locationNames: string[];
  onEdit?: () => void;
};

export function PartnerVehicleCard({ capability, vehicle, locationNames, onEdit }: Props) {
  const colors = useColors();
  const fleet = capability.subtype === "fleet";
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Text>
          <Text style={[styles.vin, { color: colors.mutedForeground }]}>
            VIN {vehicle.vin}
            {vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : ""}
          </Text>
        </View>
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            onPress={onEdit}
            style={[styles.editButton, { borderColor: colors.primary }]}
          >
            <Feather name="edit-2" size={13} color={colors.primary} />
            <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {fleet ? (
        <View style={styles.metaList}>
          {vehicle.unitNumber || vehicle.groupName ? (
            <Text style={[styles.meta, { color: colors.foreground }]}>
              {vehicle.unitNumber ?? "No unit"}{vehicle.groupName ? ` · ${vehicle.groupName}` : ""}
            </Text>
          ) : null}
          {vehicle.operatingStatus ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Operating status: {vehicle.operatingStatus}
            </Text>
          ) : null}
          {vehicle.odometer != null || vehicle.usageHours != null ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {vehicle.odometer != null ? `${vehicle.odometer.toLocaleString()} mi` : "No odometer"}
              {vehicle.usageHours != null ? ` · ${vehicle.usageHours.toLocaleString()} usage hrs` : ""}
            </Text>
          ) : null}
          {vehicle.maintenanceDueDate || vehicle.maintenanceDueMileage != null || vehicle.downtimeSince ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {vehicle.maintenanceDueDate ? `Maintenance due ${vehicle.maintenanceDueDate}` : ""}
              {vehicle.maintenanceDueMileage != null ? ` · due at ${vehicle.maintenanceDueMileage.toLocaleString()} mi` : ""}
              {vehicle.downtimeSince ? ` · Downtime since ${vehicle.downtimeSince}` : ""}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.metaList}>
          {vehicle.serviceNeeded != null ? (
            <Text style={[styles.meta, { color: vehicle.serviceNeeded ? "#B45309" : "#15803D" }]}>
              {vehicle.serviceNeeded ? "Service needed" : "Service ready"}
            </Text>
          ) : null}
          {vehicle.inventoryStatus ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Inventory status: {vehicle.inventoryStatus}
            </Text>
          ) : null}
          {vehicle.stockNumber ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Stock number: {vehicle.stockNumber}
            </Text>
          ) : null}
          {vehicle.serviceNotes ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Service note: {vehicle.serviceNotes}
            </Text>
          ) : null}
        </View>
      )}

      {locationNames.length > 0 ? (
        <Text style={[styles.locations, { color: colors.mutedForeground }]}>
          Locations: {locationNames.join(", ")}
        </Text>
      ) : null}
      {vehicle.serviceCount != null ? (
        <Text style={[styles.locations, { color: colors.mutedForeground }]}>
          Existing service records: {vehicle.serviceCount}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 13, borderWidth: 1, gap: 5, padding: 14 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 9 },
  title: { fontSize: 15, fontWeight: "800" },
  vin: { fontFamily: "monospace", fontSize: 11, marginTop: 4 },
  editButton: { alignItems: "center", borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  editText: { fontSize: 11, fontWeight: "700" },
  metaList: { gap: 2 },
  meta: { fontSize: 12, lineHeight: 17 },
  locations: { fontSize: 11, lineHeight: 16, marginTop: 2 },
});