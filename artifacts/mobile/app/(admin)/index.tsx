import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, Alert } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

interface DashboardStats {
  totalUsers: number;
  totalCustomers: number;
  totalMechanics: number;
  pendingMechanics: number;
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  totalRevenue: number;
  heldPayments: number;
  heldAmount: number;
}

function StatCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string | number; sub?: string; color: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub && <Text style={[styles.statSub, { color: color }]}>{sub}</Text>}
    </View>
  );
}

export default function AdminDashboard() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchStats = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("auth_token");
      const [usersRes, jobsRes, paymentsRes] = await Promise.all([
        fetch(`https://${domain}/api/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`https://${domain}/api/jobs`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`https://${domain}/api/payments`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [users, jobs, payments] = await Promise.all([
        usersRes.json(), jobsRes.json(), paymentsRes.json(),
      ]);

      const usersArr = Array.isArray(users) ? users : [];
      const jobsArr = Array.isArray(jobs) ? jobs : [];
      const paymentsArr = Array.isArray(payments) ? payments : [];

      setStats({
        totalUsers: usersArr.length,
        totalCustomers: usersArr.filter((u: any) => u.role === "customer").length,
        totalMechanics: usersArr.filter((u: any) => u.role === "mechanic").length,
        pendingMechanics: usersArr.filter((u: any) => u.role === "mechanic" && u.status === "pending").length,
        totalJobs: jobsArr.length,
        activeJobs: jobsArr.filter((j: any) => ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(j.status)).length,
        completedJobs: jobsArr.filter((j: any) => ["COMPLETED", "PAID"].includes(j.status)).length,
        totalRevenue: paymentsArr.filter((p: any) => p.status === "released").reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
        heldPayments: paymentsArr.filter((p: any) => p.status === "held").length,
        heldAmount: paymentsArr.filter((p: any) => p.status === "held").reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
      });
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [domain]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const onRefresh = () => { setRefreshing(true); fetchStats(); };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.adminBadge, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="shield" size={28} color={colors.primary} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Admin Console</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Signed in as {user?.name}</Text>
        </View>
        <Pressable
          style={[styles.signOutBtn, { backgroundColor: colors.destructive + "18" }]}
          onPress={() => {
            Alert.alert("Sign Out", "Sign out of admin console?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign Out", style: "destructive",
                onPress: async () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  await logout();
                },
              },
            ]);
          }}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : stats ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Platform Overview</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="users" label="Total Users" value={stats.totalUsers} color="#6366F1" />
            <StatCard icon="user" label="Customers" value={stats.totalCustomers} color="#0EA5E9" />
            <StatCard icon="tool" label="Mechanics" value={stats.totalMechanics} color="#F97316"
              sub={stats.pendingMechanics > 0 ? `${stats.pendingMechanics} pending` : undefined} />
            <StatCard icon="briefcase" label="Total Jobs" value={stats.totalJobs} color="#8B5CF6" />
            <StatCard icon="play-circle" label="Active Jobs" value={stats.activeJobs} color="#22C55E" />
            <StatCard icon="check-circle" label="Completed" value={stats.completedJobs} color="#14B8A6" />
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 8 }]}>Financials</Text>
          <View style={[styles.financeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.financeRow}>
              <View style={styles.financeItem}>
                <Text style={[styles.financeAmount, { color: "#22C55E" }]}>
                  ${stats.totalRevenue.toFixed(2)}
                </Text>
                <Text style={[styles.financeLabel, { color: colors.mutedForeground }]}>Total Released</Text>
              </View>
              <View style={[styles.financeDivider, { backgroundColor: colors.border }]} />
              <View style={styles.financeItem}>
                <Text style={[styles.financeAmount, { color: colors.primary }]}>
                  ${stats.heldAmount.toFixed(2)}
                </Text>
                <Text style={[styles.financeLabel, { color: colors.mutedForeground }]}>
                  {stats.heldPayments} payment{stats.heldPayments !== 1 ? "s" : ""} held
                </Text>
              </View>
            </View>
            {stats.heldPayments > 0 && (
              <View style={[styles.heldNote, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <Feather name="info" size={14} color={colors.primary} />
                <Text style={[styles.heldNoteText, { color: colors.primary }]}>
                  Go to Payments tab to release held funds to mechanics.
                </Text>
              </View>
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  adminBadge: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: "800" },
  headerSub: { fontSize: 13, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  statCard: {
    width: "47%",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  statIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 26, fontWeight: "800" },
  statLabel: { fontSize: 12, fontWeight: "500" },
  statSub: { fontSize: 11, fontWeight: "700" },
  financeCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  financeRow: { flexDirection: "row", alignItems: "center" },
  financeItem: { flex: 1, alignItems: "center", gap: 4 },
  financeAmount: { fontSize: 24, fontWeight: "800" },
  financeLabel: { fontSize: 12, textAlign: "center" },
  financeDivider: { width: 1, height: 48 },
  heldNote: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  heldNoteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  signOutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
