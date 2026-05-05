import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetWorkLogsByVin, useGetVehicle, WorkLog } from "@workspace/api-client-react";
import { useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { WorkLogCard } from "@/components/WorkLogCard";

export default function VehicleHistoryScreen() {
  const colors = useColors();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const id = parseInt(vehicleId, 10);

  const { data: vehicle } = useGetVehicle(id, { query: { enabled: !!id } });
  const { data: logs, isLoading } = useGetWorkLogsByVin(vehicle?.vin ?? "", {
    query: { enabled: !!vehicle?.vin },
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: "Service History",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {vehicle && (
          <View style={[styles.vehicleBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={[styles.vehicleName, { color: colors.foreground }]}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            <Text style={[styles.vehicleVin, { color: colors.mutedForeground }]}>VIN: {vehicle.vin}</Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={logs ?? []}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            ListHeaderComponent={
              logs && logs.length > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total Spend</Text>
                  <Text style={[styles.totalValue, { color: colors.primary }]}>
                    ${logs.reduce((s: number, l: WorkLog) => s + l.totalCost, 0).toFixed(2)}
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="clock" size={48} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No service history</Text>
                <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                  Work logs will appear here after completed jobs.
                </Text>
              </View>
            }
            renderItem={({ item }) => <WorkLogCard log={item} />}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vehicleBar: {
    padding: 16,
    borderBottomWidth: 1,
  },
  vehicleName: { fontSize: 16, fontWeight: "700" },
  vehicleVin: { fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  totalLabel: { fontSize: 14 },
  totalValue: { fontSize: 22, fontWeight: "800" },
  emptyState: {
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: "center" },
});
