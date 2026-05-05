import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetVehicle, useGetVehicleHistory, WorkLog } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { WorkLogCard } from "@/components/WorkLogCard";

export default function VehicleDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = parseInt(id, 10);

  const { data: vehicle, isLoading: vehicleLoading } = useGetVehicle(vehicleId, {
    query: { enabled: !!vehicleId },
  });
  const { data: history, isLoading: historyLoading } = useGetVehicleHistory(vehicleId, {
    query: { enabled: !!vehicleId },
  });

  const isLoading = vehicleLoading || historyLoading;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!vehicle) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Vehicle not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShown: true,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={[styles.vehicleHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.vehicleIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="truck" size={32} color={colors.foreground} />
            </View>
            <Text style={[styles.vehicleTitle, { color: colors.foreground }]}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            {vehicle.trim ? (
              <Text style={[styles.vehicleTrim, { color: colors.mutedForeground }]}>{vehicle.trim}</Text>
            ) : null}
            <View style={[styles.vinBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.vinLabel, { color: colors.mutedForeground }]}>VIN</Text>
              <Text style={[styles.vinValue, { color: colors.foreground }]}>{vehicle.vin}</Text>
            </View>
            <View style={styles.metaRow}>
              {vehicle.color ? (
                <View style={styles.metaItem}>
                  <Feather name="droplet" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{vehicle.color}</Text>
                </View>
              ) : null}
              <View style={styles.metaItem}>
                <Feather name="tool" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {vehicle.serviceCount ?? 0} services
                </Text>
              </View>
            </View>
          </View>

          {vehicle.isCurrentUserOwner && (
            <View style={styles.actions}>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/request-service")}
              >
                <Feather name="tool" size={18} color="white" />
                <Text style={styles.actionText}>Request Service</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: colors.secondary }]}
                onPress={() => router.push(`/transfer/${vehicle.id}`)}
              >
                <Feather name="send" size={18} color={colors.secondaryForeground} />
                <Text style={[styles.actionText, { color: colors.secondaryForeground }]}>Transfer</Text>
              </Pressable>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Service History</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            All records are permanently tied to this VIN — history persists across ownership changes.
          </Text>

          {!history || history.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="clock" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No service history</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                Work logs will appear here after a mechanic completes a job.
              </Text>
            </View>
          ) : (
            history.map((log: WorkLog) => <WorkLogCard key={log.id} log={log} />)
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vehicleHeader: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  vehicleIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  vehicleTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  vehicleTrim: { fontSize: 15, textAlign: "center" },
  vinBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    marginTop: 4,
  },
  vinLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  vinValue: { fontSize: 14, fontFamily: "monospace", fontWeight: "600", letterSpacing: 1, marginTop: 2 },
  metaRow: { flexDirection: "row", gap: 20, marginTop: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, fontWeight: "500" },
  actions: { flexDirection: "row", gap: 12, marginBottom: 24 },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionText: { color: "white", fontWeight: "700", fontSize: 15 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, marginBottom: 16 },
  emptyState: {
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: "center" },
});
