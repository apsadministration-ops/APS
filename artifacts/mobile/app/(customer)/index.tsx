import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetCustomerDashboard } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";
import { JobCard } from "@/components/JobCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function CustomerDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: dashboard, isLoading, error } = useGetCustomerDashboard();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !dashboard) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.destructive }}>Failed to load dashboard</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.vehicleCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Vehicles</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.activeJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active Jobs</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>${dashboard.totalSpent.toFixed(0)}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Spent</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Jobs</Text>
          <Link href="/(customer)/jobs" asChild>
            <Pressable>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See All</Text>
            </Pressable>
          </Link>
        </View>

        {dashboard.recentJobs.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recent jobs</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Request a service to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {dashboard.recentJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </View>
        )}
      </ScrollView>

      <Link href="/request-service" asChild>
        <Pressable 
          style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 80 }]}
        >
          <Feather name="plus" size={24} color={colors.primaryForeground} />
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  seeAll: {
    fontSize: 14,
    fontWeight: "600",
  },
  list: {
    gap: 12,
  },
  emptyState: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
