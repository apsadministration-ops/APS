import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useListJobs, Job, getListJobsQueryKey } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { JobCard } from "@/components/JobCard";
import { useAuth } from "@/context/AuthContext";

const DONE_STATUSES = ["COMPLETED", "PAID", "CANCELLED"];

export default function MechanicHistoryScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const params = { mechanicId: user?.id };
  const { data: jobs, isLoading, refetch } = useListJobs(
    params,
    { query: { enabled: !!user?.id, queryKey: getListJobsQueryKey(params) } }
  );

  const done = (jobs ?? []).filter((j: Job) => DONE_STATUSES.includes(j.status));
  const totalEarnings = done
    .filter((j: Job) => j.status === "COMPLETED" || j.status === "PAID")
    .reduce((sum: number, j: Job) => sum + (j.finalPrice ?? 0) * 0.9, 0);

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={done}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        onRefresh={refetch}
        refreshing={isLoading}
        ListHeaderComponent={() =>
          done.length > 0 ? (
            <View style={[styles.earningsBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.earningsLabel, { color: colors.mutedForeground }]}>Total Earnings</Text>
              <Text style={[styles.earningsValue, { color: colors.primary }]}>${totalEarnings.toFixed(2)}</Text>
              <Text style={[styles.earningsCount, { color: colors.mutedForeground }]}>
                {done.filter((j: Job) => j.status !== "CANCELLED").length} completed jobs
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="clock" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Completed and cancelled jobs will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => <JobCard job={item} showCustomer />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  earningsBanner: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: "center",
  },
  earningsLabel: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  earningsValue: { fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  earningsCount: { fontSize: 13, marginTop: 4 },
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
