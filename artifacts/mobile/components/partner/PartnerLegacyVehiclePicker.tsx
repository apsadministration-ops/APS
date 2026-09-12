import { Feather } from "@expo/vector-icons";
import type { VehicleWithOwnership } from "@workspace/api-client-react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type LinkedLocation = {
  id: number;
  name: string;
  status?: "active" | "inactive";
};

type Props = {
  vehicles: VehicleWithOwnership[];
  locations: LinkedLocation[];
  isLoading: boolean;
  locationNameById: Map<number, string>;
  onChoose: (vehicle: VehicleWithOwnership) => void;
  onClose: () => void;
};

export function PartnerLegacyVehiclePicker({
  vehicles,
  locations,
  isLoading,
  locationNameById,
  onChoose,
  onClose,
}: Props) {
  const colors = useColors();
  const candidates = vehicles.filter(
    (vehicle) =>
      vehicle.ownerShopId != null &&
      locations.some(
        (location) => location.id === vehicle.ownerShopId && location.status !== "inactive",
      ),
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Eligible legacy vehicle candidates</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Candidates are limited to vehicles already registered to one of this organization’s
            linked locations. The server still verifies ownership history and existing operation
            state before linking.
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {candidates.map((vehicle) => (
        <Pressable
          key={vehicle.id}
          accessibilityRole="button"
          onPress={() => onChoose(vehicle)}
          style={[styles.candidate, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View style={styles.copy}>
            <Text style={[styles.candidateTitle, { color: colors.foreground }]}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              VIN {vehicle.vin} · {locationNameById.get(vehicle.ownerShopId ?? 0) ?? "Linked location"}
            </Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        </Pressable>
      ))}
      {!isLoading && candidates.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No legacy candidates meet the visible location proof. Customer-owned VINs are not offered
          for import.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 13 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17 },
  close: { padding: 3 },
  candidate: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  candidateTitle: { fontSize: 13, fontWeight: "800" },
  empty: { fontSize: 12, lineHeight: 18 },
});