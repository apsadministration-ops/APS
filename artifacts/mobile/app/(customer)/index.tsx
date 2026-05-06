import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useGetCustomerDashboard } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { JobCard } from "@/components/JobCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function CustomerDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { data: dashboard, isLoading, error, refetch, isRefetching } = useGetCustomerDashboard({
    query: { enabled: !!user && user.role === "customer" },
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
        <Text style={[styles.userName, { color: colors.foreground }]}>{user?.name?.split(" ")[0] ?? "there"} 👋</Text>

        {/* Primary CTA — Request Service */}
        <Pressable
          style={[styles.primaryCta, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/request-service")}
        >
          <View style={styles.primaryCtaIcon}>
            <Feather name="plus-circle" size={22} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.primaryCtaTitle, { color: colors.primaryForeground }]}>Request a Service</Text>
            <Text style={[styles.primaryCtaSub, { color: colors.primaryForeground, opacity: 0.85 }]}>
              Repairs, diagnostics, maintenance & more
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primaryForeground} />
        </Pressable>

        {/* Compact stats row */}
        <View style={styles.statsGrid}>
          <Pressable
            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/(customer)/vehicles")}
          >
            <Feather name="truck" size={18} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.vehicleCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Vehicles</Text>
          </Pressable>
          <Pressable
            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/(customer)/jobs")}
          >
            <Feather name="activity" size={18} color="#22C55E" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{dashboard.activeJobCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active</Text>
          </Pressable>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="dollar-sign" size={18} color="#F97316" />
            <Text style={[styles.statValue, { color: colors.foreground }]}>${(dashboard.totalSpent ?? 0).toFixed(0)}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Spent</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={[styles.quickAction, { backgroundColor: "#0EA5E912", borderColor: "#0EA5E940" }]}
            onPress={() => router.push("/detailing")}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: "#0EA5E9" }]}>
              <Feather name="droplet" size={18} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickActionLabel, { color: colors.foreground }]}>Book Detailing</Text>
              <Text style={[styles.quickActionSub, { color: colors.mutedForeground }]}>4 packages</Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.quickAction, { backgroundColor: "#8B5CF612", borderColor: "#8B5CF640" }]}
            onPress={() => router.push("/referral")}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: "#8B5CF6" }]}>
              <Feather name="gift" size={18} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickActionLabel, { color: colors.foreground }]}>Rewards</Text>
              <Text style={[styles.quickActionSub, { color: colors.mutedForeground }]}>Earn points</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Jobs</Text>
          <Pressable onPress={() => router.push("/(customer)/jobs")}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See All</Text>
          </Pressable>
        </View>

        {(dashboard.recentJobs ?? []).length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recent jobs</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Request a service to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {(dashboard.recentJobs ?? []).map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={() => router.push("/request-service")}
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 80 }]}
      >
        <Feather name="plus" size={24} color={colors.primaryForeground} />
      </Pressable>
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
  greeting: { fontSize: 14, fontWeight: "500" },
  userName: { fontSize: 24, fontWeight: "800", marginBottom: 16 },
  primaryCta: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 18, borderRadius: 16, marginBottom: 16,
    elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6,
  },
  primaryCtaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  primaryCtaTitle: { fontSize: 16, fontWeight: "800" },
  primaryCtaSub: { fontSize: 12, marginTop: 2 },
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
  quickActions: { flexDirection: "row", gap: 10, marginBottom: 24 },
  quickAction: {
    flex: 1, flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 10,
  },
  quickActionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickActionLabel: { fontSize: 13, fontWeight: "700" },
  quickActionSub: { fontSize: 11, marginTop: 1 },
});
