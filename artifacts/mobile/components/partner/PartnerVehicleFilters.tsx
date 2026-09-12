import { StyleSheet, Text, TextInput, Pressable, View } from "react-native";

import type { PartnerSubtypeCapability } from "@/lib/partnerSubtypeCapabilities";
import { useColors } from "@/hooks/useColors";

export type VehicleServiceFilter = "all" | "needed" | "ready";
export type FleetStatusFilter = "all" | "active" | "maintenance" | "out_of_service";

type Props = {
  capability: PartnerSubtypeCapability;
  search: string;
  onSearchChange: (value: string) => void;
  serviceFilter: VehicleServiceFilter;
  onServiceFilterChange: (value: VehicleServiceFilter) => void;
  fleetStatusFilter: FleetStatusFilter;
  onFleetStatusFilterChange: (value: FleetStatusFilter) => void;
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
};

export function PartnerVehicleFilters({
  capability,
  search,
  onSearchChange,
  serviceFilter,
  onServiceFilterChange,
  fleetStatusFilter,
  onFleetStatusFilterChange,
  groupFilter,
  onGroupFilterChange,
}: Props) {
  const colors = useColors();
  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={`${label} filter`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.filterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>FILTER RECORDS</Text>
      <TextInput
        value={search}
        accessibilityLabel="Search partner vehicles"
        onChangeText={onSearchChange}
        placeholder="Search VIN, make, model, plate, unit"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.searchInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
      />
      {capability.subtype === "dealership" ? (
        <View style={styles.chipRow}>
          {chip("All", serviceFilter === "all", () => onServiceFilterChange("all"))}
          {chip("Service needed", serviceFilter === "needed", () => onServiceFilterChange("needed"))}
          {chip("Ready", serviceFilter === "ready", () => onServiceFilterChange("ready"))}
        </View>
      ) : (
        <>
          <TextInput
            value={groupFilter}
            accessibilityLabel="Filter partner vehicles by group"
            onChangeText={onGroupFilterChange}
            placeholder="Filter by group"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          />
          <View style={styles.chipRow}>
            {(["all", "active", "maintenance", "out_of_service"] as FleetStatusFilter[]).map((filter) =>
              chip(
                filter === "all" ? "All" : filter.replace(/_/g, " "),
                fleetStatusFilter === filter,
                () => onFleetStatusFilterChange(filter),
              ),
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterCard: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 12 },
  filterLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  searchInput: { borderRadius: 9, borderWidth: 1, fontSize: 13, height: 42, paddingHorizontal: 11 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
});