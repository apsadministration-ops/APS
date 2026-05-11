import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import { growthGet } from "@/lib/growthApi";

interface Overview {
  totals: { customers: number; mechanics: number; pendingMechanics: number; activeMechanics: number };
  signups: {
    last7Customers: number; last7Mechanics: number;
    last30Customers: number; last30Mechanics: number;
    referralLast30: number; organicLast30: number;
  };
  growth: { monthlyCustomerGrowthPct: number | null; monthlyMechanicGrowthPct: number | null };
  conversion: {
    referralConversionPct: number | null;
    avgSignupToFirstJobMinutes: number | null;
    customerRetention30Pct: number | null;
    mechanicRetention30Pct: number | null;
  };
  daily: { date: string; customers: number; mechanics: number }[];
  recentSignups: { id: number; name: string; email: string; role: string; region: string | null; city: string | null; createdAt: string }[];
}

const fmtPct = (v: number | null): string => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtMinutes = (v: number | null): string => {
  if (v == null) return "—";
  if (v < 60) return `${Math.round(v)}m`;
  if (v < 60 * 24) return `${(v / 60).toFixed(1)}h`;
  return `${(v / 60 / 24).toFixed(1)}d`;
};

function StatCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string | number; sub?: string; color: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub && <Text style={[styles.statSub, { color }]}>{sub}</Text>}
    </View>
  );
}

function NavCard({ icon, title, subtitle, color, onPress }: {
  icon: string; title: string; subtitle: string; color: string; onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.navCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.navIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.navSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const colors = useColors();
  const max = Math.max(1, ...data);
  return (
    <View style={styles.spark}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            marginHorizontal: 1,
            backgroundColor: color + "55",
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
            height: Math.max(2, (v / max) * 36),
            alignSelf: "flex-end",
          }}
        />
      ))}
      {/* eslint-disable-next-line react/jsx-no-undef -- View imported above */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

export default function GrowthCenterIndex() {
  const colors = useColors();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const overview = await growthGet<Overview>("/admin/growth/overview");
      setData(overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroBadge, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="trending-up" size={26} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>APS Growth Intelligence Center</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Live acquisition, organic content, and marketplace balance — admin only. Generated content always queues for your approval.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "30" }]}>
          <Feather name="alert-triangle" size={16} color={colors.destructive} />
          <Text style={{ color: colors.destructive, flex: 1 }}>{error}</Text>
        </View>
      ) : data ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Acquisition Overview</Text>
          <View style={styles.grid}>
            <StatCard icon="user" label="Customers" value={data.totals.customers} color="#0EA5E9"
              sub={`+${data.signups.last30Customers} / 30d (${fmtPct(data.growth.monthlyCustomerGrowthPct)})`} />
            <StatCard icon="tool" label="Mechanics" value={data.totals.mechanics} color="#F97316"
              sub={`+${data.signups.last30Mechanics} / 30d (${fmtPct(data.growth.monthlyMechanicGrowthPct)})`} />
            <StatCard icon="check-circle" label="Active mechanics" value={data.totals.activeMechanics} color="#22C55E"
              sub={data.totals.pendingMechanics > 0 ? `${data.totals.pendingMechanics} pending` : undefined} />
            <StatCard icon="user-plus" label="Last 7d signups" value={data.signups.last7Customers + data.signups.last7Mechanics} color="#8B5CF6" />
            <StatCard icon="share-2" label="Referral signups (30d)" value={data.signups.referralLast30} color="#EC4899" />
            <StatCard icon="globe" label="Organic signups (30d)" value={data.signups.organicLast30} color="#14B8A6" />
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Daily signups (14d)</Text>
          <View style={[styles.sparkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sparkLegend, { color: "#0EA5E9" }]}>Customers</Text>
              <Sparkline data={data.daily.map((d) => d.customers)} color="#0EA5E9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sparkLegend, { color: "#F97316" }]}>Mechanics</Text>
              <Sparkline data={data.daily.map((d) => d.mechanics)} color="#F97316" />
            </View>
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Conversion intelligence</Text>
          <View style={styles.grid}>
            <StatCard icon="repeat" label="Referral conversion" value={fmtPct(data.conversion.referralConversionPct)} color="#EC4899" />
            <StatCard icon="clock" label="Signup → first job" value={fmtMinutes(data.conversion.avgSignupToFirstJobMinutes)} color="#6366F1" />
            <StatCard icon="users" label="Customer retention 30d" value={fmtPct(data.conversion.customerRetention30Pct)} color="#0EA5E9" />
            <StatCard icon="award" label="Mechanic retention 30d" value={fmtPct(data.conversion.mechanicRetention30Pct)} color="#F97316" />
          </View>

          <Text style={[styles.section, { color: colors.foreground }]}>Modules</Text>
          <NavCard icon="share-2" title="Referral Intelligence" subtitle="Mechanic + customer leaderboards, regional breakdown" color="#EC4899" onPress={() => router.push("/(admin)/growth/referrals")} />
          <NavCard icon="map" title="Regional & Marketplace Balance" subtitle="Density heat-list + AI balancing recommendations" color="#22C55E" onPress={() => router.push("/(admin)/growth/regions")} />
          <NavCard icon="bar-chart-2" title="Analytics & CPA" subtitle="Cost-per-acquisition, LTV, funnel conversion" color="#6366F1" onPress={() => router.push("/(admin)/growth/cpa")} />
          <NavCard icon="zap" title="Mechanic Amplification" subtitle="Top performers, utilization + referral reach" color="#F97316" onPress={() => router.push("/(admin)/growth/amplification")} />
          <NavCard icon="trending-up" title="Trends & Opportunities" subtitle="AI-suggested timely content + 1-tap generate" color="#0EA5E9" onPress={() => router.push("/(admin)/growth/trends")} />
          <NavCard icon="check-square" title="Content Approval Queue" subtitle="Review, edit, approve, schedule, publish" color="#8B5CF6" onPress={() => router.push("/(admin)/growth/queue")} />
          <NavCard icon="shield" title="Admin Controls & AI Policy" subtitle="Pause AI, daily caps, restrictions, future architecture" color="#F43F5E" onPress={() => router.push("/(admin)/growth/admin-controls")} />

          <Text style={[styles.section, { color: colors.foreground }]}>Recent signups</Text>
          <View style={[styles.feedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {data.recentSignups.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No signups yet.</Text>
            ) : data.recentSignups.map((s) => (
              <View key={s.id} style={[styles.feedRow, { borderBottomColor: colors.border }]}>
                <Feather name={s.role === "mechanic" ? "tool" : "user"} size={14} color={s.role === "mechanic" ? "#F97316" : "#0EA5E9"} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{s.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                    {s.role} · {s.city ?? s.region ?? "Unknown region"}
                  </Text>
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                  {new Date(s.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 60, alignItems: "center" },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 18 },
  heroBadge: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 17, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  errorBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  section: { fontSize: 15, fontWeight: "700", marginBottom: 10, marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  statCard: { width: "47%", padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  statIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11 },
  statSub: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  sparkCard: { flexDirection: "row", gap: 16, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 18 },
  sparkLegend: { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  spark: { height: 40, flexDirection: "row", alignItems: "flex-end", position: "relative" },
  navCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  navIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  navTitle: { fontSize: 14, fontWeight: "700" },
  navSub: { fontSize: 11, marginTop: 2 },
  feedCard: { padding: 14, borderRadius: 14, borderWidth: 1 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
