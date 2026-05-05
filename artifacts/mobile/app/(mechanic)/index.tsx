import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetMechanicDashboard } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";
import { JobCard } from "@/components/JobCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function MechanicDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: dashboard, isLoading, error } = useGetMechanicDashboard();

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
        <View style={styles.earningsCard}>
          <Text style={[styles.earningsLabel, { color: "rgba(255,255,255,0.8)" }]}>Today's Earnings</Text>
          <Text style={styles.earningsValue}>${dashboard.todayEarnings.toFixed(2)}</Text>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: "rgba(255,255,255,0.8)" }]}>Total Earnings</Text>
            <Text style={[styles.totalValue, { color: "white" }]}>${dashboard.totalEarnings.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.activeJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active Jobs</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.availableJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Available Jobs</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {dashboard.averageRating ? dashboard.averageRating.toFixed(1) : "—"}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Rating</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Jobs</Text>
          <Link href="/(mechanic)/history" asChild>
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
              Accept available jobs to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {dashboard.recentJobs.map((job) => (
              <JobCard key={job.id} job={job} showCustomer />
            ))}
          </View>
        )}
      </ScrollView>
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
  earningsCard: {
    backgroundColor: "#F97316", // Hardcoded primary for impact
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  earningsLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  earningsValue: {
    fontSize: 48,
    fontWeight: "800",
    color: "white",
    letterSpacing: -1,
    marginBottom: 24,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  totalValue: {
    fontSize: 16,
    fontWeight: "700",
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
});
