import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useListJobs, Job } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { JobCard } from "@/components/JobCard";

const ACTIVE_STATUSES = ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS"];
const DONE_STATUSES = ["COMPLETED", "PAID", "CANCELLED"];

export default function CustomerJobsScreen() {
  const colors = useColors();
  const { data: jobs, isLoading } = useListJobs();

  const active = (jobs ?? []).filter((j: Job) => ACTIVE_STATUSES.includes(j.status));
  const done = (jobs ?? []).filter((j: Job) => DONE_STATUSES.includes(j.status));

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
        data={[...active, ...done]}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        renderItem={() => null}
        ListHeaderComponent={() => (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active</Text>
            {active.length === 0 ? (
              <View style={[styles.emptySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active jobs</Text>
              </View>
            ) : (
              active.map((j: Job) => <JobCard key={j.id} job={j} />)
            )}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>History</Text>
            {done.length === 0 ? (
              <View style={[styles.emptySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="archive" size={32} color={colors.mutedForeground} style={{ marginBottom: 8 }} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No completed jobs yet</Text>
              </View>
            ) : (
              done.map((j: Job) => <JobCard key={j.id} job={j} />)
            )}
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  emptySection: {
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    marginBottom: 8,
  },
  emptyText: { fontSize: 14 },
});
