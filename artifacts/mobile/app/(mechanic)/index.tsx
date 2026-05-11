import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetMechanicDashboard, getGetMechanicDashboardQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { JobCard } from "@/components/JobCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function MechanicDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { data: dashboard, isLoading, error, refetch, isRefetching } = useGetMechanicDashboard({
    query: {
      enabled: !!user && user.role === "mechanic",
      queryKey: getGetMechanicDashboardQueryKey(),
    },
  });

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
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {/* Personalized greeting */}
        <Text style={[styles.greeting, { color: colors.mutedForeground }]}>{greeting()},</Text>
        <Text style={[styles.userName, { color: colors.foreground }]}>{user?.name?.split(" ")[0] ?? "there"} 🔧</Text>

        <View style={styles.earningsCard}>
          <Text style={[styles.earningsLabel, { color: "rgba(255,255,255,0.8)" }]}>Today's Earnings</Text>
          <Text style={styles.earningsValue}>${(dashboard.todayEarnings ?? 0).toFixed(2)}</Text>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: "rgba(255,255,255,0.8)" }]}>Total Earnings</Text>
            <Text style={[styles.totalValue, { color: "white" }]}>${(dashboard.totalEarnings ?? 0).toFixed(2)}</Text>
          </View>
        </View>

        {/* Quick actions — most-used mechanic destinations */}
        <View style={styles.statsGrid}>
          <Pressable
            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/(mechanic)/available")}
          >
            <Feather name="list" size={18} color="#0EA5E9" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.availableJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Available</Text>
          </Pressable>
          <Pressable
            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/(mechanic)/active")}
          >
            <Feather name="play-circle" size={18} color="#22C55E" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.activeJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active</Text>
          </Pressable>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="star" size={18} color="#FBBF24" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {dashboard.averageRating ? dashboard.averageRating.toFixed(1) : "—"}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Rating</Text>
          </View>
        </View>

        {/* Vehicle Intelligence Workspace entrypoint */}
        <Pressable
          style={[styles.alertCta, { backgroundColor: "#7C3AED12", borderColor: "#7C3AED40" }]}
          onPress={() => router.push("/mechanic/vin" as never)}
        >
          <View style={[styles.alertIcon, { backgroundColor: "#7C3AED" }]}>
            <Feather name="cpu" size={18} color="white" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.alertTitle, { color: colors.foreground }]}>Vehicle Intelligence</Text>
            <Text style={[styles.alertSub, { color: colors.mutedForeground }]}>
              Decode any VIN, see its full service history, installed parts, and notes.
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>

        {/* Highlight available jobs if any */}
        {dashboard.availableJobCount > 0 && (
          <Pressable
            style={[styles.alertCta, { backgroundColor: "#0EA5E912", borderColor: "#0EA5E940" }]}
            onPress={() => router.push("/(mechanic)/available")}
          >
            <View style={[styles.alertIcon, { backgroundColor: "#0EA5E9" }]}>
              <Feather name="bell" size={18} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: colors.foreground }]}>
                {dashboard.availableJobCount} job{dashboard.availableJobCount === 1 ? "" : "s"} waiting
              </Text>
              <Text style={[styles.alertSub, { color: colors.mutedForeground }]}>
                Tap to browse and accept new work
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color="#0EA5E9" />
          </Pressable>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Jobs</Text>
          <Link href="/(mechanic)/history" asChild>
            <Pressable>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See All</Text>
            </Pressable>
          </Link>
        </View>

        {(dashboard.recentJobs ?? []).length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recent jobs</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Accept available jobs to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {(dashboard.recentJobs ?? []).map((job) => (
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
  greeting: { fontSize: 14, fontWeight: "500" },
  userName: { fontSize: 24, fontWeight: "800", marginBottom: 16 },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  alertCta: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 24,
  },
  alertIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: 14, fontWeight: "700" },
  alertSub: { fontSize: 12, marginTop: 2 },
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
